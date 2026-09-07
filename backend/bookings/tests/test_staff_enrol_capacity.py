"""Regression test for QA_REGRESSION_ROUND2 R2-M12.

`staff_enrol()` documented "no capacity checks": a 2-seat lesson reached 3/2
through the teacher's "add a student" action and the school's manual
enrolment, and nothing in the API or the UI said a word. The school is still
allowed to squeeze someone in — it now has to ask for it.
"""
import uuid
from datetime import date, datetime, time, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from bookings.services import BookingError, staff_enrol
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolStudent
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome"
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
    return student


@pytest.fixture
def lesson(school):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(
        school=school, lesson_type=lt, credit_cost=Decimal("1.5"), min_booking_notice_hours=0
    )
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt,
        date=date(2027, 6, 1), start_time=time(12, 0), end_time=time(13, 0),
        max_capacity=1, status="scheduled",
    )


def test_under_capacity_enrolment_is_unchanged(school, lesson):
    booking = staff_enrol(lesson, make_student(school).id)
    lesson.refresh_from_db()
    assert booking.credits_deducted == Decimal("1.5")
    assert booking.overbooked is False
    assert lesson.current_bookings == 1


def test_full_lesson_is_refused_without_the_explicit_flag(school, lesson):
    staff_enrol(lesson, make_student(school).id)
    lesson.refresh_from_db()
    second = make_student(school)

    with pytest.raises(BookingError) as exc:
        staff_enrol(lesson, second.id)
    assert str(exc.value) == "lesson_full"

    lesson.refresh_from_db()
    assert lesson.current_bookings == 1  # no seat and no credit moved
    assert StudentPackage.objects.get(student=second).credits_remaining == Decimal("10.0")


def test_overbooking_goes_through_when_asked_for_and_is_flagged(school, lesson):
    staff_enrol(lesson, make_student(school).id)
    lesson.refresh_from_db()
    second = make_student(school)

    booking = staff_enrol(lesson, second.id, allow_overbooking=True)

    assert booking.overbooked is True
    assert booking.credits_deducted == Decimal("1.5")
    lesson.refresh_from_db()
    assert lesson.current_bookings == 2 > lesson.max_capacity
