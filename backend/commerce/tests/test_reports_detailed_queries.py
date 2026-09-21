"""GET /api/school/reports/detailed/ and /student-classes/: the students and
teachers tabs used to run ~7 queries per student and ~4 per teacher, so the
Reports page slowed down with the size of the school. These pin (a) the
numbers each row reports and (b) that the query count no longer grows with
the number of students/teachers."""
import uuid
from datetime import date, time
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from bookings.models import Attendance, Booking
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolStudent
from students.models import ManualCreditGrant, Student, StudentDocument, StudentPackage
from teachers.models import Teacher, TeacherSchool

pytestmark = pytest.mark.django_db
User = get_user_model()
DETAILED = "/api/school/reports/detailed/"
CLASSES = "/api/school/reports/student-classes/"
TODAY = date.today()


def _school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome", cancellation_policy_hours=24,
    )


def _client():
    hq = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role="hq", roles=["hq"])
    client = APIClient()
    client.force_authenticate(hq)
    return client


def _student(school, name, *, package_status="active", remaining="6.0"):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name=name, school=school)
    SchoolStudent.objects.create(school=school, student=student)
    pkg = Package.objects.create(school=school, credits=Decimal("10.0"), name_en="Ten", name_it="Dieci")
    StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=Decimal("10.0"),
        credits_remaining=Decimal(remaining), status=package_status,
    )
    return student


def _teacher(school, name):
    user = User.objects.create(email=f"t-{uuid.uuid4().hex[:8]}@example.com")
    teacher = Teacher.objects.create(user=user, name=name, email=user.email)
    TeacherSchool.objects.create(teacher=teacher, school=school, active=True)
    return teacher


def _lesson(school, teacher, day=TODAY, hour=10):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre", name_it="Sbarra")
    course = Course.objects.create(school=school, lesson_type=lt, credit_cost=Decimal("1.5"), min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt, teacher=teacher, date=day,
        start_time=time(hour, 0), end_time=time(hour + 1, 0), max_capacity=10, status="scheduled",
    )


def _attended(school, student, lesson, teacher, status="attended", credits="1.5"):
    b = Booking.objects.create(
        student=student, lesson=lesson, school=school, status=status, credits_deducted=Decimal(credits),
    )
    Attendance.objects.create(
        lesson=lesson, student=student, teacher=teacher, booking=b,
        status="present" if status == "attended" else "no_show",
    )
    return b


def test_student_and_teacher_rows_report_the_same_numbers():
    school = _school()
    teacher = _teacher(school, "Alina")
    anna = _student(school, "Anna", remaining="6.0")
    bea = _student(school, "Bea", package_status="expired", remaining="3.0")
    cleo = _student(school, "Cleo", remaining="2.0")

    l1 = _lesson(school, teacher, day=date(2020, 1, 10))
    l2 = _lesson(school, teacher, day=TODAY, hour=11)
    _attended(school, anna, l1, teacher)
    _attended(school, anna, l2, teacher)
    Booking.objects.create(student=bea, lesson=l2, school=school, status="confirmed", credits_deducted=Decimal("1.5"))
    _attended(school, cleo, l1, teacher, status="no_show", credits="1.5")
    ManualCreditGrant.objects.create(school=school, student=cleo, amount=Decimal("2.0"), kind="deduction")
    ManualCreditGrant.objects.create(school=school, student=cleo, amount=Decimal("0.5"), kind="reversal")
    StudentDocument.objects.create(student=anna, school=school, status="expired")

    res = _client().get(DETAILED, {"school": str(school.id)})
    assert res.status_code == 200, res.content
    body = res.json()
    students = {r["name"]: r for r in body["students"]["rows"]}

    assert Decimal(str(students["Anna"]["credits_remaining"])) == Decimal("6.0")
    assert Decimal(str(students["Anna"]["credits_burned"])) == Decimal("3.0")
    assert students["Anna"]["last_attendance"] == TODAY.isoformat()
    assert students["Anna"]["total_attended"] == 2
    assert students["Anna"]["has_active_package"] is True

    assert Decimal(str(students["Bea"]["credits_remaining"])) == 0
    assert Decimal(str(students["Bea"]["credits_burned"])) == 0  # confirmed booking is not burned
    assert students["Bea"]["last_attendance"] == "—"
    assert students["Bea"]["has_active_package"] is False

    # no-show burns 1.5, hand deduction 2.0 minus reversal 0.5
    assert Decimal(str(students["Cleo"]["credits_burned"])) == Decimal("3.0")
    assert students["Cleo"]["total_attended"] == 0

    assert body["students"]["total"] == 3
    assert body["students"]["docs_expired"] == 1
    # only students with an active package count towards the average: (6 + 2) / 2
    assert body["students"]["avg_credits"] == "4.0"

    (t,) = body["teachers"]["rows"]
    assert t["name"] == "Alina"
    assert t["lessons_this_month"] == 1
    assert t["total_students"] == 3
    # 2 present rows (Anna) out of 3 attendance rows
    assert t["attendance_rate"] == "66.7"


def _detailed_queries(school):
    client = _client()
    with CaptureQueriesContext(connection) as ctx:
        res = client.get(DETAILED, {"school": str(school.id)})
    assert res.status_code == 200, res.content
    return len(ctx)


def test_detailed_query_count_does_not_grow_with_students_or_teachers():
    school = _school()
    teacher = _teacher(school, "Alina")
    lesson = _lesson(school, teacher)
    for i in range(2):
        _attended(school, _student(school, f"S{i}"), lesson, teacher)
    small = _detailed_queries(school)

    for i in range(2, 8):
        _attended(school, _student(school, f"S{i}"), lesson, teacher)
        _teacher(school, f"T{i}")
    large = _detailed_queries(school)

    # monthly_compensation is still per teacher (a handful of teachers per
    # school); the per-student loop must be gone
    assert large - small <= 6 * 3, (small, large)


def test_student_classes_query_count_does_not_grow_with_students():
    school = _school()
    teacher = _teacher(school, "Alina")
    lesson = _lesson(school, teacher)
    client = _client()

    def count():
        with CaptureQueriesContext(connection) as ctx:
            res = client.get(CLASSES, {"school": str(school.id)})
        assert res.status_code == 200, res.content
        return len(ctx)

    for i in range(2):
        _attended(school, _student(school, f"S{i}"), lesson, teacher)
    small = count()
    for i in range(2, 10):
        _attended(school, _student(school, f"S{i}"), lesson, teacher)
    assert count() == small
