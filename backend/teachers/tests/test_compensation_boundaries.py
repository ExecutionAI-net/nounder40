"""QA full-regression C2/C3/C4: a lesson must not generate compensation or
count as "taught" before it has actually happened.

- C2: `TeacherCompensationOverviewView` (backs the actual /teacher/compensation
  page) had NO future-date exclusion at all — a lesson dated days ahead, with
  no student even booked, showed up with a real fee.
- C3: `monthly_compensation()` had been fixed once for lessons in a future
  *month*, but its clamp (`date__lte=min(end, date.today())`) compares dates
  only, so a lesson later THIS SAME day still leaked in.
- C4: `TeacherStatsView`'s "lessons_taught" used `date__lt=date.today()`
  (strictly before today), so a lesson that already happened earlier today
  wasn't counted as taught yet, even though it already has attendance and
  already generates compensation — disagreeing with Compensation on the same
  teacher, same day.

All three must key off the lesson's full start datetime
(`bookings.services._lesson_datetime(lesson) <= timezone.now()`), the same
boundary `TeacherAttendanceView.post()` already uses to gate attendance
marking.
"""
import uuid
from datetime import time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from catalog.models import Course, Lesson, LessonType
from schools.models import School
from teachers.models import CompensationPlan, Teacher, TeacherSchool
from teachers.services import monthly_compensation

pytestmark = pytest.mark.django_db


def _client(user):
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


@pytest.fixture
def school():
    return School.objects.create(name="Test School", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def lesson_type():
    return LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Flex")


@pytest.fixture
def teacher(school):
    user = get_user_model().objects.create(email=f"teach-{uuid.uuid4().hex[:8]}@example.com")
    teacher = Teacher.objects.create(user=user, name="Teach", email=user.email)
    TeacherSchool.objects.create(teacher=teacher, school=school, active=True)
    return teacher


@pytest.fixture
def plan(school):
    return CompensationPlan.objects.create(school=school, name="Base Plan", base_fee=20)


def make_lesson(school, lesson_type, teacher, plan, *, day, at=time(18, 0)):
    course = Course.objects.create(school=school, lesson_type=lesson_type, credit_cost=1, min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type, teacher=teacher, compensation_plan=plan,
        date=day, start_time=at, end_time=time((at.hour + 1) % 24, at.minute),
        max_capacity=10, current_bookings=0, status="scheduled",
    )


# ---- C2: TeacherCompensationOverviewView had no future-date exclusion ----

def test_compensation_overview_excludes_future_lesson(school, lesson_type, teacher, plan):
    future_day = timezone.localdate() + timedelta(days=14)
    make_lesson(school, lesson_type, teacher, plan, day=future_day)

    resp = _client(teacher.user).get(f"/api/teacher/compensation-overview/?month={future_day.strftime('%Y-%m')}")

    assert resp.status_code == 200
    body = resp.json()
    for entry in body["entries"]:
        lesson_dates = [row["date"] for row in entry["lessons"]]
        assert future_day.isoformat() not in lesson_dates
        assert entry["total"] == 0.0


def test_monthly_compensation_excludes_future_lesson(school, lesson_type, teacher, plan):
    future_day = timezone.localdate() + timedelta(days=14)
    lesson = make_lesson(school, lesson_type, teacher, plan, day=future_day)

    comp = monthly_compensation(teacher, school, future_day.strftime("%Y-%m"))

    assert str(lesson.id) not in [row["lesson_id"] for row in comp["breakdown"]]
    assert comp["total"] == 0.0


# ---- C3: monthly_compensation()'s date-only clamp let "later today" leak in ----

def test_monthly_compensation_excludes_lesson_later_today(school, lesson_type, teacher, plan):
    now = timezone.localtime()
    later_today = (now + timedelta(hours=3)).time()
    if later_today <= now.time():
        pytest.skip("test run too close to midnight for a same-day 'later' lesson")
    lesson = make_lesson(school, lesson_type, teacher, plan, day=now.date(), at=later_today)

    comp = monthly_compensation(teacher, school, now.strftime("%Y-%m"))

    assert str(lesson.id) not in [row["lesson_id"] for row in comp["breakdown"]]
    assert comp["total"] == 0.0


def test_monthly_compensation_includes_lesson_earlier_today(school, lesson_type, teacher, plan):
    """Control case: a lesson that already happened today must still count —
    the fix must not overcorrect into excluding all of today."""
    now = timezone.localtime()
    earlier_today = (now - timedelta(hours=1)).time()
    if earlier_today >= now.time():
        pytest.skip("test run too close to midnight for a same-day 'earlier' lesson")
    lesson = make_lesson(school, lesson_type, teacher, plan, day=now.date(), at=earlier_today)

    comp = monthly_compensation(teacher, school, now.strftime("%Y-%m"))

    assert str(lesson.id) in [row["lesson_id"] for row in comp["breakdown"]]
    assert comp["total"] == 20.0


# ---- C4: "lessons_taught" must agree with what compensation is already paying for ----

def test_stats_counts_lesson_from_earlier_today_as_taught(school, lesson_type, teacher, plan):
    now = timezone.localtime()
    earlier_today = (now - timedelta(hours=1)).time()
    if earlier_today >= now.time():
        pytest.skip("test run too close to midnight for a same-day 'earlier' lesson")
    make_lesson(school, lesson_type, teacher, plan, day=now.date(), at=earlier_today)

    resp = _client(teacher.user).get("/api/teacher/stats/")

    assert resp.status_code == 200
    assert resp.json()["lessons_taught"] == 1
    assert resp.json()["lessons_upcoming"] == 0


def test_stats_does_not_count_lesson_later_today_as_taught(school, lesson_type, teacher, plan):
    now = timezone.localtime()
    later_today = (now + timedelta(hours=3)).time()
    if later_today <= now.time():
        pytest.skip("test run too close to midnight for a same-day 'later' lesson")
    make_lesson(school, lesson_type, teacher, plan, day=now.date(), at=later_today)

    resp = _client(teacher.user).get("/api/teacher/stats/")

    assert resp.status_code == 200
    assert resp.json()["lessons_taught"] == 0
    assert resp.json()["lessons_upcoming"] == 1
