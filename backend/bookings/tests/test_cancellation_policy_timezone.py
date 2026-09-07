"""Regression test for QA_REGRESSION_ROUND2 R2-H14:

Cancellation-policy and min-notice decisions ran in UTC while lesson
date/start_time are the SCHOOL's own local wall-clock values. Django's
`TIME_ZONE` is "UTC", so `_lesson_datetime()` used to stamp a lesson stored as
"12:12" as 12:12 UTC — for a Rome school in CEST (UTC+2) that is 2 hours later
than the lesson the school and its students actually meant, which inflated
"hours until the lesson" and could refund a cancellation that should have
burned the credit (live repro: server said `within_policy` at what it
computed as 25.1h remaining, when the real Rome-local remaining time was
23.1h — under the school's 24h policy).

This reproduces the exact boundary from ST-R2-06 with an explicit `now`
(no reliance on wall-clock time when the suite happens to run): a lesson at
12:12 Rome-local time (CEST, UTC+2) on 2026-09-08, cancelled from a `now` that
is exactly 23 real hours before that Rome-local instant — under the school's
24h policy this must burn the credit (`outside_policy`), which only happens
once `_lesson_datetime()` stops treating "12:12" as 12:12 UTC (that
misinterpretation would put the lesson 2 hours "later", making it look like
25h remain — comfortably within policy, the live bug).
"""
import uuid
from datetime import date, datetime, time, timedelta, timezone as dt_timezone

import pytest
from django.contrib.auth import get_user_model

from bookings.models import Booking
from bookings.services import _lesson_datetime, book_lesson, cancel_booking
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        timezone="Europe/Rome", cancellation_policy_hours=24,
    )


@pytest.fixture
def student(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna", school=school)
    pkg = Package.objects.create(school=school, credits=10)
    StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=10, credits_remaining=10,
        expires_at=datetime(2027, 1, 1, tzinfo=dt_timezone.utc),
    )
    return student


@pytest.fixture
def lesson(school):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(school=school, lesson_type=lt, credit_cost=1, min_booking_notice_hours=0)
    # 2026-09-08 is CEST in Rome (UTC+2): wall-clock 12:12 Rome = 10:12 UTC.
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt,
        date=date(2026, 9, 8), start_time=time(12, 12), end_time=time(13, 12),
        max_capacity=10, status="scheduled",
    )


def test_lesson_datetime_uses_school_local_time_not_utc(lesson):
    aware = _lesson_datetime(lesson)
    # Correct: 12:12 CEST == 10:12 UTC. The pre-fix behaviour (Django's
    # TIME_ZONE="UTC" default) would have produced 12:12 UTC instead — 2h off.
    assert aware == datetime(2026, 9, 8, 10, 12, tzinfo=dt_timezone.utc)


def test_cancellation_at_23h_real_remaining_burns_not_refunds(school, student, lesson):
    """23 real hours before the lesson's true (Rome-local) start — under a 24h
    policy this must burn. The pre-fix UTC-literal interpretation put the
    lesson 2h "later" than it really is, making this look like 25h remaining
    (comfortably within policy) — a false refund, and money the school never
    actually owed back."""
    booking = book_lesson(student, lesson, now=datetime(2026, 9, 1, tzinfo=dt_timezone.utc))
    assert booking.credits_deducted == 1
    credits_after_booking = StudentPackage.objects.get(student=student).credits_remaining

    now = datetime(2026, 9, 7, 11, 12, tzinfo=dt_timezone.utc)  # exactly 23h before 10:12 UTC on the 8th
    cancelled = cancel_booking(booking, now=now)

    assert cancelled.cancellation_type == Booking.CancellationType.OUTSIDE_POLICY
    assert cancelled.credit_refunded is False
    sp = StudentPackage.objects.get(student=student)
    assert sp.credits_remaining == credits_after_booking  # NOT refunded


def test_cancellation_at_25h_real_remaining_refunds(school, student, lesson):
    """Symmetric check: 25 real hours before the true Rome-local start is
    genuinely within the 24h policy and must refund."""
    booking = book_lesson(student, lesson, now=datetime(2026, 9, 1, tzinfo=dt_timezone.utc))
    credits_after_booking = StudentPackage.objects.get(student=student).credits_remaining

    now = datetime(2026, 9, 7, 9, 12, tzinfo=dt_timezone.utc)  # exactly 25h before 10:12 UTC on the 8th
    cancelled = cancel_booking(booking, now=now)

    assert cancelled.cancellation_type == Booking.CancellationType.WITHIN_POLICY
    assert cancelled.credit_refunded is True
    sp = StudentPackage.objects.get(student=student)
    assert sp.credits_remaining == credits_after_booking + 1
