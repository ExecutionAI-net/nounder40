"""A teacher of several schools (Alina: two schools) narrows her panel to
one with the sidebar switcher; the panel endpoints take `?school=`."""
import uuid
from datetime import date, time

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from catalog.models import Lesson, LessonType
from schools.models import School
from teachers.models import Teacher, TeacherSchool

pytestmark = pytest.mark.django_db
User = get_user_model()


def _school(name):
    return School.objects.create(name=name, slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com")


@pytest.fixture
def setup():
    user = User.objects.create(email=f"t-{uuid.uuid4().hex[:6]}@example.com", role=Role.TEACHER, roles=[Role.TEACHER])
    teacher = Teacher.objects.create(user=user, name="Alina")
    a, b = _school("Barcelona"), _school("Milano")
    TeacherSchool.objects.create(teacher=teacher, school=a, active=True)
    TeacherSchool.objects.create(teacher=teacher, school=b, active=True)
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    for school, day in ((a, date(2027, 5, 10)), (a, date(2027, 5, 11)), (b, date(2027, 5, 10))):
        Lesson.objects.create(
            school=school, teacher=teacher, lesson_type=lt, date=day, start_time=time(10, 0), end_time=time(11, 0),
            max_capacity=10, status="scheduled",
        )
    api = APIClient()
    api.force_authenticate(user)
    return api, a, b


def test_lessons_and_calendar_narrow_to_one_school(setup):
    api, a, b = setup
    everything = api.get("/api/teacher/lessons/", {"from": "2027-05-01", "to": "2027-05-31"}).json()
    assert len(everything) == 3
    only_a = api.get("/api/teacher/lessons/", {"from": "2027-05-01", "to": "2027-05-31", "school": str(a.id)}).json()
    assert {row["school"] for row in only_a} == {str(a.id)} and len(only_a) == 2
    only_b = api.get("/api/teacher/calendar/", {"from": "2027-05-01", "to": "2027-05-31", "school": str(b.id)}).json()
    assert len(only_b) == 1


def test_stats_narrow_to_one_school(setup):
    api, a, b = setup
    assert api.get("/api/teacher/stats/").json()["lessons_upcoming"] == 3
    assert api.get("/api/teacher/stats/", {"school": str(a.id)}).json()["lessons_upcoming"] == 2
    assert api.get("/api/teacher/stats/", {"school": str(b.id)}).json()["lessons_upcoming"] == 1


def test_compensation_overview_entries_carry_the_school_id(setup):
    api, a, b = setup
    entries = api.get("/api/teacher/compensation-overview/", {"month": "2027-05"}).json()["entries"]
    assert {e["school"]["id"] for e in entries} == {str(a.id), str(b.id)}


def test_compensation_overview_narrows_to_one_school(setup):
    api, a, b = setup
    only_b = api.get("/api/teacher/compensation-overview/", {"month": "2027-05", "school": str(b.id)}).json()
    assert [e["school"]["id"] for e in only_b["entries"]] == [str(b.id)]
    assert len(only_b["trend"]) == 6


def test_library_yields_nothing_for_a_school_she_does_not_teach_at(setup):
    api, a, b = setup
    from library.models import LibraryContent

    LibraryContent.objects.create(title_en="Barre basics", type="video", language="en", file_url="https://x/v")
    assert len(api.get("/api/teacher/library/").json()) == 1
    assert len(api.get("/api/teacher/library/", {"school": str(a.id)}).json()) == 1
    assert api.get("/api/teacher/library/", {"school": str(uuid.uuid4())}).json() == []
