"""R4-H2 / ST-R4-01 (QA_REGRESSION_ROUND4_STUDENT.md): `DELETE
/api/school/lessons/<id>/` on a booked class cascaded the students' bookings
away — the deducted credit was never refunded, no cancellation e-mail went
out, and nothing was left in the student's history. The `classes/` endpoint
the UI uses cancels with refunds; the plain `lessons` viewset hard-deleted.

A lesson that has bookings (any status: cancelled rows are history and feed
the counters) is now refused with 409 and pointed at the `classes/` path; a
lesson nobody ever booked still deletes as before.
"""
import uuid
from datetime import date, datetime, time, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from bookings.models import Booking
from bookings.services import book_lesson, cancel_booking
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolMembership, SchoolStudent
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()

NOW = datetime(2027, 4, 1, tzinfo=dt_timezone.utc)


@pytest.fixture
def school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        timezone="Europe/Rome", cancellation_policy_hours=24,
    )


@pytest.fixture
def owner_client(school):
    user = User.objects.create(
        email=f"own-{uuid.uuid4().hex[:8]}@example.com", role="school", roles=["school"], active_school=school,
    )
    SchoolMembership.objects.create(school=school, profile=user, sub_role="owner")
    client = APIClient()
    client.force_authenticate(user)
    return client


def _lesson(school):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(
        school=school, lesson_type=lt, credit_cost=Decimal("1.0"), min_booking_notice_hours=0
    )
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt,
        date=date(2027, 5, 10), start_time=time(12, 0), end_time=time(13, 0),
        max_capacity=10, status="scheduled",
    )


def _student_with_credits(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna", school=school)
    SchoolStudent.objects.create(school=school, student=student)
    pkg = Package.objects.create(school=school, credits=Decimal("10.0"))
    sp = StudentPackage.objects.create(
        student=student, school=school, package=pkg,
        credits_total=Decimal("10.0"), credits_remaining=Decimal("10.0"),
        expires_at=datetime(2028, 1, 1, tzinfo=dt_timezone.utc),
    )
    return student, sp


def test_deleting_a_booked_lesson_is_refused_and_keeps_the_booking_and_credit(school, owner_client):
    lesson = _lesson(school)
    student, sp = _student_with_credits(school)
    booking = book_lesson(student, lesson, now=NOW)
    sp.refresh_from_db()
    assert sp.credits_remaining == Decimal("9.0")

    resp = owner_client.delete(f"/api/school/lessons/{lesson.pk}/")

    assert resp.status_code == 409, resp.content
    body = resp.json()
    assert body["error"] == "lesson_has_bookings"
    assert body["confirmed"] == 1
    assert f"/api/school/classes/{lesson.pk}/" in body["hint"]
    assert Lesson.objects.filter(pk=lesson.pk).exists()
    booking.refresh_from_db()
    assert booking.status == Booking.Status.CONFIRMED
    sp.refresh_from_db()
    assert sp.credits_remaining == Decimal("9.0")  # neither burned by a cascade nor refunded here


def test_a_lesson_with_only_cancelled_bookings_is_history_and_still_not_deletable(school, owner_client):
    lesson = _lesson(school)
    student, _ = _student_with_credits(school)
    booking = book_lesson(student, lesson, now=NOW)
    cancel_booking(booking, now=NOW)

    resp = owner_client.delete(f"/api/school/lessons/{lesson.pk}/")

    assert resp.status_code == 409
    assert resp.json()["confirmed"] == 0
    assert Booking.objects.filter(pk=booking.pk).exists()


def test_a_lesson_nobody_booked_still_deletes(school, owner_client):
    lesson = _lesson(school)
    resp = owner_client.delete(f"/api/school/lessons/{lesson.pk}/")
    assert resp.status_code == 204, resp.content
    assert not Lesson.objects.filter(pk=lesson.pk).exists()


def test_the_classes_path_still_cancels_with_a_refund(school, owner_client):
    """The endpoint the UI uses keeps refunding — the 409 above sends
    callers here."""
    lesson = _lesson(school)
    student, sp = _student_with_credits(school)
    book_lesson(student, lesson, now=NOW)

    resp = owner_client.delete(f"/api/school/classes/{lesson.pk}/")

    assert resp.status_code == 200, resp.content
    assert resp.json() == {"cancelled": True, "refunded": 1}
    sp.refresh_from_db()
    assert sp.credits_remaining == Decimal("10.0")
