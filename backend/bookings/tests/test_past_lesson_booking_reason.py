"""QA TCH-R2-13 (L9): `assert_bookable` used to lump "this lesson already
happened" and "this lesson is in the future but inside the min-notice
window" into the same `min_notice` reason. A student trying to book a class
that had already run got the same "too late to book" message as one trying
to book 10 minutes before class start on a school with a 24h notice policy
-- misleading, since the two situations call for different UI copy ("this
already happened" vs "come back closer to the notice window... actually no,
still too late").

`assert_bookable` now raises the dedicated `lesson_already_started` reason
once the lesson's start datetime has passed, and reserves `min_notice` for a
lesson that is still genuinely in the future but inside
`min_booking_notice_hours`. This does not touch `_lesson_datetime()`'s
school-local-timezone handling (QA R2-H14, see
test_cancellation_policy_timezone.py) -- both reasons still compare against
the same tz-aware lesson start.
"""
import uuid
from datetime import date, datetime, time, timedelta, timezone as dt_timezone

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from bookings.services import BookingError, assert_bookable, book_lesson
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        timezone="Europe/Rome",
    )


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


def _lesson(school, *, days_offset, notice_hours=0):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(
        school=school, lesson_type=lt, credit_cost=1, min_booking_notice_hours=notice_hours,
    )
    lesson_date = date.today() + timedelta(days=days_offset)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt, date=lesson_date,
        start_time=time(10, 0), end_time=time(11, 0), max_capacity=10, status="scheduled",
    )


def test_past_lesson_raises_lesson_already_started(school, student):
    lesson = _lesson(school, days_offset=-1)

    with pytest.raises(BookingError) as exc:
        assert_bookable(student, lesson)

    assert str(exc.value) == "lesson_already_started"


def test_lesson_later_today_but_already_started_raises_lesson_already_started(school, student):
    # 2026-09-08 10:00 Europe/Rome (CEST, UTC+2) == 08:00 UTC; "now" a minute
    # later means the lesson has started even though it's still "today".
    lesson = _lesson(school, days_offset=0)
    lesson.date = date(2026, 9, 8)
    lesson.save(update_fields=["date"])
    now = datetime(2026, 9, 8, 8, 1, tzinfo=dt_timezone.utc)

    with pytest.raises(BookingError) as exc:
        assert_bookable(student, lesson, now=now)

    assert str(exc.value) == "lesson_already_started"


def test_future_lesson_within_notice_window_still_raises_min_notice(school, student):
    # A genuinely future lesson, but inside the course's 24h notice window,
    # must keep the original `min_notice` reason -- only the "already
    # happened" case gets the new one.
    lesson = _lesson(school, days_offset=0, notice_hours=24)
    lesson.date = date(2026, 9, 8)
    lesson.save(update_fields=["date"])
    now = datetime(2026, 9, 8, 7, 0, tzinfo=dt_timezone.utc)  # 1h before 08:00 UTC start

    with pytest.raises(BookingError) as exc:
        assert_bookable(student, lesson, now=now)

    assert str(exc.value) == "min_notice"


def test_future_lesson_outside_notice_window_is_bookable(school, student):
    lesson = _lesson(school, days_offset=7, notice_hours=24)

    booking = book_lesson(student, lesson)

    assert booking.credits_deducted == 1


def test_api_returns_lesson_already_started_for_past_lesson(school, student):
    lesson = _lesson(school, days_offset=-1)

    client = APIClient()
    client.force_authenticate(student.user)
    res = client.post("/api/bookings/", {"lesson": str(lesson.id)}, format="json")

    assert res.status_code == 400
    assert res.json() == {"error": "lesson_already_started"}
