"""Reports → Bookings and Reports → Packages tell WHO did it and WHAT paid:
`created_by` (the student herself, or the staff member who enrolled her),
`assigned_by` (the granter of a manual grant, else the student for a
Stripe purchase, else unknown), `package_is_drop_in` (a single-lesson
package is a source of its own) and `lessons` (1 when the booking cost
exactly what a lesson of its package costs today, else None and the
credits are shown)."""
import uuid
from datetime import date, datetime, time, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from bookings.services import book_lesson, staff_enrol
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolStudent
from students.models import ManualCreditGrant, Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()


def _school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome", cancellation_policy_hours=24,
    )


def _student(school, name="Anna"):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name=name, school=school)
    SchoolStudent.objects.create(school=school, student=student)
    return student


def _package(student, school, *, is_drop_in=False, payment_method="stripe", lesson_type=None):
    pkg = Package.objects.create(
        school=school, credits=Decimal("10.0"), name_en="Ten", is_drop_in=is_drop_in,
        allowed_lesson_types=[str(lesson_type.id)] if lesson_type else [],
    )
    return StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=Decimal("10.0"), credits_remaining=Decimal("10.0"),
        payment_method=payment_method, expires_at=datetime(2028, 1, 1, tzinfo=dt_timezone.utc),
    )


def _lesson(school, lesson_type=None, cost="1.5"):
    lt = lesson_type or LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(school=school, lesson_type=lt, credit_cost=Decimal(cost), min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt, date=date(2027, 6, 1), start_time=time(12, 0), end_time=time(13, 0),
        max_capacity=10, status="scheduled",
    ), course


def _hq_client():
    hq = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role="hq", roles=["hq"])
    client = APIClient()
    client.force_authenticate(hq)
    return client


def _bookings(school):
    res = _hq_client().get(f"/api/school/reports/bookings/?school={school.id}")
    assert res.status_code == 200, res.content
    return {r["id"]: r for r in res.json()["rows"]}


def test_bookings_tell_who_booked_the_single_lesson_source_and_the_lessons():
    school = _school()
    anna = _student(school)
    marta = User.objects.create(email="marta@example.com", first_name="Marta", last_name="Staff", role=Role.SCHOOL)
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    _package(anna, school, lesson_type=lt)  # covers Barre, whose only course costs 1.5
    first, course = _lesson(school, lesson_type=lt)
    second, _ = _lesson(school, lesson_type=lt)

    mine = book_lesson(anna, first, now=datetime(2027, 5, 1, tzinfo=dt_timezone.utc))
    theirs = staff_enrol(second, anna.id, actor=marta)

    rows = _bookings(school)
    assert rows[str(mine.id)]["created_by"] == {"name": "Anna", "is_student": True}
    assert rows[str(theirs.id)]["created_by"] == {"name": "Marta Staff", "is_student": False}
    assert rows[str(mine.id)]["package_is_drop_in"] is False
    # 1.5 credits on a package whose lesson costs 1.5 today: one lesson
    assert rows[str(mine.id)]["lessons"] == 1

    # The course got dearer since: the booking is no longer "one lesson at
    # today's cost", the table falls back to the credits
    course.credit_cost = Decimal("2.0")
    course.save(update_fields=["credit_cost"])
    assert _bookings(school)[str(mine.id)]["lessons"] is None


def test_a_drop_in_package_is_the_single_lesson_source():
    school = _school()
    anna = _student(school)
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    _package(anna, school, is_drop_in=True, lesson_type=lt)
    lesson, _ = _lesson(school, lesson_type=lt)

    booking = book_lesson(anna, lesson, now=datetime(2027, 5, 1, tzinfo=dt_timezone.utc))

    row = _bookings(school)[str(booking.id)]
    assert row["access_source"] == "package" and row["package_is_drop_in"] is True


def test_packages_tell_who_put_them_in_the_wallet():
    school = _school()
    anna = _student(school)
    marta = User.objects.create(email="marta@example.com", first_name="Marta", last_name="Staff", role=Role.SCHOOL)
    bought = _package(anna, school, payment_method="stripe")
    # A manual grant: the grant row wins even though the column default is "stripe"
    granted = _package(anna, school, payment_method="stripe")
    ManualCreditGrant.objects.create(school=school, student=anna, package=granted, granted_by=marta, amount=Decimal("10.0"))
    # A row that came from nowhere we know (the ETL, an old admin path)
    unknown = _package(anna, school, payment_method="cash")

    res = _hq_client().get(f"/api/school/reports/packages/?school={school.id}")
    assert res.status_code == 200, res.content
    rows = {r["id"]: r for r in res.json()["rows"]}
    assert rows[str(bought.id)]["assigned_by"] == {"name": "Anna", "is_student": True}
    assert rows[str(granted.id)]["assigned_by"] == {"name": "Marta Staff", "is_student": False}
    assert rows[str(unknown.id)]["assigned_by"] is None
