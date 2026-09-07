"""Regression test for QA_REGRESSION_ROUND2 R2-H12:

`GET /api/stripe/invoices/` 500'd for every subscriber. Root cause: the same
stripe==15 object-shape change behind round-1's C-6 — `current_period_end`
moved off the top-level `Subscription` onto each subscription item for
accounts on a newer Stripe API version, so `sub.current_period_end` raised a
genuine `AttributeError` (the field isn't there). That access sat OUTSIDE the
view's `try/except`, so it crashed the whole request instead of just skipping
one bad subscription row.

Mocks `stripe.Subscription.retrieve` to return a real `StripeObject` (built
the same way the SDK does) shaped like the real API response, exercising
`InvoicesView.get()` exactly like the live crash — a plain dict would not
reproduce the bug (a genuine dict's attribute access never raises)."""
import uuid
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIRequestFactory, force_authenticate
from stripe._stripe_object import StripeObject
from unittest.mock import patch

from commerce.stripe_views import InvoicesView
from schools.models import School
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db


def _stripe_object(payload: dict) -> StripeObject:
    return StripeObject.construct_from(payload, "sk_test_x")


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def student(school):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name="Stu", school=school)


def _request_as(student):
    factory = APIRequestFactory()
    request = factory.get("/api/stripe/invoices/")
    force_authenticate(request, user=student.user)
    view = InvoicesView.as_view()
    return view, factory, request


def test_current_period_end_only_on_items_does_not_500(school, student):
    """Newer Stripe API responses: current_period_end lives only on
    items.data[0], not on the subscription itself — the exact live shape."""
    StudentPackage.objects.create(
        student=student, school=school, stripe_subscription_id="sub_items_only",
        credits_total=8, credits_remaining=8,
    )
    sub = _stripe_object({
        "id": "sub_items_only", "status": "active", "customer": "cus_1",
        "cancel_at_period_end": False, "cancel_at": None, "canceled_at": None, "currency": "eur",
        "items": {"object": "list", "data": [{
            "id": "si_1", "current_period_end": 2_000_000_000,
            "price": {"unit_amount": 4900},
        }]},
    })
    view, factory, request = _request_as(student)
    with patch("stripe.Invoice.list", side_effect=Exception("no invoices in test")), \
            patch("stripe.Subscription.retrieve", return_value=sub):
        response = view(request)

    assert response.status_code == 200
    assert response.data["subscriptions"] == [{
        "subscription_id": "sub_items_only",
        "next_payment_at": 2_000_000_000,
        "next_payment_amount": 4900,
        "cancel_at": None,
        "cancelled_at": None,
        "currency": "eur",
        "status": "active",
    }]


def test_missing_current_period_end_anywhere_is_skipped_not_500(school, student):
    StudentPackage.objects.create(
        student=student, school=school, stripe_subscription_id="sub_none",
        credits_total=8, credits_remaining=8,
    )
    sub = _stripe_object({"id": "sub_none", "status": "active", "customer": "cus_1"})
    view, factory, request = _request_as(student)
    with patch("stripe.Invoice.list", side_effect=Exception("no invoices in test")), \
            patch("stripe.Subscription.retrieve", return_value=sub):
        response = view(request)

    assert response.status_code == 200
    # No crash — a subscription entry is still returned (next_payment fields
    # simply come back None rather than raising).
    assert response.data["subscriptions"][0]["subscription_id"] == "sub_none"
    assert response.data["subscriptions"][0]["next_payment_at"] is None


def test_current_period_end_at_top_level_still_works(school, student):
    StudentPackage.objects.create(
        student=student, school=school, stripe_subscription_id="sub_top",
        credits_total=8, credits_remaining=8,
    )
    sub = _stripe_object({
        "id": "sub_top", "status": "active", "customer": "cus_1",
        "current_period_end": 2_100_000_000, "cancel_at_period_end": False,
        "cancel_at": None, "canceled_at": None, "currency": "eur",
        "items": {"object": "list", "data": []},
    })
    view, factory, request = _request_as(student)
    with patch("stripe.Invoice.list", side_effect=Exception("no invoices in test")), \
            patch("stripe.Subscription.retrieve", return_value=sub):
        response = view(request)

    assert response.status_code == 200
    assert response.data["subscriptions"][0]["next_payment_at"] == 2_100_000_000
