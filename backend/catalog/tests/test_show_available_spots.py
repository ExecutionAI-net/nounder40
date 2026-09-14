"""School setting "show available spots to students" (Carlo, 14/09/2026).

Off: the booking feed still carries the counts (the client needs them to
grey out a full class) but says `show_spots: false`, and the public landing
board answers `spots_available: null` while `is_full` keeps working. The
school's own calendars are untouched: they read other endpoints.
"""
import uuid
from datetime import datetime, time, timedelta, timezone as dt_timezone

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from catalog.models import Lesson, LessonType
from schools.models import School, SchoolMembership, SchoolRole

pytestmark = pytest.mark.django_db

BROWSE = "/api/student/lessons/"
BOARD = "/api/lessons/public/upcoming/"
NOW = datetime(2026, 9, 7, 6, 0, tzinfo=dt_timezone.utc)  # 08:00 in Rome


@pytest.fixture(autouse=True)
def frozen_now(monkeypatch):
    monkeypatch.setattr(timezone, "now", lambda: NOW)


@pytest.fixture
def lesson_type():
    return LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre", level="Beginner")


def _school(**kwargs):
    return School.objects.create(
        name="Danza", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com",
        city="Milano", active=True, **kwargs,
    )


def _lesson(school, lt, capacity=10, booked=3):
    return Lesson.objects.create(
        school=school, lesson_type=lt, date=NOW.date() + timedelta(days=1),
        start_time=time(10, 0), end_time=time(11, 0), max_capacity=capacity, current_bookings=booked,
        status="scheduled",
    )


def test_booking_feed_flags_whether_to_print_the_spots(lesson_type):
    _lesson(_school(show_available_spots_to_students=True), lesson_type)
    _lesson(_school(show_available_spots_to_students=False), lesson_type)

    rows = APIClient().get(BROWSE).data["results"]
    by_flag = {r["show_spots"]: r for r in rows}
    assert set(by_flag) == {True, False}
    # The counts stay in both cases: "full" is decided client-side from them.
    assert by_flag[False]["max_capacity"] == 10 and by_flag[False]["current_bookings"] == 3


def test_landing_board_hides_the_number_but_still_knows_full(lesson_type):
    hidden = _school(show_available_spots_to_students=False)
    _lesson(hidden, lesson_type, capacity=10, booked=3)
    _lesson(hidden, lesson_type, capacity=5, booked=5)
    _lesson(_school(), lesson_type, capacity=10, booked=3)

    rows = APIClient().get(BOARD).data
    hidden_rows = [r for r in rows if r["school_slug"] == hidden.slug]
    assert [r["spots_available"] for r in hidden_rows] == [None, None]
    assert sorted(r["is_full"] for r in hidden_rows) == [False, True]
    shown = next(r for r in rows if r["school_slug"] != hidden.slug)
    assert shown["spots_available"] == 7 and shown["is_full"] is False


def test_the_school_owner_flips_it_from_settings():
    SchoolRole.objects.update_or_create(
        key="owner", defaults={"label": "Titolare", "builtin": True, "permissions": ["dashboard", "settings"]}
    )
    school = _school()
    user = get_user_model().objects.create(
        email=f"o-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")

    resp = api.patch("/api/school/profile/", {"show_available_spots_to_students": False}, format="json")
    assert resp.status_code == 200, resp.data
    school.refresh_from_db()
    assert school.show_available_spots_to_students is False
    assert api.get("/api/school/profile/").data["show_available_spots_to_students"] is False
