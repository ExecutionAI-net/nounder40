"""Regression test for QA_REGRESSION_ROUND2 SCH-R2-12 (R2-M8a).

`GET /api/school/reports/` summed `credits_deducted` over EVERY booking, so
a cancellation that gave the credit back still counted as a credit used
(live: 12.5 reported where 3.0 had really been consumed). The rule the whole
codebase already uses elsewhere — the detailed report and the weekly booking
cap — is: a booking counts as "used" unless it was cancelled AND refunded.
A burned credit (late cancellation outside the school policy, or a no-show)
WAS used and must keep counting.
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
from schools.models import School, SchoolStudent
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    # 24h policy: a cancellation more than 24h out refunds, closer burns.
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        timezone="Europe/Rome", cancellation_policy_hours=24,
    )


@pytest.fixture
def student(school):
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
def lessons(school):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(
        school=school, lesson_type=lt, credit_cost=Decimal("1.5"), min_booking_notice_hours=0
    )
    return [
        Lesson.objects.create(
            school=school, course=course, lesson_type=lt, date=day,
            start_time=time(12, 0), end_time=time(13, 0), max_capacity=10, status="scheduled",
        )
        for day in (date(2027, 12, 1), date(2027, 12, 2), date(2027, 12, 3))
    ]


def test_credits_used_counts_burned_credits_but_not_refunded_ones(school, student, lessons):
    kept, refunded, burned = lessons
    booked_at = datetime(2027, 11, 1, tzinfo=dt_timezone.utc)
    b_kept = book_lesson(student, kept, now=booked_at)
    b_refunded = book_lesson(student, refunded, now=booked_at)
    b_burned = book_lesson(student, burned, now=booked_at)
    assert b_kept.credits_deducted == Decimal("1.5")

    # Well inside the notice period -> credit back.
    cancel_booking(b_refunded, now=datetime(2027, 11, 20, tzinfo=dt_timezone.utc))
    # 12:00 Rome on 2027-12-03 is 11:00 UTC; this is ~15h before -> burns.
    cancel_booking(b_burned, now=datetime(2027, 12, 2, 20, 0, tzinfo=dt_timezone.utc))

    b_refunded.refresh_from_db()
    b_burned.refresh_from_db()
    assert (b_refunded.status, b_refunded.credit_refunded) == (Booking.Status.CANCELLED, True)
    assert (b_burned.status, b_burned.credit_refunded) == (Booking.Status.CANCELLED, False)
    assert b_burned.cancellation_type == Booking.CancellationType.OUTSIDE_POLICY

    hq = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role="hq", roles=["hq"])
    client = APIClient()
    client.force_authenticate(hq)
    response = client.get(f"/api/school/reports/?school={school.id}")

    assert response.status_code == 200
    # 3 bookings x 1.5 = 4.5 deducted, of which 1.5 came back:
    # kept 1.5 + burned 1.5 = 3.0 really used.
    assert Decimal(str(response.data["credits_used"])) == Decimal("3.0")
    assert response.data["bookings_total"] == 3
    assert response.data["bookings_cancelled"] == 2
