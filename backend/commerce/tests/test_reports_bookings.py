"""The Reports page's Bookings tab (GET /api/school/reports/bookings/): one
row per booking made at the school, newest first, with the student and the
lesson. Cancellations keep their row and say whether the credit came back."""
import uuid
from datetime import date, datetime, time, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from bookings.models import Booking
from bookings.services import book_lesson, cancel_booking
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolStudent
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()
URL = "/api/school/reports/bookings/"


def _school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome", cancellation_policy_hours=24,
    )


def _student(school, name):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name=name, school=school)
    SchoolStudent.objects.create(school=school, student=student)
    pkg = Package.objects.create(school=school, credits=Decimal("10.0"), name_it="Dieci lezioni", name_en="Ten lessons")
    StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=Decimal("10.0"), credits_remaining=Decimal("10.0"),
        expires_at=datetime(2028, 1, 1, tzinfo=dt_timezone.utc),
    )
    return student


def _lesson(school, day, course_name=""):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre", name_it="Sbarra")
    course = Course.objects.create(school=school, lesson_type=lt, name=course_name, credit_cost=Decimal("1.5"), min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt, date=day, start_time=time(12, 0), end_time=time(13, 0),
        max_capacity=10, status="scheduled",
    )


def _hq_client():
    hq = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role="hq", roles=["hq"])
    client = APIClient()
    client.force_authenticate(hq)
    return client


def test_rows_newest_first_with_student_and_lesson():
    school = _school()
    anna, bea = _student(school, "Anna"), _student(school, "Bea")
    first = _lesson(school, date(2027, 12, 1), course_name="Classico base")
    second = _lesson(school, date(2027, 12, 2))
    b1 = book_lesson(anna, first, now=datetime(2027, 11, 1, 9, 0, tzinfo=dt_timezone.utc))
    b2 = book_lesson(bea, second, now=datetime(2027, 11, 2, 9, 0, tzinfo=dt_timezone.utc))
    cancel_booking(b2, now=datetime(2027, 11, 20, tzinfo=dt_timezone.utc))  # inside the policy: refunded

    # someone else's school never shows up
    other = _school()
    book_lesson(_student(other, "Zoe"), _lesson(other, date(2027, 12, 5)), now=datetime(2027, 11, 3, tzinfo=dt_timezone.utc))

    res = _hq_client().get(URL, {"school": str(school.id)})
    assert res.status_code == 200, res.content
    rows = res.json()["rows"]
    assert [r["id"] for r in rows] == [str(b2.id), str(b1.id)]

    cancelled, kept = rows
    assert kept["student_name"] == "Anna" and kept["course_name"] == "Classico base"
    assert kept["lesson_date"] == "2027-12-01" and kept["start_time"] == "12:00:00"
    assert kept["status"] == Booking.Status.CONFIRMED and kept["access_source"] == "package"
    assert Decimal(kept["credits_deducted"]) == Decimal("1.5")
    # the package that paid: its id opens the usage modal, its name replaces "Package"
    assert kept["student_package_id"] == str(anna.packages.get().id)
    assert kept["package_name"] == {"name_en": "Ten lessons", "name_it": "Dieci lezioni", "name_fr": "", "name_es": ""}

    assert cancelled["student_name"] == "Bea" and cancelled["course_name"] == ""
    assert cancelled["lesson_type"] == {"name_en": "Barre", "name_it": "Sbarra", "name_fr": "", "name_es": ""}
    assert cancelled["status"] == Booking.Status.CANCELLED
    assert cancelled["cancellation_type"] == Booking.CancellationType.WITHIN_POLICY and cancelled["credit_refunded"] is True
    assert cancelled["cancelled_at"] is not None


def test_school_admin_sees_her_own_school():
    school = _school()
    anna = _student(school, "Anna")
    book_lesson(anna, _lesson(school, date(2027, 12, 1)), now=datetime(2027, 11, 1, tzinfo=dt_timezone.utc))
    admin = User.objects.create(email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role="school", roles=["school"], active_school=school)
    client = APIClient()
    client.force_authenticate(admin)
    res = client.get(URL)
    assert res.status_code == 200, res.content
    assert len(res.json()["rows"]) == 1
