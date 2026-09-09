"""ST-R3-03 / ST-R3-08: browsing the network past the 500th lesson.

`GET /api/student/lessons/` ended in `qs[:500]`. There was no offset, no
count and nothing in the response saying anything had been dropped, so the
booking page showed the cap as the size of the network ("Mostrate 30 lezioni
su 500") and the lessons after it could not be reached at all.
"""
import uuid
from datetime import time, timedelta

import pytest
from django.utils import timezone

from catalog.models import Lesson, LessonType
from schools.models import School

pytestmark = pytest.mark.django_db

URL = "/api/student/lessons/"


@pytest.fixture
def school():
    return School.objects.create(
        name="Browse", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome",
    )


@pytest.fixture
def lesson_type():
    return LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")


def _lessons(school, lesson_type, n, *, first_day=None):
    """n bookable lessons on consecutive future days, one per day, so the
    ordering the endpoint promises (date, start_time) is unambiguous."""
    start = first_day or timezone.localdate() + timedelta(days=2)
    rows = [
        Lesson(
            school=school, lesson_type=lesson_type, date=start + timedelta(days=i),
            start_time=time(10, 0), end_time=time(11, 0), max_capacity=10, status="scheduled",
        )
        for i in range(n)
    ]
    return Lesson.objects.bulk_create(rows)


def test_the_count_is_the_real_total_not_the_page_size(client, school, lesson_type):
    _lessons(school, lesson_type, 7)
    body = client.get(f"{URL}?school_id={school.id}&limit=3").json()
    assert body["count"] == 7
    assert len(body["results"]) == 3


def test_offset_reaches_the_rows_after_the_first_page(client, school, lesson_type):
    created = _lessons(school, lesson_type, 7)
    expected = [str(lsn.id) for lsn in sorted(created, key=lambda x: (x.date, x.start_time))]

    seen = []
    for offset in (0, 3, 6):
        body = client.get(f"{URL}?school_id={school.id}&limit=3&offset={offset}").json()
        seen += [row["id"] for row in body["results"]]
    assert seen == expected


def test_the_default_page_is_still_500(client, school, lesson_type):
    """The cap that used to truncate silently is now the default page size:
    an existing caller gets the same first page, and learns from `count` and
    `next` that there is more."""
    from students.views import BrowseLessonsPagination

    assert (BrowseLessonsPagination.default_limit, BrowseLessonsPagination.max_limit) == (500, 500)
    _lessons(school, lesson_type, 4)
    body = client.get(f"{URL}?school_id={school.id}").json()
    assert body["count"] == 4
    assert body["next"] is None
    assert len(body["results"]) == 4


def test_a_page_never_exceeds_the_maximum(client, school, lesson_type):
    """`?limit=100000` must not become a way to ask for the whole network in
    one response — that is the page weight R2-M16 was about."""
    _lessons(school, lesson_type, 6)
    body = client.get(f"{URL}?school_id={school.id}&limit=100000").json()
    assert len(body["results"]) == 6  # capped at max_limit, well above 6 here
    body = client.get(f"{URL}?school_id={school.id}&limit=100000&offset=0").json()
    assert body["count"] == 6


def test_filters_still_apply_before_the_page_is_cut(client, school, lesson_type):
    other = School.objects.create(
        name="Other", slug=f"s-{uuid.uuid4().hex[:8]}", email="o@example.com", timezone="Europe/Rome",
    )
    _lessons(school, lesson_type, 4)
    _lessons(other, lesson_type, 9)
    body = client.get(f"{URL}?school_id={school.id}&limit=2").json()
    assert body["count"] == 4
    assert {row["schools"]["name"] for row in body["results"]} == {"Browse"}
