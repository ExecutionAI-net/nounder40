"""Two notes per lesson, two audiences (Carlo, 14/09/2026).

`notes` is what the students read under the booking card. `internal_notes`
(on the course and on each lesson) is for the school and the teacher only:
it reaches the attendance page and the teacher's own notes endpoint, and
never any public serializer. The course form used to label `notes` as
"internal, not visible to students" while the booking page printed it.
"""
import uuid
from datetime import datetime, time, timedelta, timezone as dt_timezone

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role
from catalog.models import Course, Lesson, LessonType
from schools.models import School
from teachers.models import Teacher, TeacherSchool

pytestmark = pytest.mark.django_db

NOW = datetime(2026, 9, 7, 6, 0, tzinfo=dt_timezone.utc)  # 08:00 in Rome
SECRET = "bonifico di Maria in sospeso"
COURSE_SECRET = "chiavi della sala nel cassetto"


@pytest.fixture(autouse=True)
def frozen_now(monkeypatch):
    monkeypatch.setattr(timezone, "now", lambda: NOW)


@pytest.fixture
def school():
    return School.objects.create(
        name="Danza", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", city="Milano", active=True,
    )


@pytest.fixture
def lesson_type():
    return LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre", level="Beginner")


def _teacher(school, **link):
    user = get_user_model().objects.create(
        email=f"t-{uuid.uuid4().hex[:8]}@example.com", role=Role.TEACHER, roles=[Role.TEACHER],
    )
    teacher = Teacher.objects.create(user=user, name="Teacher", email=user.email)
    TeacherSchool.objects.create(teacher=teacher, school=school, **link)
    api = APIClient()
    api.force_authenticate(user=user)
    return teacher, api


def _lesson(school, lesson_type, teacher=None, course=None, internal_notes=SECRET, day_offset=1):
    return Lesson.objects.create(
        school=school, lesson_type=lesson_type, teacher=teacher, course=course,
        date=NOW.date() + timedelta(days=day_offset), start_time=time(10, 0), end_time=time(11, 0),
        max_capacity=10, current_bookings=2, status="scheduled",
        notes="porta le scarpe da punta", internal_notes=internal_notes,
    )


def _course(school, lesson_type):
    return Course.objects.create(
        school=school, lesson_type=lesson_type, name="Sbarra", notes="pubblico", internal_notes=COURSE_SECRET,
        start_date=NOW.date(), start_time=time(10, 0), duration_minutes=60,
    )


def test_students_never_see_the_internal_notes(school, lesson_type):
    course = _course(school, lesson_type)
    _lesson(school, lesson_type, course=course)

    browse = APIClient().get("/api/student/lessons/").data["results"][0]
    assert browse["notes"] == "porta le scarpe da punta"
    assert "internal_notes" not in browse
    assert browse["courses"]["notes"] == "pubblico" and "internal_notes" not in browse["courses"]
    assert SECRET not in str(browse) and COURSE_SECRET not in str(browse)

    board = APIClient().get("/api/lessons/public/upcoming/").data
    assert SECRET not in str(board) and COURSE_SECRET not in str(board)


def test_attendance_page_gets_both_notes_and_the_course_one(school, lesson_type):
    teacher, api = _teacher(school)
    lesson = _lesson(school, lesson_type, teacher=teacher, course=_course(school, lesson_type))

    res = api.get(f"/api/teacher/attendance/{lesson.id}/")
    assert res.status_code == 200, res.data
    assert res.data["lesson"]["notes"] == "porta le scarpe da punta"
    assert res.data["lesson"]["internal_notes"] == SECRET
    assert res.data["lesson"]["course_internal_notes"] == COURSE_SECRET


def test_teacher_writes_the_internal_note_of_her_own_lesson(school, lesson_type):
    teacher, api = _teacher(school)
    lesson = _lesson(school, lesson_type, teacher=teacher, internal_notes="")

    res = api.patch(f"/api/teacher/lessons/{lesson.id}/notes/", {"internal_notes": "  nuova allieva oggi  "}, format="json")
    assert res.status_code == 200, res.data
    assert res.data["internal_notes"] == "nuova allieva oggi"
    lesson.refresh_from_db()
    assert lesson.internal_notes == "nuova allieva oggi"
    assert lesson.notes == "porta le scarpe da punta"  # the public note is not hers to touch


def test_teacher_cannot_write_on_a_colleague_lesson_unless_staff(school, lesson_type):
    owner, _ = _teacher(school)
    lesson = _lesson(school, lesson_type, teacher=owner)

    _, plain = _teacher(school)
    assert plain.patch(f"/api/teacher/lessons/{lesson.id}/notes/", {"internal_notes": "x"}, format="json").status_code == 404

    _, staff = _teacher(school, can_view_all_lessons=True)
    assert staff.patch(f"/api/teacher/lessons/{lesson.id}/notes/", {"internal_notes": "x"}, format="json").status_code == 200


def test_notes_endpoint_rejects_garbage(school, lesson_type):
    teacher, api = _teacher(school)
    lesson = _lesson(school, lesson_type, teacher=teacher)
    url = f"/api/teacher/lessons/{lesson.id}/notes/"
    assert api.patch(url, {}, format="json").status_code == 400
    assert api.patch(url, {"internal_notes": ["a"]}, format="json").status_code == 400
    assert api.patch(url, {"internal_notes": "x" * 5001}, format="json").status_code == 400
    assert api.patch(url, {"internal_notes": None}, format="json").data["internal_notes"] == ""


def test_calendar_flags_lessons_that_carry_a_staff_note(school, lesson_type):
    teacher, api = _teacher(school)
    course = _course(school, lesson_type)
    with_own = _lesson(school, lesson_type, teacher=teacher, day_offset=1)
    from_course = _lesson(school, lesson_type, teacher=teacher, course=course, internal_notes="", day_offset=2)
    silent = _lesson(school, lesson_type, teacher=teacher, internal_notes="   ", day_offset=3)

    rows = {r["id"]: r for r in api.get("/api/teacher/lessons/", {"from": NOW.date().isoformat()}).data}
    assert rows[str(with_own.id)]["has_internal_notes"] is True
    assert rows[str(from_course.id)]["has_internal_notes"] is True
    assert rows[str(silent.id)]["has_internal_notes"] is False
    assert SECRET not in str(rows)  # the calendar carries the flag, not the text
