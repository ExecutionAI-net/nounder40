"""Started lessons leave the booking calendar (QA R2 ST-R2-21 / TCH-R2-13).

`/api/student/lessons/` (and the landing page's public board) used to keep
every lesson of the current day visible until midnight, filtered on `date`
alone: at 14:30 the 10:00 class was still listed with a live "Book" button
that could only end in a "too late" error. `upcoming_lessons_q()` now hides a
lesson the moment its start time passes, decided in the SCHOOL's own timezone
(`School.timezone`), the same interpretation `_lesson_datetime()` applies to
cancellation-policy and min-notice decisions (R2-H14).
"""
import uuid
from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone

from bookings.services import upcoming_lessons_q
from catalog.models import Course, Lesson, LessonType
from schools.models import School

pytestmark = pytest.mark.django_db

# 2026-09-07 12:30 UTC: 14:30 in Rome (CEST, UTC+2), 02:30 on the 8th in
# Kiritimati (UTC+14), 02:30 on the 7th in Honolulu (UTC-10).
NOW = datetime(2026, 9, 7, 12, 30, tzinfo=dt_timezone.utc)


def _school(tz_name):
    return School.objects.create(
        name=f"S {tz_name}", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone=tz_name,
    )


@pytest.fixture
def lesson_type():
    return LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")


def _lesson(school, lesson_type, day, start):
    course = Course.objects.create(school=school, lesson_type=lesson_type, credit_cost=1, min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type,
        date=day, start_time=start, end_time=(datetime.combine(day, start) + timedelta(hours=1)).time(),
        max_capacity=10, status="scheduled",
    )


def _visible(now=NOW):
    return set(Lesson.objects.filter(upcoming_lessons_q(now=now)).values_list("id", flat=True))


def test_started_lessons_are_hidden_even_when_still_today(lesson_type):
    rome = _school("Europe/Rome")
    this_morning = _lesson(rome, lesson_type, date(2026, 9, 7), time(10, 0))     # started 4h30 ago
    a_minute_ago = _lesson(rome, lesson_type, date(2026, 9, 7), time(14, 29))    # started 1 min ago
    in_a_minute = _lesson(rome, lesson_type, date(2026, 9, 7), time(14, 31))     # not yet
    tomorrow = _lesson(rome, lesson_type, date(2026, 9, 8), time(9, 0))
    yesterday = _lesson(rome, lesson_type, date(2026, 9, 6), time(23, 0))

    assert _visible() == {in_a_minute.id, tomorrow.id}
    assert this_morning.id not in _visible()
    assert a_minute_ago.id not in _visible()
    assert yesterday.id not in _visible()


def test_the_boundary_is_the_start_time_itself(lesson_type):
    rome = _school("Europe/Rome")
    at_1430 = _lesson(rome, lesson_type, date(2026, 9, 7), time(14, 30))
    # Exactly at the start instant the class is still listed…
    assert at_1430.id in _visible(now=NOW)
    # …one second later it is gone.
    assert at_1430.id not in _visible(now=NOW + timedelta(seconds=1))


def test_decided_in_each_schools_own_timezone(lesson_type):
    rome = _school("Europe/Rome")
    kiritimati = _school("Pacific/Kiritimati")
    honolulu = _school("Pacific/Honolulu")
    # The same wall-clock lesson "2026-09-07 13:00" means three different instants:
    rome_l = _lesson(rome, lesson_type, date(2026, 9, 7), time(13, 0))          # Rome is at 14:30 → started
    kiri_l = _lesson(kiritimati, lesson_type, date(2026, 9, 7), time(13, 0))    # Kiritimati is already on the 8th → past
    hono_l = _lesson(honolulu, lesson_type, date(2026, 9, 7), time(13, 0))      # Honolulu is at 02:30 → still ahead
    kiri_early = _lesson(kiritimati, lesson_type, date(2026, 9, 8), time(2, 0))  # 02:00 on the 8th, local now 02:30 → started
    kiri_later = _lesson(kiritimati, lesson_type, date(2026, 9, 8), time(3, 0))  # 03:00 on the 8th → ahead

    assert _visible() == {hono_l.id, kiri_later.id}
    for hidden in (rome_l, kiri_l, kiri_early):
        assert hidden.id not in _visible()


def test_unknown_or_blank_timezone_falls_back_to_utc(lesson_type):
    weird = _school("Mars/Olympus_Mons")
    blank = _school("")
    for school in (weird, blank):
        _lesson(school, lesson_type, date(2026, 9, 7), time(12, 0))   # 12:00 UTC < 12:30 UTC → hidden
    weird_ahead = _lesson(weird, lesson_type, date(2026, 9, 7), time(13, 0))
    blank_ahead = _lesson(blank, lesson_type, date(2026, 9, 7), time(13, 0))

    assert _visible() == {weird_ahead.id, blank_ahead.id}


def test_student_lessons_endpoint_hides_started_lessons(client, lesson_type):
    """End to end on the public browse endpoint, around the real clock."""
    rome = _school("Europe/Rome")
    local_now = timezone.now().astimezone(ZoneInfo("Europe/Rome"))
    started = local_now - timedelta(minutes=30)
    ahead = local_now + timedelta(minutes=30)
    started_lesson = _lesson(rome, lesson_type, started.date(), started.time().replace(microsecond=0))
    ahead_lesson = _lesson(rome, lesson_type, ahead.date(), ahead.time().replace(microsecond=0))

    resp = client.get(f"/api/student/lessons/?school_id={rome.id}")
    assert resp.status_code == 200
    ids = {row["id"] for row in resp.json()["results"]}
    assert str(ahead_lesson.id) in ids
    assert str(started_lesson.id) not in ids
