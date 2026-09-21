"""`school_closed` on the booking feed used to cost one EXISTS per distinct
(school, date) pair (~3 s for a 500-lesson page). The list serializer now
looks the closures of the whole page up once; the answers must be exactly
those of `date_in_school_closure`."""
import uuid
from datetime import date, time, timedelta

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from catalog.models import Lesson
from catalog.services import date_in_school_closure, prime_closure_cache
from schools.models import School, SchoolClosure
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


def _school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True)


def _lessons(school, days):
    base = timezone.localdate() + timedelta(days=3)
    return [
        Lesson.objects.create(
            school=school, date=base + timedelta(days=i), start_time=time(18, 0), end_time=time(19, 0),
            max_capacity=5, current_bookings=0,
        )
        for i in range(days)
    ]


def test_priming_matches_the_per_date_rule():
    a, b = _school(), _school()
    base = timezone.localdate()
    SchoolClosure.objects.create(school=a, date=base + timedelta(days=4))  # single day
    SchoolClosure.objects.create(school=a, date=base + timedelta(days=8), end_date=base + timedelta(days=10))
    SchoolClosure.objects.create(school=b, date=base + timedelta(days=5), type="partial", from_time=time(9, 0))
    lessons = _lessons(a, 14) + _lessons(b, 14)

    cache = {}
    prime_closure_cache(cache, lessons)
    for lesson in lessons:
        assert cache[(lesson.school_id, lesson.date)] == date_in_school_closure(lesson.school_id, lesson.date)
    assert any(cache.values()) and not all(cache.values())


def test_priming_is_one_query_and_skips_cached_keys():
    school = _school()
    lessons = _lessons(school, 10)
    with CaptureQueriesContext(connection) as ctx:
        prime_closure_cache({}, lessons)
    assert len(ctx) == 1
    warm = {(l.school_id, l.date): False for l in lessons}
    with CaptureQueriesContext(connection) as ctx:
        prime_closure_cache(warm, lessons)
    assert len(ctx) == 0


def test_public_upcoming_feed_query_count_is_flat():
    school = _school()
    client = APIClient()

    def count():
        with CaptureQueriesContext(connection) as ctx:
            res = client.get("/api/lessons/public/upcoming/?days=14&limit=24")
        return len(ctx), res

    _lessons(school, 2)
    small, res = count()
    assert res.status_code == 200, res.content
    _lessons(school, 10)
    large, _ = count()
    assert large == small


def test_student_browse_feed_query_count_is_flat_and_flags_closures():
    school = _school()
    client = APIClient()

    def count():
        with CaptureQueriesContext(connection) as ctx:
            res = client.get("/api/student/lessons/")
        return len(ctx), res

    lessons = _lessons(school, 2)
    small, res = count()
    assert res.status_code == 200, res.content
    more = _lessons(school, 12)
    SchoolClosure.objects.create(school=school, date=lessons[0].date)
    large, res = count()
    assert large == small
    closed = {r["date"]: r["school_closed"] for r in res.json()["results"]}
    assert closed[str(lessons[0].date)] is True
    assert closed[str(more[-1].date)] is False
