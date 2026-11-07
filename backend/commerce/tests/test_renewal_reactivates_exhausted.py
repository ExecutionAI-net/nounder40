"""A Stripe renewal of a recurring package that was `exhausted` (every lesson
of the cycle used) must bring it back to `active`: the roster, the balance
and the booking engine only read active rows, and the student has just paid
(Roberta, 2026-11-04). `deleted` is the school's decision and stays."""
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
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


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


def _renew(sub_id, new_end):
    return handle_event({"type": "customer.subscription.updated", "data": {"object": {
        "id": sub_id, "status": "active", "current_period_end": int(new_end.timestamp()),
    }}})


def test_renewal_brings_an_exhausted_package_back_to_active(student, school, package):
    old_end = timezone.now() + timedelta(hours=1)
    sp = _sub_package(student, school, package, status="exhausted", credits=0, period_end=old_end)
    new_end = old_end + timedelta(days=30)

    assert _renew(sp.stripe_subscription_id, new_end) == "package_renewed"
    sp.refresh_from_db()
    assert sp.status == "active"
    assert sp.credits_remaining == 5 and sp.credits_total == 5
    assert sp.credits_low_sent_at is None
    assert abs((sp.expires_at - new_end).total_seconds()) < 2
    assert Transaction.objects.filter(student=student, type=Transaction.Type.SUBSCRIPTION).count() == 1


def test_renewal_does_not_resurrect_a_package_the_school_deleted(student, school, package):
    old_end = timezone.now() + timedelta(hours=1)
    sp = _sub_package(student, school, package, status="deleted", credits=3, period_end=old_end)
    _renew(sp.stripe_subscription_id, old_end + timedelta(days=30))
    sp.refresh_from_db()
    assert sp.status == "deleted"


def test_an_update_that_is_not_a_renewal_leaves_the_status_alone(student, school, package):
    end = timezone.now() + timedelta(days=10)
    sp = _sub_package(student, school, package, status="exhausted", credits=0, period_end=end)
    assert _renew(sp.stripe_subscription_id, end) == "package_updated"
    sp.refresh_from_db()
    assert sp.status == "exhausted" and sp.credits_remaining == 0


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

    out = StringIO()
    call_command("repair_renewed_packages", stdout=out)
    assert "1 row(s) would be set active" in out.getvalue()
    assert student.user.email in out.getvalue()
    assert StudentPackage.objects.get(pk=hit.pk).status == "exhausted"  # list only

    out = StringIO()
    call_command("repair_renewed_packages", "--apply", stdout=out)
    assert "1 row(s) set active" in out.getvalue()
    hit.refresh_from_db()
    assert hit.status == "active" and hit.credits_low_sent_at is None
    for sp in (still_empty, window_over, deleted, one_off):
        sp.refresh_from_db()
    assert still_empty.status == "exhausted" and window_over.status == "exhausted"
    assert deleted.status == "deleted" and one_off.status == "exhausted"

    out = StringIO()
    call_command("repair_renewed_packages", stdout=out)
    assert "nothing to repair" in out.getvalue()
