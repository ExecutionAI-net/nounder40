"""GET /api/student/lessons/ on a slow phone: the same nested lesson type,
course, room, teacher and school were serialized again for every row (0.75 s
for 500 rows, against 0.08 s once each distinct object is serialized once),
and a shared /student/book?school=<slug> link needed a first request just to
turn the slug into an id."""
import uuid
from datetime import time, timedelta
from decimal import Decimal
from unittest import mock

import pytest
from django.utils import timezone

from catalog import serializers as catalog_serializers
from catalog.models import Course, Lesson, LessonType
from schools.models import School

pytestmark = pytest.mark.django_db
URL = "/api/student/lessons/"


def _school(slug=None):
    return School.objects.create(
        name="S", slug=slug or f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome",
    )


def _lessons(school, n):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre", image_url_it="https://x.example/y.jpg")
    course = Course.objects.create(school=school, lesson_type=lt, name="Classico", credit_cost=Decimal("1.5"), min_booking_notice_hours=0)
    start = timezone.localdate() + timedelta(days=2)
    Lesson.objects.bulk_create([
        Lesson(
            school=school, lesson_type=lt, course=course, date=start + timedelta(days=i),
            start_time=time(10, 0), end_time=time(11, 0), max_capacity=10, status="scheduled",
        )
        for i in range(n)
    ])
    return lt, course


def test_shared_nested_objects_are_serialized_once_and_keep_their_shape(client):
    school = _school()
    lt, course = _lessons(school, 12)

    with mock.patch.object(
        catalog_serializers, "_BookingLessonTypeSerializer", wraps=catalog_serializers._BookingLessonTypeSerializer
    ) as lt_ser, mock.patch.object(
        catalog_serializers, "_BookingSchoolSerializer", wraps=catalog_serializers._BookingSchoolSerializer
    ) as school_ser:
        rows = client.get(f"{URL}?school_id={school.id}&limit=50").json()["results"]

    assert len(rows) == 12
    assert lt_ser.call_count == 1 and school_ser.call_count == 1
    first = rows[0]
    assert first["lesson_types"]["id"] == str(lt.id) and first["lesson_types"]["name_en"] == "Barre"
    assert first["lesson_types"]["image_url_it"] == "https://x.example/y.jpg"
    assert first["courses"]["name"] == "Classico" and first["schools"]["timezone"] == "Europe/Rome"
    # every row carries its own copy of the nested data
    assert all(r["lesson_types"] == first["lesson_types"] and r["schools"] == first["schools"] for r in rows)
    assert first["teachers"] is None and first["school_rooms"] is None


def test_school_slug_filters_like_school_id(client):
    barcelona, milano = _school("barcelona-x"), _school("milano-x")
    _lessons(barcelona, 3)
    _lessons(milano, 2)

    by_slug = client.get(f"{URL}?school_slug=barcelona-x").json()
    by_id = client.get(f"{URL}?school_id={barcelona.id}").json()
    assert by_slug["count"] == 3
    assert [r["id"] for r in by_slug["results"]] == [r["id"] for r in by_id["results"]]

    both = client.get(f"{URL}?school_slug=barcelona-x,milano-x").json()
    assert both["count"] == 5
    assert client.get(f"{URL}?school_slug=nope").json()["count"] == 0
