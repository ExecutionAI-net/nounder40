"""Buy-ahead purchases through the Stripe webhook handlers: the student pays
in full at purchase, the credit window opens when the current package expires
and runs one billing interval; renewals roll the shifted window forward by one
interval instead of snapping to Stripe's billing period.
"""
import uuid
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from catalog.models import Package
from commerce.webhooks import handle_event
from schools.models import School
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def student(school):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name="Stu", school=school)


@pytest.fixture
def package(school):
    return Package.objects.create(
        school=school, credits=8, is_recurring=True, recurring_interval="month", price=50
    )


def sub_event(etype, obj):
    return {"type": etype, "data": {"object": obj}}


def make_created(school, student, package, *, sub_id, period_end, starts_at=None):
    meta = {"kind": "package", "school_id": str(school.id),
            "student_id": str(student.id), "item_id": str(package.id)}
    if starts_at is not None:
        meta["starts_at"] = starts_at.isoformat()
    return handle_event(sub_event("customer.subscription.created", {
        "id": sub_id, "status": "active", "customer": "cus_1",
        "current_period_end": int(period_end.timestamp()),
        "metadata": meta,
    }))


def test_buy_ahead_creation_paid_now_window_shifted(school, student, package):
    # Bought Oct 2 (billing cycle: 2nd of the month), current package ends Oct 15.
    stripe_period_end = timezone.now() + timedelta(days=31)
    window_start = timezone.now() + timedelta(days=13)
    result = make_created(school, student, package, sub_id="sub_ahead",
                          period_end=stripe_period_end, starts_at=window_start)
    assert result == "recurring_package_activated"
    sp = StudentPackage.objects.get(stripe_subscription_id="sub_ahead")
    assert abs((sp.starts_at - window_start).total_seconds()) < 2
    # window runs one interval from its own start (Oct 15 → Nov 15-ish)…
    assert sp.expires_at > window_start + timedelta(days=27)
    # …while renewal detection follows Stripe's billing cycle (Nov 2)
    assert abs((sp.next_renewal_at - stripe_period_end).total_seconds()) < 2
    assert sp.credits_remaining == 8  # paid and granted immediately


def test_normal_creation_snaps_to_stripe_period(school, student, package):
    period_end = timezone.now() + timedelta(days=30)
    make_created(school, student, package, sub_id="sub_now", period_end=period_end)
    sp = StudentPackage.objects.get(stripe_subscription_id="sub_now")
    assert sp.starts_at is None
    assert abs((sp.expires_at - period_end).total_seconds()) < 2


def test_shifted_renewal_rolls_window_one_interval(school, student, package):
    stripe_period_end = timezone.now() + timedelta(days=31)
    window_start = timezone.now() + timedelta(days=13)
    make_created(school, student, package, sub_id="sub_roll",
                 period_end=stripe_period_end, starts_at=window_start)
    sp = StudentPackage.objects.get(stripe_subscription_id="sub_roll")
    first_window_end = sp.expires_at
    sp.credits_remaining = 3
    sp.save(update_fields=["credits_remaining"])

    # Stripe renews on its own cycle (Nov 2 → Dec 2).
    result = handle_event(sub_event("customer.subscription.updated", {
        "id": "sub_roll", "status": "active",
        "current_period_end": int((stripe_period_end + timedelta(days=30)).timestamp()),
    }))
    sp.refresh_from_db()
    assert result == "package_renewed"
    # window rolled Nov 15 → Dec 15-ish, NOT snapped to Stripe's Dec 2
    assert sp.expires_at > first_window_end + timedelta(days=27)
    assert sp.credits_remaining == 8  # new period, fresh credits


def test_normal_renewal_snaps_and_resets(school, student, package):
    period_end = timezone.now() + timedelta(days=1)
    make_created(school, student, package, sub_id="sub_norm", period_end=period_end)
    sp = StudentPackage.objects.get(stripe_subscription_id="sub_norm")
    sp.credits_remaining = 2
    sp.save(update_fields=["credits_remaining"])

    new_end = timezone.now() + timedelta(days=31)
    result = handle_event(sub_event("customer.subscription.updated", {
        "id": "sub_norm", "status": "active",
        "current_period_end": int(new_end.timestamp()),
    }))
    sp.refresh_from_db()
    assert result == "package_renewed"
    assert abs((sp.expires_at - new_end).total_seconds()) < 2
    assert sp.credits_remaining == 8


def test_cancellation_keeps_paid_window_usable(school, student, package):
    # Cancel lands on Stripe's cycle (the 2nd) but the shifted window is paid
    # through the 14th: credits must stay usable until the window's own end.
    stripe_period_end = timezone.now() - timedelta(hours=1)  # billing period just ended
    window_start = timezone.now() - timedelta(days=18)
    make_created(school, student, package, sub_id="sub_cancel",
                 period_end=stripe_period_end, starts_at=window_start)
    result = handle_event(sub_event("customer.subscription.deleted", {"id": "sub_cancel"}))
    sp = StudentPackage.objects.get(stripe_subscription_id="sub_cancel")
    assert result == "package_subscription_cancelled"
    assert sp.cancelled_at is not None
    assert sp.next_renewal_at is None
    assert sp.status == "active"  # window (start+1 month) is still in the future
    assert sp.expires_at > timezone.now()


def test_cancellation_after_window_end_expires(school, student, package):
    ended = timezone.now() - timedelta(days=40)
    make_created(school, student, package, sub_id="sub_dead",
                 period_end=timezone.now() - timedelta(days=35), starts_at=ended)
    handle_event(sub_event("customer.subscription.deleted", {"id": "sub_dead"}))
    sp = StudentPackage.objects.get(stripe_subscription_id="sub_dead")
    assert sp.status == "expired"


def test_one_time_month_validity_is_calendar_aware(school, student):
    # Carlo's example: bought Sep 15 with 3 months → valid through Dec 14
    # (window closes Dec 15, same day-of-month), not "90 days" (= Dec 13).
    from datetime import datetime, timezone as tz

    from dateutil.relativedelta import relativedelta

    months3 = Package.objects.create(
        school=school, credits=30, validity_days=3, validity_unit="months", price=300
    )
    starts = datetime(2026, 9, 15, 10, 0, tzinfo=tz.utc)
    handle_event(sub_event("payment_intent.succeeded", {
        "id": "pi_months", "amount": 30000,
        "metadata": {"kind": "package", "school_id": str(school.id),
                     "student_id": str(student.id), "item_id": str(months3.id),
                     "starts_at": starts.isoformat()},
    }))
    sp = StudentPackage.objects.get(stripe_payment_id="pi_months")
    assert sp.expires_at == starts + relativedelta(months=3)  # Dec 15 → last usable day Dec 14
    assert sp.expires_at.day == 15 and sp.expires_at.month == 12


def test_one_time_buy_ahead_window(school, student):
    onetime = Package.objects.create(school=school, credits=10, validity_days=30, price=100)
    starts = timezone.now() + timedelta(days=13)
    result = handle_event(sub_event("payment_intent.succeeded", {
        "id": "pi_1", "amount": 10000,
        "metadata": {"kind": "package", "school_id": str(school.id),
                     "student_id": str(student.id), "item_id": str(onetime.id),
                     "starts_at": starts.isoformat()},
    }))
    assert result == "package_activated"
    sp = StudentPackage.objects.get(stripe_payment_id="pi_1")
    assert abs((sp.starts_at - starts).total_seconds()) < 2
    assert abs((sp.expires_at - (starts + timedelta(days=30))).total_seconds()) < 2
