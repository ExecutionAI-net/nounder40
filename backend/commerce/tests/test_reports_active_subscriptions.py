"""ST-R3-04: "Active subscriptions" counted the retired engine.

CLAUDE.md 4.1 has one engine: a subscription IS a recurring package. The
`student_subscriptions` table is the parallel mechanism 9 lists as legacy,
and nothing writes it any more — so the school dashboard card read 0 while
Payments and Reports on the same page showed that school's subscription
revenue (visible since PR #88).
"""
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from catalog.models import Package
from schools.models import School
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()

FAR = datetime(2030, 1, 1, tzinfo=dt_timezone.utc)


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


def _student(school, name="Anna"):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name=name, school=school)


def _package(school, *, recurring):
    return Package.objects.create(
        school=school, credits=Decimal("10.0"), name_en="P", is_recurring=recurring,
        recurring_interval="month" if recurring else "",
    )


def _held(school, package, **kwargs):
    defaults = dict(
        credits_total=Decimal("10.0"), credits_remaining=Decimal("10.0"),
        expires_at=FAR, status="active",
    )
    defaults.update(kwargs)
    return StudentPackage.objects.create(
        student=_student(school), school=school, package=package, **defaults,
    )


def _kpis(school):
    hq = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role="hq", roles=["hq"])
    client = APIClient()
    client.force_authenticate(hq)
    school_kpis = client.get(f"/api/school/reports/?school={school.id}")
    network_kpis = client.get("/api/hq/reports/")
    assert (school_kpis.status_code, network_kpis.status_code) == (200, 200)
    return school_kpis.data["active_subscriptions_count"], network_kpis.data["active_subscriptions"]


def test_a_recurring_package_is_an_active_subscription(school):
    recurring = _package(school, recurring=True)
    _held(school, recurring)
    _held(school, recurring)
    assert _kpis(school) == (2, 2)


def test_a_one_off_package_is_not(school):
    _held(school, _package(school, recurring=False))
    assert _kpis(school) == (0, 0)


def test_an_expired_or_exhausted_one_is_not(school):
    recurring = _package(school, recurring=True)
    _held(school, recurring, status="expired")
    _held(school, recurring, status="exhausted")
    assert _kpis(school) == (0, 0)


def test_a_cancelled_one_is_not_even_while_its_credits_still_work(school):
    """Stripe cancellation leaves the package usable to the end of the paid
    window (`_handle_subscription_deleted`) — still spendable, but it will
    not renew, so it is no longer an active subscription."""
    still_usable = _held(
        school, _package(school, recurring=True),
        cancelled_at=timezone.now(), expires_at=timezone.now() + timedelta(days=20),
    )
    assert still_usable.status == "active"
    assert _kpis(school) == (0, 0)


def test_another_school_does_not_count_towards_this_one(school):
    other = School.objects.create(name="O", slug=f"s-{uuid.uuid4().hex[:8]}", email="o@example.com")
    _held(school, _package(school, recurring=True))
    _held(other, _package(other, recurring=True))
    assert _kpis(school) == (1, 2)  # one here, both network-wide
