"""Giorni di chiusura nella creazione/modifica delle lezioni
(QA round 2: SCH-R2-14 / R2-M7).

`SchoolClosure` veniva rispettato solo *saltando in silenzio* le date: il
wizard creava il corso senza la lezione richiesta, `POST /school/classes/` su
un giorno chiuso rispondeva `{"created": 0}` 200, e una `PATCH` che spostava
una lezione dentro una chiusura passava — producendo una lezione che poi
nessuno puo' prenotare (`bookings.services` -> `school_closed`).

Ora: le date saltate tornano nella risposta (`skipped_closure_dates`) e una
singola lezione piazzata su un giorno chiuso e' un 400 che nomina la data.
"""
import uuid
from datetime import date, time, timedelta

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from catalog.models import Course, Lesson, LessonType
from schools.models import School, SchoolClosure, SchoolMembership

pytestmark = pytest.mark.django_db


@pytest.fixture
def school():
    return School.objects.create(name="Closure School", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def lesson_type():
    return LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Flex")


@pytest.fixture
def course(school, lesson_type):
    return Course.objects.create(school=school, lesson_type=lesson_type, name="Corso", credit_cost=1)


@pytest.fixture
def admin(school):
    user = get_user_model().objects.create(
        email=f"adm-{uuid.uuid4().hex[:8]}@example.com", role="school", roles=["school"],
    )
    user.active_school = school
    user.save()
    SchoolMembership.objects.create(profile=user, school=school, sub_role="admin")
    return user


@pytest.fixture
def client(admin):
    c = APIClient()
    c.force_authenticate(admin)
    return c


# Un lunedi' e i due successivi: la chiusura cade su quello di mezzo.
MONDAY = date(2027, 3, 1)
CLOSED_MONDAY = date(2027, 3, 8)
LAST_MONDAY = date(2027, 3, 15)


@pytest.fixture
def closure(school):
    return SchoolClosure.objects.create(school=school, date=CLOSED_MONDAY, type="full_day")


def test_single_class_on_a_closure_day_is_refused_with_the_date(school, course, client, closure):
    resp = client.post(
        "/api/school/classes/",
        {
            "course_id": str(course.id), "date": CLOSED_MONDAY.isoformat(),
            "start_time": "10:00", "duration_minutes": 60, "frequency": "single",
        },
        format="json",
    )

    assert resp.status_code == 400
    assert resp.data == {"error": "school_closed", "date": CLOSED_MONDAY.isoformat()}
    assert not Lesson.objects.filter(school=school, date=CLOSED_MONDAY).exists()


def test_single_class_on_an_open_day_still_works(school, course, client, closure):
    resp = client.post(
        "/api/school/classes/",
        {
            "course_id": str(course.id), "date": MONDAY.isoformat(),
            "start_time": "10:00", "duration_minutes": 60, "frequency": "single",
        },
        format="json",
    )

    assert resp.status_code == 200
    assert resp.data == {"created": 1, "skipped_closure_dates": []}
    assert Lesson.objects.filter(school=school, date=MONDAY).count() == 1


def test_recurring_class_reports_the_skipped_closure_dates(school, course, client, closure):
    resp = client.post(
        "/api/school/classes/",
        {
            "course_id": str(course.id), "date": MONDAY.isoformat(),
            "end_date": LAST_MONDAY.isoformat(), "start_time": "10:00",
            "duration_minutes": 60, "frequency": "weekly",
        },
        format="json",
    )

    assert resp.status_code == 200
    assert resp.data["created"] == 2
    assert resp.data["skipped_closure_dates"] == [CLOSED_MONDAY.isoformat()]
    dates = set(Lesson.objects.filter(school=school).values_list("date", flat=True))
    assert dates == {MONDAY, LAST_MONDAY}


def test_moving_a_class_onto_a_closure_day_is_refused(school, course, client, closure, lesson_type):
    lesson = Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type, date=MONDAY,
        start_time=time(10, 0), end_time=time(11, 0), max_capacity=10, status="scheduled",
    )

    resp = client.patch(
        f"/api/school/classes/{lesson.id}/", {"date": CLOSED_MONDAY.isoformat()}, format="json"
    )

    assert resp.status_code == 400
    assert resp.data == {"error": "school_closed", "date": CLOSED_MONDAY.isoformat()}
    lesson.refresh_from_db()
    assert lesson.date == MONDAY


def test_moving_a_class_onto_an_open_day_still_works(school, course, client, closure, lesson_type):
    lesson = Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type, date=MONDAY,
        start_time=time(10, 0), end_time=time(11, 0), max_capacity=10, status="scheduled",
    )

    resp = client.patch(
        f"/api/school/classes/{lesson.id}/", {"date": LAST_MONDAY.isoformat()}, format="json"
    )

    assert resp.status_code == 200
    lesson.refresh_from_db()
    assert lesson.date == LAST_MONDAY


def test_wizard_reports_the_dates_it_skipped(school, lesson_type, client, closure):
    resp = client.post(
        "/api/school/courses-create/",
        {
            "name": "Corso chiuso", "lesson_type_id": str(lesson_type.id),
            "schedules": [
                {
                    "frequency": "weekly", "start_date": MONDAY.isoformat(),
                    "end_date": LAST_MONDAY.isoformat(), "start_time": "20:00",
                    "duration_minutes": 60,
                },
                {
                    "frequency": "single", "start_date": CLOSED_MONDAY.isoformat(),
                    "start_time": "09:00", "duration_minutes": 60,
                },
            ],
        },
        format="json",
    )

    assert resp.status_code == 200
    assert resp.data["lessons_created"] == 2
    assert resp.data["skipped_closure_dates"] == [CLOSED_MONDAY.isoformat()]


def test_wizard_with_only_closed_dates_says_which_ones(school, lesson_type, client, closure):
    resp = client.post(
        "/api/school/courses-create/",
        {
            "name": "Solo chiuso", "lesson_type_id": str(lesson_type.id),
            "schedules": [
                {
                    "frequency": "single", "start_date": CLOSED_MONDAY.isoformat(),
                    "start_time": "09:00", "duration_minutes": 60,
                }
            ],
        },
        format="json",
    )

    assert resp.status_code == 400
    assert resp.data["skipped_closure_dates"] == [CLOSED_MONDAY.isoformat()]
    assert not Course.objects.filter(school=school, name="Solo chiuso").exists()


def test_a_closure_range_covers_every_day_inside_it(school, course, client):
    SchoolClosure.objects.create(
        school=school, date=MONDAY, end_date=MONDAY + timedelta(days=6), type="full_day"
    )

    resp = client.post(
        "/api/school/classes/",
        {
            "course_id": str(course.id), "date": (MONDAY + timedelta(days=3)).isoformat(),
            "start_time": "10:00", "duration_minutes": 60, "frequency": "single",
        },
        format="json",
    )

    assert resp.status_code == 400
    assert resp.data["date"] == (MONDAY + timedelta(days=3)).isoformat()
