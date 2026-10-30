"""The compensation page filters by date (Carlo, 30/10/2026): the overview
takes ?from=&to= — any period, not only one month — and keeps ?month= for
callers that still send it. The payment status is monthly, so "month" and
"payment" are returned only when the period is exactly one calendar month.
"""
import uuid
from calendar import monthrange
from datetime import date, time, timedelta

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from catalog.models import Course, Lesson, LessonType
from schools.models import School
from teachers.models import CompensationPlan, Teacher, TeacherSchool

pytestmark = pytest.mark.django_db

URL = "/api/teacher/compensation-overview/"


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
def plan(school):
    return CompensationPlan.objects.create(school=school, name="Base Plan", base_fee=20)


@pytest.fixture
def teacher(school, plan):
    user = get_user_model().objects.create(email=f"teach-{uuid.uuid4().hex[:8]}@example.com")
    teacher = Teacher.objects.create(user=user, name="Teach", email=user.email)
    TeacherSchool.objects.create(teacher=teacher, school=school, active=True, compensation_plan=plan)
    return teacher


def make_lesson(school, lesson_type, teacher, *, day):
    course = Course.objects.create(school=school, lesson_type=lesson_type, credit_cost=1, min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type, teacher=teacher,
        date=day, start_time=time(10, 0), end_time=time(11, 0),
        max_capacity=10, current_bookings=0, status="scheduled",
    )


def _first_of_month(d: date) -> date:
    return d.replace(day=1)


def _last_of_month(d: date) -> date:
    return d.replace(day=monthrange(d.year, d.month)[1])


def test_range_spanning_two_months_lists_both_lessons(school, lesson_type, teacher):
    recent = date.today() - timedelta(days=3)
    older = _first_of_month(recent) - timedelta(days=10)  # previous month
    make_lesson(school, lesson_type, teacher, day=recent)
    make_lesson(school, lesson_type, teacher, day=older)

    resp = _client(teacher.user).get(URL, {"from": older.isoformat(), "to": recent.isoformat()})

    assert resp.status_code == 200
    body = resp.json()
    assert body["from"] == older.isoformat() and body["to"] == recent.isoformat()
    assert body["month"] is None
    entry = body["entries"][0]
    assert sorted(row["date"] for row in entry["lessons"]) == sorted([older.isoformat(), recent.isoformat()])
    assert entry["total"] == 40.0
    assert entry["payment"] is None


def test_whole_calendar_month_range_keeps_the_month(school, lesson_type, teacher):
    recent = date.today() - timedelta(days=3)
    make_lesson(school, lesson_type, teacher, day=recent)

    resp = _client(teacher.user).get(
        URL, {"from": _first_of_month(recent).isoformat(), "to": _last_of_month(recent).isoformat()}
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["month"] == recent.strftime("%Y-%m")
    assert [row["date"] for row in body["entries"][0]["lessons"]] == [recent.isoformat()]
    assert body["trend"][-1]["month"] == recent.strftime("%Y-%m")


def test_month_param_still_works(school, lesson_type, teacher):
    recent = date.today() - timedelta(days=3)
    make_lesson(school, lesson_type, teacher, day=recent)

    resp = _client(teacher.user).get(URL, {"month": recent.strftime("%Y-%m")})

    assert resp.status_code == 200
    body = resp.json()
    assert body["month"] == recent.strftime("%Y-%m")
    assert body["from"] == _first_of_month(recent).isoformat()
    assert body["to"] == _last_of_month(recent).isoformat()


@pytest.mark.parametrize(
    "params",
    [
        {"from": "2026-10-10", "to": "2026-10-01"},  # from after to
        {"from": "2026-10-01"},  # to missing
        {"to": "2026-10-31"},  # from missing
    ],
)
def test_bad_ranges_are_400(teacher, params):
    resp = _client(teacher.user).get(URL, params)
    assert resp.status_code == 400
