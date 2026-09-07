"""Regression test for QA_REGRESSION_ROUND2 ST-R2-08 (R2-M13).

`User.language_preference` (header language switch, `PATCH /api/auth/me/`)
and `Student.language_preference` (profile select, `PATCH
/api/student/profile/`) were two independent columns. They drifted — the live
repro read `es` on /auth/me/ and `it` on /student/profile/ — and the e-mails
split with them, because welcome/reset read the User row while
booking/purchase/no-show/credits-low read the Student one.

`accounts.signals` now mirrors the two around a single source of truth
(`User.language_preference`), so whichever door the language is changed from,
both endpoints and every e-mail resolve the same locale.
"""
import uuid
from datetime import date, time, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from students.models import Student

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def student():
    user = User.objects.create(
        email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role="student", roles=["student"],
        language_preference="en",
    )
    return Student.objects.create(user=user, name="Anna", language_preference="en")


def _fresh_client(student):
    """A request authenticated with a *reloaded* User row. The mirror writes
    with `.update()` (no post_save re-entry), so an in-memory instance the
    test is still holding does not see it — a real request never does, it
    loads the user from the token on every call.
    """
    api = APIClient()
    api.force_authenticate(User.objects.get(pk=student.user_id))
    return api


@pytest.fixture
def client(student):
    api = APIClient()
    api.force_authenticate(student.user)
    return api


def test_header_switch_also_moves_the_student_row(client, student):
    assert client.patch("/api/auth/me/", {"language_preference": "es"}, format="json").status_code == 200

    student.refresh_from_db()
    student.user.refresh_from_db()
    assert student.user.language_preference == "es"
    assert student.language_preference == "es"
    assert _fresh_client(student).get("/api/auth/me/").data["language_preference"] == "es"
    assert _fresh_client(student).get("/api/student/profile/").data["language_preference"] == "es"


def test_profile_select_also_moves_the_user_row(client, student):
    assert client.patch(
        "/api/student/profile/", {"language_preference": "it"}, format="json"
    ).status_code == 200

    student.refresh_from_db()
    student.user.refresh_from_db()
    assert student.language_preference == "it"
    assert student.user.language_preference == "it"
    assert _fresh_client(student).get("/api/auth/me/").data["language_preference"] == "it"
    assert _fresh_client(student).get("/api/student/profile/").data["language_preference"] == "it"


@pytest.mark.parametrize("path", ["/api/auth/me/", "/api/student/profile/"])
def test_unsupported_locale_is_rejected_on_both_write_paths(client, student, path):
    response = client.patch(path, {"language_preference": "xx"}, format="json")

    assert response.status_code == 400
    student.refresh_from_db()
    student.user.refresh_from_db()
    assert (student.language_preference, student.user.language_preference) == ("en", "en")


def _future_lesson(school):
    from catalog.models import Course, Lesson, LessonType

    lesson_type = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(
        school=school, lesson_type=lesson_type, credit_cost=Decimal("1.0"), min_booking_notice_hours=0
    )
    day = timezone.localdate() + timedelta(days=30)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type, date=day,
        start_time=time(16, 0), end_time=time(17, 0), max_capacity=10, status="scheduled",
    )


def test_booking_and_reset_emails_agree_after_a_header_switch(
    client, student, django_capture_on_commit_callbacks
):
    """The two e-mail families that used to disagree: the booking confirmation
    resolved the Student row, the password reset the User row."""
    from bookings.services import book_lesson
    from catalog.models import Package
    from schools.models import School, SchoolStudent
    from students.models import StudentPackage

    school = School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome"
    )
    student.school = school
    student.save(update_fields=["school"])
    SchoolStudent.objects.create(school=school, student=student)
    pkg = Package.objects.create(school=school, credits=Decimal("10.0"))
    StudentPackage.objects.create(
        student=student, school=school, package=pkg,
        credits_total=Decimal("10.0"), credits_remaining=Decimal("10.0"),
        expires_at=timezone.now() + timedelta(days=365),
    )

    # Header language switch only — the profile select is never touched.
    assert client.patch("/api/auth/me/", {"language_preference": "de"}, format="json").status_code == 200
    student.refresh_from_db()

    with patch("notifications.tasks.send_transactional_email_task.delay") as mock:
        with django_capture_on_commit_callbacks(execute=True):
            book_lesson(student, _future_lesson(school))
    booking_locales = {
        call.kwargs["locale"] for call in mock.call_args_list if call.kwargs["key"] == "booking_confirmed"
    }

    # The reset endpoint is IP-throttled (5/hour); the locale decision, not
    # the HTTP plumbing, is what this test is about, so call the view.
    from django.test import RequestFactory

    from accounts.views import password_reset_request_view

    cache.clear()  # the 5/hour throttle counts across the whole suite's "IP"
    request = RequestFactory().post(
        "/api/auth/password-reset/", {"email": student.user.email}, content_type="application/json"
    )
    with patch("notifications.tasks.send_transactional_email_task.delay") as mock:
        with django_capture_on_commit_callbacks(execute=True):
            reset_response = password_reset_request_view(request)
    assert reset_response.status_code == 200
    reset_locales = {call.kwargs["locale"] for call in mock.call_args_list}

    assert booking_locales == {"de"}
    assert reset_locales == {"de"}
