"""The landing page's "at the barre" board is public, so the endpoint must show
only what a passer-by may see and only classes that are actually still running.
"""
import uuid
from datetime import date, time, timedelta

import pytest
from rest_framework.test import APIClient

from catalog.models import Lesson, LessonType
from schools.models import School

pytestmark = pytest.mark.django_db

URL = "/api/lessons/public/upcoming/"


def _school(city="Milano", active=True):
    return School.objects.create(
        name=f"Danza {city}", slug=f"s-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:6]}@example.com", city=city, active=active,
    )


def _lesson(school, lt, day_offset=0, hour=10, status="scheduled", capacity=10, booked=0):
    return Lesson.objects.create(
        school=school, lesson_type=lt, date=date.today() + timedelta(days=day_offset),
        start_time=time(hour, 0), end_time=time(hour + 1, 0),
        max_capacity=capacity, current_bookings=booked, status=status,
    )


@pytest.fixture
def lesson_type():
    return LessonType.objects.create(
        code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre", name_it="Sbarra", level="Beginner",
    )


def test_no_auth_required(lesson_type):
    _lesson(_school(), lesson_type)
    assert APIClient().get(URL).status_code == 200


def test_lists_todays_lessons_soonest_first(lesson_type):
    school = _school()
    _lesson(school, lesson_type, hour=18)
    _lesson(school, lesson_type, hour=9)
    rows = APIClient().get(URL).data
    assert [r["start_time"] for r in rows] == ["09:00:00", "18:00:00"]


def test_past_cancelled_and_inactive_school_lessons_are_hidden(lesson_type):
    school = _school()
    _lesson(school, lesson_type, day_offset=-1)
    _lesson(school, lesson_type, status="cancelled")
    _lesson(_school(active=False), lesson_type)
    assert APIClient().get(URL).data == []


def test_window_defaults_to_today_and_tomorrow(lesson_type):
    school = _school()
    _lesson(school, lesson_type)
    _lesson(school, lesson_type, day_offset=1)
    far = _lesson(school, lesson_type, day_offset=5)

    assert len(APIClient().get(URL).data) == 2
    ids = {r["id"] for r in APIClient().get(URL, {"days": 7}).data}
    assert str(far.id) in ids


def test_city_filter(lesson_type):
    _lesson(_school(city="Milano"), lesson_type)
    _lesson(_school(city="Roma"), lesson_type)
    rows = APIClient().get(URL, {"city": "roma"}).data
    assert [r["city"] for r in rows] == ["Roma"]


def test_spots_and_full_flag(lesson_type):
    school = _school()
    _lesson(school, lesson_type, hour=9, capacity=10, booked=3)
    _lesson(school, lesson_type, hour=11, capacity=10, booked=10)
    rows = APIClient().get(URL).data
    assert (rows[0]["spots_available"], rows[0]["is_full"]) == (7, False)
    assert (rows[1]["spots_available"], rows[1]["is_full"]) == (0, True)


def test_no_private_fields_leak(lesson_type):
    _lesson(_school(), lesson_type)
    row = APIClient().get(URL).data[0]
    for private in ("teacher", "teacher_name", "current_bookings", "max_capacity", "notes"):
        assert private not in row


def test_locale_picks_the_translated_lesson_type_name(lesson_type):
    _lesson(_school(), lesson_type)
    assert APIClient().get(URL).data[0]["lesson_type_name"] == "Barre"
    assert APIClient().get(URL, {"locale": "it"}).data[0]["lesson_type_name"] == "Sbarra"
    # A locale with no translation falls back rather than rendering blank.
    assert APIClient().get(URL, {"locale": "de"}).data[0]["lesson_type_name"] == "Barre"


def test_limit_is_capped_and_sanitised(lesson_type):
    school = _school()
    for hour in range(8, 16):
        _lesson(school, lesson_type, hour=hour)
    assert len(APIClient().get(URL).data) == 6
    assert len(APIClient().get(URL, {"limit": 2}).data) == 2
    assert len(APIClient().get(URL, {"limit": "abc"}).data) == 6
    assert len(APIClient().get(URL, {"limit": 999}).data) == 8
