"""QA #8: SchoolClosure was recorded but never enforced. This covers the
lesson-generation side — a course's weekly recurrence must not create a
Lesson on a date the school has marked closed. (The booking side is covered
in bookings/tests/test_school_closure_booking.py.)
"""
import uuid
from datetime import date, timedelta

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from catalog.course_views import _weekday_name
from catalog.models import Course, Lesson, LessonType
from schools.models import School, SchoolClosure

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def lesson_type():
    return LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")


@pytest.fixture
def staff_client(school):
    staff = User.objects.create(
        email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    client = APIClient()
    client.force_authenticate(staff)
    return client


def test_weekly_course_creation_skips_closure_date(school, lesson_type, staff_client):
    first = date.today() + timedelta(days=7)
    third_occurrence = first + timedelta(weeks=2)
    SchoolClosure.objects.create(school=school, date=third_occurrence)

    body = {
        "lesson_type_id": str(lesson_type.id),
        "schedules": [{
            "start_date": first.isoformat(),
            "end_date": (first + timedelta(weeks=3)).isoformat(),
            "start_time": "10:00", "duration_minutes": 60, "frequency": "weekly",
            "weekday": _weekday_name(first),
        }],
    }
    res = staff_client.post("/api/school/courses-create/", body, format="json")
    assert res.status_code == 200

    course = Course.objects.get(pk=res.json()["id"])
    dates = set(Lesson.objects.filter(course=course).values_list("date", flat=True))
    assert third_occurrence not in dates
    assert first in dates
    assert (first + timedelta(weeks=1)) in dates
    assert (first + timedelta(weeks=3)) in dates
    assert res.json()["lessons_created"] == 3  # 4 occurrences minus the closed one


def test_single_class_creation_rejects_a_closure_date(school, lesson_type, staff_client):
    """QA SCH-R2-14 / R2-M7: prima la data chiusa veniva saltata in silenzio
    e la risposta era `{"created": 0}` 200 — indistinguibile da un successo.
    Ora e' un 400 che nomina la data."""
    course = Course.objects.create(school=school, lesson_type=lesson_type, credit_cost=1)
    closed_day = date.today() + timedelta(days=10)
    SchoolClosure.objects.create(school=school, date=closed_day)

    body = {
        "course_id": str(course.id), "date": closed_day.isoformat(),
        "start_time": "10:00", "duration_minutes": 60,
    }
    res = staff_client.post("/api/school/classes/", body, format="json")
    assert res.status_code == 400
    assert res.json() == {"error": "school_closed", "date": closed_day.isoformat()}
    assert not Lesson.objects.filter(course=course, date=closed_day).exists()


def test_closure_with_end_date_blocks_the_whole_range(school, lesson_type, staff_client):
    first = date.today() + timedelta(days=7)
    SchoolClosure.objects.create(school=school, date=first, end_date=first + timedelta(days=3))

    body = {
        "lesson_type_id": str(lesson_type.id),
        "schedules": [{
            "start_date": first.isoformat(), "start_time": "10:00", "duration_minutes": 60, "frequency": "single",
        }],
    }
    res = staff_client.post("/api/school/courses-create/", body, format="json")
    assert res.status_code == 400  # nothing could be generated — the only date is closed
