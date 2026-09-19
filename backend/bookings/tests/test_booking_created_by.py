"""Booking.created_by: who made the booking — the student herself through
book_lesson (the student-side views, the drop-in checkout), or the staff
member who enrolled her from the register through staff_enrol(actor=).
Reports → Bookings tells the school which of the two it was."""
import uuid
from datetime import date, datetime, time, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from accounts.models import Role
from bookings.services import book_lesson, staff_enrol
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolStudent
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()


def _school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome",
        cancellation_policy_hours=24,
    )


def _student(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna", school=school)
    SchoolStudent.objects.create(school=school, student=student)
    pkg = Package.objects.create(school=school, credits=Decimal("10.0"))
    StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=Decimal("10.0"), credits_remaining=Decimal("10.0"),
        expires_at=datetime(2028, 1, 1, tzinfo=dt_timezone.utc),
    )
    return student


def _lesson(school):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(school=school, lesson_type=lt, credit_cost=Decimal("1.5"), min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt, date=date(2027, 6, 1), start_time=time(12, 0), end_time=time(13, 0),
        max_capacity=10, status="scheduled",
    )


def test_the_student_booking_herself_is_the_creator():
    school = _school()
    anna = _student(school)

    booking = book_lesson(anna, _lesson(school), now=datetime(2027, 5, 1, tzinfo=dt_timezone.utc))

    assert booking.created_by_id == anna.user_id


def test_the_staff_member_enrolling_her_is_the_creator():
    school = _school()
    anna = _student(school)
    marta = User.objects.create(email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, active_school=school)

    booking = staff_enrol(_lesson(school), anna.id, actor=marta)

    assert booking.created_by_id == marta.id and booking.created_by_id != anna.user_id


def test_reports_tell_the_two_apart():
    from commerce.report_views import _actor

    school = _school()
    anna = _student(school)
    marta = User.objects.create(email="marta@example.com", first_name="Marta", last_name="Staff", role=Role.SCHOOL)

    assert _actor(anna.user, anna) == {"name": "Anna", "is_student": True}
    assert _actor(marta, anna) == {"name": "Marta Staff", "is_student": False}
    assert _actor(None, anna) is None  # a row older than the column
