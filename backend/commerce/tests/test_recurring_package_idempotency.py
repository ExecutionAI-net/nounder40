"""Regression tests for QA_REGRESSION_ROUND2 R2-C3 / R2-H11:

R2-C3 (Critical) — `_handle_recurring_package_created` was reachable twice for
the SAME initial activation event: once from the `customer.subscription.created`
webhook, and once from `VerifySessionView._activate()`'s checkout-session
fallback (the frontend calls `verify-session` on every load of the packages
success URL, which stays live in browser history). It used
`update_or_create`, so a replay reset `credits_remaining`/`credits_total` to
the package's full amount, reset `purchased_at`, and re-sent the receipt
email — live: 7 -> 8 credits, 3 receipt emails for one purchase.

R2-H11 (High) — the same handler (and a genuine renewal via
`customer.subscription.updated`) never created a `Transaction` row, so a
school's Payments/Reports omitted all subscription revenue and its
platform-fee split entirely.

These tests activate the same `stripe_subscription_id` twice (mirroring a
webhook + verify-session race, or a bookmarked success URL reopened) and
assert: exactly one StudentPackage, unchanged credits/purchased_at on the
replay, exactly one receipt email, and exactly one Transaction with the
correct amount/fee split. A separate test proves a genuine renewal
(`customer.subscription.updated` with an advanced period end) creates its own
Transaction without resetting the first one.
"""
import uuid
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from catalog.models import Package
from commerce.models import Transaction
from commerce.stripe_views import VerifySessionView
from commerce.webhooks import handle_event
from schools.models import School
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db


@pytest.fixture
def school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        platform_fee_percentage=Decimal("10"),
    )


@pytest.fixture
def student(school):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name="Stu", school=school)


@pytest.fixture
def package(school):
    return Package.objects.create(
        school=school, credits=8, price=Decimal("49.00"), is_recurring=True, recurring_interval="month",
        name_it="Abbonamento Mensile", name_en="Monthly Subscription",
    )


def _meta(school, student, package):
    return {"kind": "package", "school_id": str(school.id), "student_id": str(student.id), "item_id": str(package.id)}


def sub_event(etype, obj):
    return {"type": etype, "data": {"object": obj}}


def _created_event(sub_id, meta, period_end):
    return sub_event("customer.subscription.created", {
        "id": sub_id, "status": "active", "customer": "cus_1",
        "current_period_end": int(period_end.timestamp()),
        "metadata": meta,
    })


class TestReplayIsIdempotent:
    def test_replaying_activation_does_not_reset_credits_or_resend_receipt(
        self, django_capture_on_commit_callbacks, school, student, package,
    ):
        meta = _meta(school, student, package)
        period_end = timezone.now() + timedelta(days=30)

        with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, \
                django_capture_on_commit_callbacks(execute=True):
            first = handle_event(_created_event("sub_replay", meta, period_end))
        assert first == "recurring_package_activated"
        assert delayed.call_count == 1

        sp = StudentPackage.objects.get(stripe_subscription_id="sub_replay")
        original_purchased_at = sp.purchased_at
        # Simulate credits already spent on a booking, exactly like the live
        # repro (8.0 -> 7.0 after a booking, then the replay).
        sp.credits_remaining = Decimal("7.0")
        sp.save(update_fields=["credits_remaining"])

        # Replay: same subscription id, e.g. the webhook arriving late after
        # verify-session already activated it, or the success URL reopened
        # from browser history.
        with patch("notifications.tasks.send_transactional_email_task.delay") as delayed_replay, \
                django_capture_on_commit_callbacks(execute=True):
            second = handle_event(_created_event("sub_replay", meta, period_end))
        assert second == "already_processed"
        assert delayed_replay.call_count == 0  # no second receipt

        sp.refresh_from_db()
        assert sp.credits_remaining == Decimal("7.0")  # NOT reset to 8.0
        assert sp.purchased_at == original_purchased_at  # NOT reset
        assert StudentPackage.objects.filter(stripe_subscription_id="sub_replay").count() == 1

    def test_replay_via_verify_session_activate_is_also_idempotent(self, school, student, package):
        """The C-6 fix's other entry point: VerifySessionView._activate() calls
        _handle_subscription_created -> _handle_recurring_package_created
        directly (not through the webhook envelope). Exercise that call path
        too, since that's the one the live bug (packages page replaying the
        success URL) actually goes through."""
        from commerce.webhooks import _handle_subscription_created

        meta = _meta(school, student, package)
        period_end = timezone.now() + timedelta(days=30)
        sub = {
            "id": "sub_verify_replay", "status": "active", "customer": "cus_1",
            "current_period_end": int(period_end.timestamp()), "metadata": meta,
        }

        first = _handle_subscription_created(sub)
        assert first == "recurring_package_activated"
        sp = StudentPackage.objects.get(stripe_subscription_id="sub_verify_replay")
        sp.credits_remaining = Decimal("3.0")
        sp.save(update_fields=["credits_remaining"])

        second = _handle_subscription_created(sub)
        assert second == "already_processed"
        sp.refresh_from_db()
        assert sp.credits_remaining == Decimal("3.0")
        assert StudentPackage.objects.filter(stripe_subscription_id="sub_verify_replay").count() == 1


class TestTransactionCreated:
    def test_first_activation_creates_transaction_with_fee_split(self, school, student, package):
        meta = _meta(school, student, package)
        period_end = timezone.now() + timedelta(days=30)

        result = handle_event(_created_event("sub_tx", meta, period_end))
        assert result == "recurring_package_activated"

        tx = Transaction.objects.get(school=school, type=Transaction.Type.SUBSCRIPTION)
        assert tx.amount == Decimal("49.00")
        assert tx.platform_fee == Decimal("4.90")
        assert tx.school_amount == Decimal("44.10")
        assert tx.status == "completed"
        assert tx.student_id == student.id

    def test_replay_does_not_create_a_second_transaction(self, school, student, package):
        meta = _meta(school, student, package)
        period_end = timezone.now() + timedelta(days=30)

        handle_event(_created_event("sub_tx_dup", meta, period_end))
        handle_event(_created_event("sub_tx_dup", meta, period_end))

        assert Transaction.objects.filter(school=school, type=Transaction.Type.SUBSCRIPTION).count() == 1

    def test_genuine_renewal_creates_its_own_transaction(self, school, student, package):
        meta = _meta(school, student, package)
        first_period_end = timezone.now() + timedelta(days=30)
        handle_event(_created_event("sub_renew", meta, first_period_end))
        assert Transaction.objects.filter(school=school, type=Transaction.Type.SUBSCRIPTION).count() == 1

        sp = StudentPackage.objects.get(stripe_subscription_id="sub_renew")
        sp.credits_remaining = Decimal("1.0")
        sp.save(update_fields=["credits_remaining"])

        # A real Stripe billing-cycle rollover: current_period_end advances.
        new_period_end = first_period_end + timedelta(days=30)
        result = handle_event(sub_event("customer.subscription.updated", {
            "id": "sub_renew", "status": "active",
            "current_period_end": int(new_period_end.timestamp()),
        }))
        assert result == "package_renewed"

        sp.refresh_from_db()
        assert sp.credits_remaining == Decimal("8.0")  # renewal legitimately tops up
        transactions = Transaction.objects.filter(school=school, type=Transaction.Type.SUBSCRIPTION).order_by("created_at")
        assert transactions.count() == 2  # activation + renewal, not conflated
        assert transactions[1].amount == Decimal("49.00")

    def test_verify_session_activate_also_creates_a_transaction(self, school, student, package):
        from types import SimpleNamespace

        from stripe._stripe_object import StripeObject

        meta = _meta(school, student, package)
        period_end = timezone.now() + timedelta(days=30)
        sub = StripeObject.construct_from({
            "id": "sub_via_verify", "status": "active", "customer": "cus_1",
            "current_period_end": int(period_end.timestamp()), "metadata": meta,
        }, "sk_test_x")
        session = SimpleNamespace(
            payment_status="paid", payment_intent=None, subscription="sub_via_verify", amount_total=4900,
        )

        with patch("stripe.Subscription.retrieve", return_value=sub):
            result = VerifySessionView()._activate(session, meta)

        assert result == "recurring_package_activated"
        assert Transaction.objects.filter(school=school, type=Transaction.Type.SUBSCRIPTION).count() == 1
