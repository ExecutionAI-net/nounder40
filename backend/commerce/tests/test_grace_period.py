"""School.grace_period_days on a recurring package: a failed renewal keeps
the credits usable for those days instead of cutting the student off."""
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


def _event(sub_id):
    return {"type": "invoice.payment_failed", "data": {"object": {"id": "in_1", "subscription": sub_id}}}


def test_failed_renewal_extends_the_package_by_the_grace_period():
    school = School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", grace_period_days=7)
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna", school=school)
    package = Package.objects.create(school=school, credits=10, is_recurring=True)
    renewal = timezone.now() - timedelta(hours=1)  # the charge that just failed
    sp = StudentPackage.objects.create(
        student=student, school=school, package=package, credits_total=10, credits_remaining=4,
        expires_at=renewal, next_renewal_at=renewal, stripe_subscription_id="sub_grace", status="active",
    )

    assert handle_event(_event("sub_grace")) == "grace_period_started"
    sp.refresh_from_db()
    assert abs((sp.expires_at - (renewal + timedelta(days=7))).total_seconds()) < 5

    # a second failure inside the grace window does not push it further
    assert handle_event(_event("sub_grace")) == "grace_period_already_granted"
    assert handle_event(_event("sub_unknown")) == "not_found"
