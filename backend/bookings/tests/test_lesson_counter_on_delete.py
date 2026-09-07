"""Regression test for QA_REGRESSION_ROUND2 SCH-R2-11 (R2-M8b).

Deleting a student cascade-deletes her bookings, but nothing decremented
`Lesson.current_bookings`: the lesson kept advertising an occupied seat
forever ("current_bookings: 1, enrollments: []" in the live repro), which
also made `assert_bookable` refuse real students on a lesson that was in
fact empty. `bookings.signals.free_seat_on_booking_delete` closes the gap.
"""
import uuid
from datetime import date, datetime, time, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from bookings.models import Booking
from bookings.services import book_lesson, cancel_booking
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolStudent
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        timezone="Europe/Rome", cancellation_policy_hours=24,
    )


def make_student(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna", school=school)
    SchoolStudent.objects.create(school=school, student=student)
    pkg = Package.objects.create(school=school, credits=Decimal("10.0"))
    StudentPackage.objects.create(
        student=student, school=school, package=pkg,
        credits_total=Decimal("10.0"), credits_remaining=Decimal("10.0"),
        expires_at=datetime(2028, 1, 1, tzinfo=dt_timezone.utc),
    )
    return student, user


@pytest.fixture
def lesson(school):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(
        school=school, lesson_type=lt, credit_cost=Decimal("1.0"), min_booking_notice_hours=0
    )
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt,
        date=date(2027, 5, 10), start_time=time(12, 0), end_time=time(13, 0),
        max_capacity=10, status="scheduled",
    )


NOW = datetime(2027, 4, 1, tzinfo=dt_timezone.utc)


def test_deleting_the_student_frees_the_seat(school, lesson):
    student, user = make_student(school)
    book_lesson(student, lesson, now=NOW)
    lesson.refresh_from_db()
    assert lesson.current_bookings == 1

    user.delete()  # cascades onto Student and its bookings

    lesson.refresh_from_db()
    assert Booking.objects.filter(lesson=lesson).count() == 0
    assert lesson.current_bookings == 0


def test_deleting_an_already_cancelled_booking_does_not_double_decrement(school, lesson):
    kept, _ = make_student(school)
    leaving, leaving_user = make_student(school)
    book_lesson(kept, lesson, now=NOW)
    booking = book_lesson(leaving, lesson, now=NOW)
    lesson.refresh_from_db()
    assert lesson.current_bookings == 2

    # The seat is given back at cancellation time...
    cancel_booking(booking, now=NOW)
    lesson.refresh_from_db()
    assert lesson.current_bookings == 1

    # ...so the later hard delete of that same (cancelled) row must not take
    # a second seat off and start under-counting the student still booked.
    leaving_user.delete()
    lesson.refresh_from_db()
    assert lesson.current_bookings == 1
    assert Booking.objects.filter(lesson=lesson).exclude(status="cancelled").count() == 1
