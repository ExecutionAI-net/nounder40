"""Buy-ahead purchases through the Stripe webhook handlers: a trialing
recurring package opens its validity window at trial end, and the trial→active
transition must not reset credits already spent on pre-booked lessons.
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


def test_trialing_creation_sets_future_window(school, student, package):
    trial_end = timezone.now() + timedelta(days=9)
    result = handle_event(sub_event("customer.subscription.created", {
        "id": "sub_ahead", "status": "trialing", "customer": "cus_1",
        "current_period_end": int(trial_end.timestamp()),
        "metadata": {"kind": "package", "school_id": str(school.id),
                     "student_id": str(student.id), "item_id": str(package.id)},
    }))
    assert result == "recurring_package_activated"
    sp = StudentPackage.objects.get(stripe_subscription_id="sub_ahead")
    assert sp.starts_at is not None
    assert abs((sp.starts_at - trial_end).total_seconds()) < 2
    # expires one interval AFTER the window opens, not at trial end
    assert sp.expires_at > sp.starts_at + timedelta(days=27)
    assert sp.credits_remaining == 8


def test_active_creation_has_no_start_gate(school, student, package):
    period_end = timezone.now() + timedelta(days=30)
    handle_event(sub_event("customer.subscription.created", {
        "id": "sub_now", "status": "active", "customer": "cus_1",
        "current_period_end": int(period_end.timestamp()),
        "metadata": {"kind": "package", "school_id": str(school.id),
                     "student_id": str(student.id), "item_id": str(package.id)},
    }))
    sp = StudentPackage.objects.get(stripe_subscription_id="sub_now")
    assert sp.starts_at is None


def test_trial_to_active_does_not_reset_spent_credits(school, student, package):
    starts = timezone.now() + timedelta(days=9)
    handle_event(sub_event("customer.subscription.created", {
        "id": "sub_ahead2", "status": "trialing", "customer": "cus_1",
        "current_period_end": int(starts.timestamp()),
        "metadata": {"kind": "package", "school_id": str(school.id),
                     "student_id": str(student.id), "item_id": str(package.id)},
    }))
    sp = StudentPackage.objects.get(stripe_subscription_id="sub_ahead2")
    sp.credits_remaining = 5  # 3 credits already spent on pre-booked lessons
    sp.save(update_fields=["credits_remaining"])

    # First real invoice: period runs starts → starts + 1 month.
    result = handle_event(sub_event("customer.subscription.updated", {
        "id": "sub_ahead2", "status": "active",
        "current_period_start": int(starts.timestamp()),
        "current_period_end": int((starts + timedelta(days=31)).timestamp()),
    }))
    sp.refresh_from_db()
    assert result == "package_updated"  # not a renewal
    assert sp.credits_remaining == 5


def test_true_renewal_still_resets_credits(school, student, package):
    handle_event(sub_event("customer.subscription.created", {
        "id": "sub_ren", "status": "active", "customer": "cus_1",
        "current_period_end": int((timezone.now() + timedelta(days=1)).timestamp()),
        "metadata": {"kind": "package", "school_id": str(school.id),
                     "student_id": str(student.id), "item_id": str(package.id)},
    }))
    sp = StudentPackage.objects.get(stripe_subscription_id="sub_ren")
    sp.credits_remaining = 2
    sp.save(update_fields=["credits_remaining"])

    result = handle_event(sub_event("customer.subscription.updated", {
        "id": "sub_ren", "status": "active",
        "current_period_start": int((timezone.now() + timedelta(days=1)).timestamp()),
        "current_period_end": int((timezone.now() + timedelta(days=32)).timestamp()),
    }))
    sp.refresh_from_db()
    assert result == "package_renewed"
    assert sp.credits_remaining == 8
