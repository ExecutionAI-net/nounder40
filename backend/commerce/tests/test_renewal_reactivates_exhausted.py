"""Renewal of a recurring package (the live engine), since 2026-11-07:

- `customer.subscription.updated` only syncs the dates: Stripe advances the
  period at the cycle boundary with the invoice still unpaid.
- the paid renewal invoice (`invoice.paid` / `invoice.payment_succeeded`,
  billing_reason subscription_cycle) refills the credits, rolls the window,
  brings an `exhausted` row back to `active` and writes the Transaction —
  so an unpaid cycle gives no lessons (Carlo), and a student who had used
  every lesson sees the new ones (Roberta, 2026-11-04).
- `deleted` is the school's decision and stays.
"""
import uuid
from datetime import timedelta
from decimal import Decimal
from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.utils import timezone

from catalog.models import Package
from commerce.models import Transaction
from commerce.webhooks import handle_event
from schools.models import School
from students.models import StudentPackage, Student

pytestmark = pytest.mark.django_db


@pytest.fixture
def school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", platform_fee_percentage=Decimal("10"),
    )


@pytest.fixture
def student(school):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name="Roberta", school=school)


@pytest.fixture
def package(school):
    return Package.objects.create(
        school=school, credits=5, price=Decimal("59.00"), is_recurring=True, recurring_interval="month",
        name_it="Abbonamento Mensile 5 Lezioni Zoom", name_en="Monthly 5 Zoom lessons",
    )


def _sub_package(student, school, package, *, status, credits, period_end, sub_id=None):
    return StudentPackage.objects.create(
        student=student, school=school, package=package, status=status,
        credits_total=package.credits, credits_remaining=credits,
        expires_at=period_end, next_renewal_at=period_end,
        payment_method="stripe", stripe_subscription_id=sub_id or f"sub_{uuid.uuid4().hex[:8]}",
        credits_low_sent_at=timezone.now(),
    )


def _sync(sub_id, new_end, status="active"):
    """Stripe's cycle-boundary `customer.subscription.updated`."""
    return handle_event({"type": "customer.subscription.updated", "data": {"object": {
        "id": sub_id, "status": status, "current_period_end": int(new_end.timestamp()),
    }}})


def _paid(sub_id, period_end, *, invoice_id=None, reason="subscription_cycle", etype="invoice.payment_succeeded", cents=5900):
    """The renewal invoice, paid."""
    return handle_event({"type": etype, "data": {"object": {
        "id": invoice_id or f"in_{uuid.uuid4().hex[:8]}", "subscription": sub_id, "billing_reason": reason,
        "amount_paid": cents,
        "lines": {"data": [{"period": {"start": int((period_end - timedelta(days=30)).timestamp()), "end": int(period_end.timestamp())}}]},
    }}})


def _renewal_txs(student):
    return Transaction.objects.filter(student=student, type=Transaction.Type.SUBSCRIPTION)


def test_the_cycle_boundary_moves_the_dates_and_nothing_else(student, school, package):
    old_end = timezone.now() + timedelta(hours=1)
    sp = _sub_package(student, school, package, status="exhausted", credits=0, period_end=old_end)
    new_end = old_end + timedelta(days=30)

    assert _sync(sp.stripe_subscription_id, new_end) == "package_dates_synced"
    sp.refresh_from_db()
    assert sp.status == "exhausted" and sp.credits_remaining == 0   # unpaid: no lessons
    assert abs((sp.next_renewal_at - new_end).total_seconds()) < 2
    assert abs((sp.expires_at - new_end).total_seconds()) < 2
    assert not _renewal_txs(student).exists()


def test_the_paid_invoice_refills_reactivates_and_records_the_payment(student, school, package):
    old_end = timezone.now() + timedelta(hours=1)
    sp = _sub_package(student, school, package, status="exhausted", credits=0, period_end=old_end)
    new_end = old_end + timedelta(days=30)
    _sync(sp.stripe_subscription_id, new_end)

    assert _paid(sp.stripe_subscription_id, new_end, invoice_id="in_nov") == "package_renewed"
    sp.refresh_from_db()
    assert sp.status == "active"
    assert sp.credits_remaining == 5 and sp.credits_total == 5
    assert sp.credits_low_sent_at is None
    assert abs((sp.expires_at - new_end).total_seconds()) < 2
    tx = _renewal_txs(student).get()
    assert tx.stripe_payment_id == "in_nov" and tx.amount == Decimal("59.00")
    assert tx.platform_fee == Decimal("5.90") and tx.school_amount == Decimal("53.10")


def test_a_declined_card_leaves_the_cycle_without_lessons(student, school, package):
    """Boundary → payment fails → grace window: the old wallet stays (here
    empty), no Transaction. The retry that goes through credits the cycle."""
    school.grace_period_days = 7
    school.save(update_fields=["grace_period_days"])
    old_end = timezone.now() + timedelta(hours=1)
    sp = _sub_package(student, school, package, status="exhausted", credits=0, period_end=old_end)
    new_end = old_end + timedelta(days=30)
    _sync(sp.stripe_subscription_id, new_end)
    assert handle_event({"type": "invoice.payment_failed", "data": {"object": {"id": "in_fail", "subscription": sp.stripe_subscription_id}}}) \
        == "grace_period_started"
    assert _sync(sp.stripe_subscription_id, new_end, status="past_due") == "package_update_unpaid"
    sp.refresh_from_db()
    assert sp.status == "exhausted" and sp.credits_remaining == 0
    assert abs((sp.expires_at - (new_end + timedelta(days=7))).total_seconds()) < 2  # the grace window survives
    assert not _renewal_txs(student).exists()

    _sync(sp.stripe_subscription_id, new_end, status="active")
    assert _paid(sp.stripe_subscription_id, new_end, invoice_id="in_fail") == "package_renewed"
    sp.refresh_from_db()
    assert sp.status == "active" and sp.credits_remaining == 5
    assert abs((sp.expires_at - new_end).total_seconds()) < 2  # back from end + grace to the paid period
    assert _renewal_txs(student).count() == 1


def test_a_redelivered_paid_invoice_does_not_refill_a_wallet_in_use(student, school, package):
    old_end = timezone.now() + timedelta(hours=1)
    sp = _sub_package(student, school, package, status="exhausted", credits=0, period_end=old_end)
    new_end = old_end + timedelta(days=30)
    assert _paid(sp.stripe_subscription_id, new_end, invoice_id="in_once") == "package_renewed"
    StudentPackage.objects.filter(pk=sp.pk).update(credits_remaining=4)  # one lesson booked since

    assert _paid(sp.stripe_subscription_id, new_end, invoice_id="in_once", etype="invoice.paid") == "already_processed"
    sp.refresh_from_db()
    assert sp.credits_remaining == 4 and _renewal_txs(student).count() == 1


def test_the_first_invoice_is_the_activation_not_a_renewal(student, school, package):
    end = timezone.now() + timedelta(days=30)
    sp = _sub_package(student, school, package, status="active", credits=3, period_end=end)
    assert _paid(sp.stripe_subscription_id, end, reason="subscription_create") == "not_a_renewal_invoice"
    sp.refresh_from_db()
    assert sp.credits_remaining == 3 and not _renewal_txs(student).exists()


def test_a_cycle_credited_by_the_old_handler_is_not_credited_twice(student, school, package):
    """Deploy mid-cycle: the pre-2026-11-07 `updated` handler already wrote
    the Transaction keyed on the period end; the paid invoice of the same
    period must not refill again."""
    end = timezone.now() + timedelta(days=30)
    sp = _sub_package(student, school, package, status="active", credits=3, period_end=end)
    Transaction.objects.create(
        school=school, student=student, type=Transaction.Type.SUBSCRIPTION, product_id=package.id,
        stripe_payment_id=f"{sp.stripe_subscription_id}:renewal:{int(end.timestamp())}",
        amount=Decimal("59.00"), currency="eur", payment_method="stripe", status="completed",
    )
    assert _paid(sp.stripe_subscription_id, end) == "already_processed"
    sp.refresh_from_db()
    assert sp.credits_remaining == 3 and _renewal_txs(student).count() == 1


def test_renewal_does_not_resurrect_a_package_the_school_deleted(student, school, package):
    old_end = timezone.now() + timedelta(hours=1)
    sp = _sub_package(student, school, package, status="deleted", credits=3, period_end=old_end)
    assert _paid(sp.stripe_subscription_id, old_end + timedelta(days=30)) == "package_renewed"
    sp.refresh_from_db()
    assert sp.status == "deleted"
    assert _renewal_txs(student).count() == 1  # the money was charged: Payments must show it


def test_renewal_without_its_catalog_package_still_refills_the_wallet(student, school, package):
    """The school deleted the catalog row (SET_NULL) while the subscription
    bills on: the wallet is refilled from its own total and reactivated,
    the Transaction amount comes from the invoice."""
    old_end = timezone.now() + timedelta(hours=1)
    sp = _sub_package(student, school, package, status="exhausted", credits=0, period_end=old_end)
    package.delete()
    sp.refresh_from_db()
    assert sp.package_id is None

    assert _paid(sp.stripe_subscription_id, old_end + timedelta(days=30), cents=4900) == "package_renewed"
    sp.refresh_from_db()
    assert sp.status == "active" and sp.credits_remaining == 5 and sp.credits_total == 5
    assert _renewal_txs(student).get().amount == Decimal("49.00")


def test_a_non_renewal_update_keeps_a_buy_ahead_window(student, school, package):
    """starts_at set: the paid window is the student's, not Stripe's cycle.
    The boundary sync moves the renewal date only."""
    now = timezone.now()
    sp = _sub_package(student, school, package, status="active", credits=5, period_end=now + timedelta(days=20))
    StudentPackage.objects.filter(pk=sp.pk).update(starts_at=now + timedelta(days=7), expires_at=now + timedelta(days=37))

    assert _sync(sp.stripe_subscription_id, now + timedelta(days=50)) == "package_dates_synced"
    sp.refresh_from_db()
    assert abs((sp.expires_at - (now + timedelta(days=37))).total_seconds()) < 2
    assert abs((sp.next_renewal_at - (now + timedelta(days=50))).total_seconds()) < 2


def test_a_stale_update_after_cancellation_writes_no_dates_back(student, school, package):
    old_end = timezone.now() + timedelta(hours=1)
    sp = _sub_package(student, school, package, status="active", credits=2, period_end=old_end)
    assert handle_event({"type": "customer.subscription.deleted", "data": {"object": {"id": sp.stripe_subscription_id}}}) \
        == "package_subscription_cancelled"
    assert _sync(sp.stripe_subscription_id, old_end + timedelta(days=30)) == "package_cancelled"
    sp.refresh_from_db()
    assert sp.next_renewal_at is None and sp.credits_remaining == 2
    assert abs((sp.expires_at - old_end).total_seconds()) < 2


def test_subscription_id_and_period_end_are_read_from_newer_stripe_payloads(student, school, package):
    old_end = timezone.now() + timedelta(hours=1)
    sp = _sub_package(student, school, package, status="exhausted", credits=0, period_end=old_end)
    new_end = old_end + timedelta(days=30)
    assert handle_event({"type": "customer.subscription.updated", "data": {"object": {
        "id": sp.stripe_subscription_id, "status": "active",
        "items": {"data": [{"current_period_end": int(new_end.timestamp())}]},
    }}}) == "package_dates_synced"
    assert handle_event({"type": "invoice.paid", "data": {"object": {
        "id": "in_basil", "billing_reason": "subscription_cycle", "amount_paid": 5900,
        "parent": {"subscription_details": {"subscription": sp.stripe_subscription_id}},
        "lines": {"data": [{"period": {"end": int(new_end.timestamp())}}]},
    }}}) == "package_renewed"
    sp.refresh_from_db()
    assert sp.status == "active" and sp.credits_remaining == 5
    assert abs((sp.expires_at - new_end).total_seconds()) < 2


def test_reactivation_helper_keeps_the_low_credits_flag(student, school, package):
    """A refund under the threshold reactivates but must not re-arm the
    warning (SCH-R3-12); only a renewal clears the flag."""
    sent = timezone.now()
    sp = _sub_package(student, school, package, status="exhausted", credits=1, period_end=sent + timedelta(days=10))
    assert StudentPackage.reactivate_if_refilled(pk=sp.pk) == 1
    sp.refresh_from_db()
    assert sp.status == "active" and sp.credits_low_sent_at is not None


def test_repair_command_lists_then_fixes_only_the_renewed_exhausted_rows(student, school, package):
    now = timezone.now()
    hit = _sub_package(student, school, package, status="exhausted", credits=5, period_end=now + timedelta(days=27))
    still_empty = _sub_package(student, school, package, status="exhausted", credits=0, period_end=now + timedelta(days=27))
    window_over = _sub_package(student, school, package, status="exhausted", credits=5, period_end=now - timedelta(days=1))
    deleted = _sub_package(student, school, package, status="deleted", credits=5, period_end=now + timedelta(days=27))
    one_off = StudentPackage.objects.create(
        student=student, school=school, package=package, status="exhausted",
        credits_total=5, credits_remaining=5, expires_at=now + timedelta(days=27), payment_method="cash",
    )
    no_expiry = _sub_package(student, school, package, status="exhausted", credits=5, period_end=None)

    out = StringIO()
    call_command("repair_renewed_packages", stdout=out)
    text = out.getvalue()
    assert "2 row(s) would be set active" in text
    assert text.count(student.user.email) == 3  # two to fix (one without expiry), one whose window is over
    assert "window over, not changed" in text and "Abbonamento Mensile 5 Lezioni Zoom" in text
    assert StudentPackage.objects.get(pk=hit.pk).status == "exhausted"  # list only

    out = StringIO()
    call_command("repair_renewed_packages", "--apply", stdout=out)
    assert "2 row(s) set active" in out.getvalue()
    hit.refresh_from_db()
    no_expiry.refresh_from_db()
    assert hit.status == "active" and hit.credits_low_sent_at is None
    assert no_expiry.status == "active"
    for sp in (still_empty, window_over, deleted, one_off):
        sp.refresh_from_db()
    assert still_empty.status == "exhausted" and window_over.status == "exhausted"
    assert deleted.status == "deleted" and one_off.status == "exhausted"

    out = StringIO()
    call_command("repair_renewed_packages", stdout=out)
    assert "nothing to repair" in out.getvalue()
