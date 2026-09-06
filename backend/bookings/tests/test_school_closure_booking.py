"""QA #8: SchoolClosure was recorded but never enforced anywhere. This covers
the booking side — a lesson that falls on (or within) an active closure must
reject new bookings with a clear error, even though the Lesson row itself is
still "scheduled" (we don't touch already-generated lessons/bookings when a
closure is added after the fact — see catalog.services.date_in_school_closure).
"""
import uuid
from datetime import date, time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from bookings.services import BookingError, book_lesson
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolClosure
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def student(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna", school=school)
    pkg = Package.objects.create(school=school, credits=10)
    StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=10, credits_remaining=10,
        expires_at=timezone.now() + timedelta(days=90),
    )
    return student


def _lesson(school, *, d):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(school=school, lesson_type=lt, credit_cost=1, min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt, date=d, start_time=time(10, 0), end_time=time(11, 0),
        max_capacity=10, status="scheduled",
    )


def test_booking_rejected_on_closure_date(school, student):
    d = date.today() + timedelta(days=7)
    SchoolClosure.objects.create(school=school, date=d)
    lesson = _lesson(school, d=d)

    with pytest.raises(BookingError) as exc:
        book_lesson(student, lesson)
    assert str(exc.value) == "school_closed"


def test_booking_rejected_within_closure_range(school, student):
    start = date.today() + timedelta(days=7)
    SchoolClosure.objects.create(school=school, date=start, end_date=start + timedelta(days=3))
    lesson = _lesson(school, d=start + timedelta(days=2))

    with pytest.raises(BookingError) as exc:
        book_lesson(student, lesson)
    assert str(exc.value) == "school_closed"


def test_booking_allowed_outside_closure(school, student):
    closed_day = date.today() + timedelta(days=7)
    SchoolClosure.objects.create(school=school, date=closed_day)
    lesson = _lesson(school, d=closed_day + timedelta(days=1))

    booking = book_lesson(student, lesson)
    assert booking.status == "confirmed"


def test_booking_rejected_via_api(school):
    from rest_framework.test import APIClient

    d = date.today() + timedelta(days=7)
    SchoolClosure.objects.create(school=school, date=d)
    lesson = _lesson(school, d=d)

    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    Student.objects.create(user=user, name="Anna", school=school)
    client = APIClient()
    client.force_authenticate(user)

    res = client.post("/api/bookings/", {"lesson": str(lesson.id)}, format="json")
    assert res.status_code == 400
    assert res.json()["error"] == "school_closed"
