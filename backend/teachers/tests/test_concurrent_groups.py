"""Pinned sets of concurrent lessons (catalog.ConcurrentLessonGroup, Carlo
2026-10-31): one fee for the set, on the teacher's page and the school's,
and the pin/unpin endpoint behind the lock on Reports › Lessons."""

import uuid
from datetime import date, time, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from bookings.models import Attendance
from catalog.models import ConcurrentLessonGroup, Course, Lesson, LessonType
from schools.models import School, SchoolLocation, SchoolRoom
from students.models import Student
from teachers.models import CompensationPlan, Teacher, TeacherSchool
from teachers.services import period_compensation

User = get_user_model()
pytestmark = pytest.mark.django_db

PIN_URL = "/api/school/reports/concurrent-groups/"


def _user(role, **fields):
    return User.objects.create(email=f"{role}-{uuid.uuid4().hex[:8]}@example.com", role=role, roles=[role], **fields)


def _present(lesson, teacher, n):
    student = Student.objects.create(user=_user(Role.STUDENT), name=f"S{n}", school=lesson.school)
    Attendance.objects.create(lesson=lesson, student=student, teacher=teacher, status="present")


@pytest.fixture
def pair():
    """Two lessons of one teacher at 18:00 two days ago -- the class in the
    room (one present) and its Zoom stream (one present) -- on a plan paying
    30 EUR a class plus 5 EUR per student above the first."""
    school = School.objects.create(name="Pin School", slug=f"pin-{uuid.uuid4().hex[:6]}", email="pin@example.com")
    teacher = Teacher.objects.create(user=_user(Role.TEACHER), name="T", email="t@example.com")
    plan = CompensationPlan.objects.create(
        school=school, name="Plan", base_fee=Decimal("30"), bonus_threshold=1, bonus_per_student=Decimal("5")
    )
    TeacherSchool.objects.create(teacher=teacher, school=school, compensation_plan=plan, active=True)
    lesson_type = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Ballet", active=True)
    room = SchoolRoom.objects.create(
        location=SchoolLocation.objects.create(school=school, name="Venue"), name="Room", cost=Decimal("20")
    )
    day = date.today() - timedelta(days=2)
    common = dict(school=school, teacher=teacher, lesson_type=lesson_type, date=day, start_time=time(18), end_time=time(19))
    in_room = Lesson.objects.create(
        course=Course.objects.create(school=school, lesson_type=lesson_type, teacher=teacher, name="Room class", room=room),
        room=room, **common,
    )
    on_zoom = Lesson.objects.create(
        course=Course.objects.create(school=school, lesson_type=lesson_type, teacher=teacher, name="Zoom class", is_online=True),
        is_online=True, **common,
    )
    _present(in_room, teacher, 1)
    _present(on_zoom, teacher, 2)
    return school, teacher, in_room, on_zoom, day


def test_unpinned_pays_each_lesson(pair):
    school, teacher, in_room, on_zoom, day = pair
    comp = period_compensation(teacher, school, day, day)
    assert comp["total"] == 60.0
    assert [row["merged"] for row in comp["breakdown"]] == [False, False]


def test_pinned_set_pays_once_on_everyone_present(pair):
    school, teacher, in_room, on_zoom, day = pair
    ConcurrentLessonGroup.objects.create(school=school, teacher=teacher, date=day, start_time=time(18))
    comp = period_compensation(teacher, school, day, day)
    assert comp["total"] == 35.0  # 30 + 5 for the second student, once
    (row,) = comp["breakdown"]
    assert row["merged"] is True
    assert row["lesson_id"] == str(in_room.id)  # the in-room lesson leads
    assert set(row["lesson_ids"]) == {str(in_room.id), str(on_zoom.id)}
    assert row["students"] == 2 and row["has_bonus"] is True
    assert row["course"] == "Room class + Zoom class"
    assert [m["students"] for m in row["lessons"]] == [1, 1]


def test_teacher_overview_shows_the_pinned_set_as_one_row(pair):
    school, teacher, in_room, on_zoom, day = pair
    ConcurrentLessonGroup.objects.create(school=school, teacher=teacher, date=day, start_time=time(18))
    api = APIClient()
    api.force_authenticate(user=teacher.user)
    res = api.get(f"/api/teacher/compensation-overview/?from={day}&to={day}&school={school.id}")
    assert res.status_code == 200
    (entry,) = res.json()["entries"]
    assert entry["total"] == 35.0
    (row,) = entry["lessons"]
    assert row["merged"] is True and len(row["lessons"]) == 2 and row["fee"] == 35.0


def test_pin_and_unpin_endpoint_drive_the_report_flag(pair):
    school, teacher, in_room, on_zoom, day = pair
    api = APIClient()
    api.force_authenticate(user=_user(Role.SCHOOL, active_school=school))
    key = f"{day.isoformat()}|18:00:00|{teacher.id}"

    res = api.post(PIN_URL, {"key": key}, format="json")
    assert res.status_code == 201 and res.json() == {"key": key, "frozen": True}
    assert api.post(PIN_URL, {"key": key}, format="json").status_code == 200  # idempotent

    report = api.get(f"/api/school/reports/detailed/?tab=lessons&from={day}&to={day}").json()["lessons"]
    assert report["concurrent"][key]["frozen"] is True
    assert {row["concurrent_key"] for row in report["rows"]} == {key}

    res = api.delete(PIN_URL, {"key": key}, format="json")
    assert res.status_code == 200 and res.json()["frozen"] is False
    assert not ConcurrentLessonGroup.objects.filter(school=school).exists()
    report = api.get(f"/api/school/reports/detailed/?tab=lessons&from={day}&to={day}").json()["lessons"]
    assert report["concurrent"][key]["frozen"] is False


def test_pin_refuses_a_lone_lesson_bad_keys_and_other_schools(pair):
    school, teacher, in_room, on_zoom, day = pair
    api = APIClient()
    api.force_authenticate(user=_user(Role.SCHOOL, active_school=school))
    lone_day = day - timedelta(days=1)
    Lesson.objects.create(school=school, teacher=teacher, date=lone_day, start_time=time(10), end_time=time(11))
    assert api.post(PIN_URL, {"key": f"{lone_day.isoformat()}|10:00:00|{teacher.id}"}, format="json").status_code == 400
    assert api.post(PIN_URL, {"key": "garbage"}, format="json").status_code == 400
    other = School.objects.create(name="Other", slug=f"o-{uuid.uuid4().hex[:6]}", email="o@example.com")
    outsider = APIClient()
    outsider.force_authenticate(user=_user(Role.SCHOOL, active_school=other))
    assert outsider.post(PIN_URL, {"key": f"{day.isoformat()}|18:00:00|{teacher.id}"}, format="json").status_code == 400
    assert not ConcurrentLessonGroup.objects.exists()
