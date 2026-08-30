"""Daily "package_expiring" reminder, N days before expiry (HQ setting)."""
import uuid
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from catalog.models import Package
from notifications.models import EmailSetting
from notifications.tasks import package_expiring_task
from schools.models import School
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db


def _package(student, school, *, days, credits=3, recurring=False):
    pkg = Package.objects.create(school=school, credits=10, name_en="Ten", is_recurring=recurring)
    return StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=10, credits_remaining=credits,
        expires_at=timezone.now() + timedelta(days=days, hours=1),
    )


def test_reminder_goes_out_only_in_the_window(settings):
    school = School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna Bo", school=school, language_preference="fr")
    EmailSetting.objects.create(key="expiry_reminder_days", value="10")
    _package(student, school, days=10)                    # in the window
    _package(student, school, days=3)                     # too close
    _package(student, school, days=10, credits=0)         # nothing left to use
    _package(student, school, days=10, recurring=True)    # renews by itself

    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed:
        assert package_expiring_task() == 1
    kwargs = delayed.call_args.kwargs
    assert kwargs["key"] == "package_expiring" and kwargs["locale"] == "fr"
    assert kwargs["context"]["days"] == "10" and kwargs["context"]["credits_remaining"] == "3"
