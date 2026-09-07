"""Regression tests for the subscription-activation crash (QA C-6 / C-2):

`stripe==15.4.0`'s `StripeObject` is no longer a `Mapping` — `.get(...)`
raises `AttributeError` (only attribute/`[]` access work, via
`__getattr__`/`__getitem__`). `VerifySessionView._activate()` called
`sub.get("current_period_end")` on a real `stripe.Subscription.retrieve()`
result, which is a `StripeObject`, not a dict — 100% reproducible crash on
this SDK version, confirmed directly against the installed package before
writing this fix.

These tests mock `stripe.Subscription.retrieve` to return a real
`StripeObject` (not a plain dict, which would hide the bug since a genuine
dict's `.get()` never raises) shaped like the actual API response, exercising
`_activate()` exactly as the real return-from-Stripe redirect does, for both
the current-period-end-at-top-level shape and the newer API shape where it
only lives on the subscription's line items.

Also covers the same class of bug in `commerce/webhooks.py`: every handler
there does `.get(...)` on the event's `data.object`, which is a `StripeObject`
on a real webhook delivery (not the plain dict the *other* webhook tests in
this package pass) — `handle_event` now converts it once, up front.
"""
import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from stripe._stripe_object import StripeObject

from catalog.models import Package
from commerce.stripe_views import VerifySessionView
from commerce.webhooks import handle_event
from schools.models import School
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db


@pytest.fixture
def school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        stripe_account_id="acct_x", stripe_onboarding_complete=True,
    )


@pytest.fixture
def student(school):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name="Stu", school=school)


@pytest.fixture
def recurring_package(school):
    return Package.objects.create(
        school=school, credits=8, price=Decimal("49.00"), is_recurring=True, recurring_interval="month",
    )


def _stripe_object(payload: dict) -> StripeObject:
    """A real StripeObject, constructed the same way the SDK builds one from
    an API response — NOT a plain dict, so a test using this cannot pass by
    accident just because dicts happen to support `.get()`."""
    return StripeObject.construct_from(payload, "sk_test_x")


def _session(*, subscription_id: str, amount_total: int = 4900):
    """`VerifySessionView._activate` only touches these four attributes on
    `session` — a plain namespace is enough, no real Stripe object needed."""
    return SimpleNamespace(
        payment_status="paid", payment_intent=None, subscription=subscription_id, amount_total=amount_total,
    )


def _meta(school, student, package):
    return {"kind": "package", "school_id": str(school.id), "student_id": str(student.id), "item_id": str(package.id)}


class TestVerifySessionSubscriptionFallback:
    """`GET /api/stripe/verify-session/` when the checkout was mode=subscription."""

    def test_current_period_end_at_top_level_does_not_crash(self, school, student, recurring_package):
        sub = _stripe_object({
            "id": "sub_top", "status": "active", "customer": "cus_1",
            "current_period_end": 2_000_000_000,
            "metadata": _meta(school, student, recurring_package),
        })
        with patch("stripe.Subscription.retrieve", return_value=sub):
            result = VerifySessionView()._activate(
                _session(subscription_id="sub_top"), _meta(school, student, recurring_package),
            )

        assert result == "recurring_package_activated"
        sp = StudentPackage.objects.get(stripe_subscription_id="sub_top")
        assert sp.student_id == student.id
        assert sp.credits_total == 8
        assert sp.status == "active"

    def test_current_period_end_only_on_items_does_not_crash(self, school, student, recurring_package):
        """Newer Stripe API responses: `current_period_end` moved off the
        subscription itself and only lives on `items.data[0]` — the fallback
        branch `_activate` already had for this, but it was unreachable
        because the crash happened on the line before it ever ran."""
        sub = _stripe_object({
            "id": "sub_items", "status": "active", "customer": "cus_1",
            "items": {"object": "list", "data": [{"id": "si_1", "current_period_end": 2_000_000_000}]},
            "metadata": _meta(school, student, recurring_package),
        })
        with patch("stripe.Subscription.retrieve", return_value=sub):
            result = VerifySessionView()._activate(
                _session(subscription_id="sub_items"), _meta(school, student, recurring_package),
            )

        assert result == "recurring_package_activated"
        assert StudentPackage.objects.filter(stripe_subscription_id="sub_items", status="active").exists()

    def test_missing_period_end_anywhere_is_reported_not_crashed(self, school, student, recurring_package):
        sub = _stripe_object({"id": "sub_none", "status": "active", "customer": "cus_1"})
        with patch("stripe.Subscription.retrieve", return_value=sub):
            result = VerifySessionView()._activate(
                _session(subscription_id="sub_none"), _meta(school, student, recurring_package),
            )
        assert result == "missing_period_end"


class TestWebhookRealStripeObjectShapes:
    """The same `.get()`-on-StripeObject hazard, inside webhooks.py itself —
    every other webhook test in this package hand-crafts plain dicts, which
    would never have caught this."""

    def test_subscription_created_event_as_real_stripe_object(self, school, student, recurring_package):
        event = _stripe_object({
            "id": "evt_1", "type": "customer.subscription.created",
            "data": {"object": {
                "id": "sub_evt", "status": "active", "customer": "cus_1",
                "current_period_end": 2_000_000_000,
                "metadata": _meta(school, student, recurring_package),
            }},
        })
        result = handle_event(event)
        assert result == "recurring_package_activated"
        assert StudentPackage.objects.filter(stripe_subscription_id="sub_evt").exists()

    def test_payment_intent_succeeded_event_as_real_stripe_object(self, school, student):
        onetime = Package.objects.create(school=school, credits=10, price=Decimal("25.00"))
        event = _stripe_object({
            "id": "evt_2", "type": "payment_intent.succeeded",
            "data": {"object": {
                "id": "pi_evt", "amount": 2500,
                "metadata": _meta(school, student, onetime),
            }},
        })
        result = handle_event(event)
        assert result == "package_activated"
        assert StudentPackage.objects.filter(stripe_payment_id="pi_evt").exists()
