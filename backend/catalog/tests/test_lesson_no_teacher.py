"""An explicit "nobody" on a lesson (Lesson.no_teacher, Carlo 2026-10-31): the
class did not run but the room is still paid, so nobody earns a fee and the
course's teacher must not step in where a null teacher means "the course's"."""

import uuid
from datetime import date, time, timedelta

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from bookings.services import lesson_email_context
from catalog.models import Course, Lesson, LessonType
from schools.models import School
from students.models import Student
from teachers.models import CompensationPlan, Teacher, TeacherSchool

User = get_user_model()
pytestmark = pytest.mark.django_db


def _user(role, **fields):
    return User.objects.create(email=f"{role}-{uuid.uuid4().hex[:8]}@example.com", role=role, roles=[role], **fields)


@pytest.fixture
def lesson():
    school = School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:6]}", email="s@example.com")
    teacher = Teacher.objects.create(user=_user(Role.TEACHER), name="Course Teacher", email="t@example.com")
    TeacherSchool.objects.create(teacher=teacher, school=school, active=True)
    lesson_type = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Ballet", active=True)
    course = Course.objects.create(school=school, lesson_type=lesson_type, teacher=teacher, name="Ballet I")
    return Lesson.objects.create(
        school=school, course=course, teacher=teacher, lesson_type=lesson_type,
        date=date.today() + timedelta(days=3), start_time=time(18), end_time=time(19),
    )


def _staff(school):
    api = APIClient()
    api.force_authenticate(user=_user(Role.SCHOOL, active_school=school))
    return api


def _student(school):
    return Student.objects.create(user=_user(Role.STUDENT), name="A", school=school)


def test_nobody_clears_the_teacher_and_blocks_the_course_fallback(lesson):
    api = _staff(lesson.school)
    res = api.patch(f"/api/school/classes/{lesson.id}/", {"teacher_id": None, "no_teacher": True}, format="json")
    assert res.status_code == 200
    lesson.refresh_from_db()
    assert lesson.teacher_id is None and lesson.no_teacher is True
    detail = api.get(f"/api/school/classes/{lesson.id}/").json()
    assert detail["teachers"] is None and detail["no_teacher"] is True
    assert lesson_email_context(_student(lesson.school), lesson, lesson.school)["teacher_name"] == ""


def test_course_default_still_falls_back_to_the_course_teacher(lesson):
    api = _staff(lesson.school)
    assert api.patch(f"/api/school/classes/{lesson.id}/", {"teacher_id": None}, format="json").status_code == 200
    lesson.refresh_from_db()
    assert lesson.teacher_id is None and lesson.no_teacher is False
    assert lesson_email_context(_student(lesson.school), lesson, lesson.school)["teacher_name"] == "Course Teacher"


def test_picking_a_teacher_again_lifts_nobody(lesson):
    api = _staff(lesson.school)
    api.patch(f"/api/school/classes/{lesson.id}/", {"teacher_id": None, "no_teacher": True}, format="json")
    res = api.patch(f"/api/school/classes/{lesson.id}/", {"teacher_id": str(lesson.course.teacher_id)}, format="json")
    assert res.status_code == 200
    lesson.refresh_from_db()
    assert lesson.teacher_id == lesson.course.teacher_id and lesson.no_teacher is False
    # a teacher and "nobody" in the same request: the teacher wins
    res = api.patch(
        f"/api/school/classes/{lesson.id}/", {"teacher_id": str(lesson.course.teacher_id), "no_teacher": True}, format="json"
    )
    assert res.status_code == 200
    lesson.refresh_from_db()
    assert lesson.teacher_id == lesson.course.teacher_id and lesson.no_teacher is False


def test_reports_show_no_fee_for_nobody_even_with_the_lessons_own_plan(lesson):
    plan = CompensationPlan.objects.create(school=lesson.school, name="Plan", base_fee=30)
    lesson.compensation_plan = plan
    lesson.save(update_fields=["compensation_plan"])
    api = _staff(lesson.school)
    api.patch(f"/api/school/classes/{lesson.id}/", {"teacher_id": None, "no_teacher": True}, format="json")
    report = api.get(f"/api/school/reports/detailed/?tab=lessons&from={lesson.date}&to={lesson.date}").json()["lessons"]
    (row,) = [r for r in report["rows"] if r["id"] == str(lesson.id)]
    assert row["compensation_fee"] is None and row["compensation_plan"] == "—" and row["teacher"] == "—"


def test_adding_a_class_with_a_teacher_and_nobody_keeps_the_teacher(lesson):
    """The same resolution as the class PATCH: an explicit teacher wins."""
    api = _staff(lesson.school)
    day = (date.today() + timedelta(days=10)).isoformat()
    res = api.post(
        "/api/school/classes/",
        {"course_id": str(lesson.course_id), "date": day, "start_time": "10:00", "duration_minutes": 60,
         "frequency": "single", "teacher_id": str(lesson.course.teacher_id), "no_teacher": True},
        format="json",
    )
    assert res.status_code in (200, 201), res.content
    added = Lesson.objects.get(course=lesson.course, date=day)
    assert added.teacher_id == lesson.course.teacher_id and added.no_teacher is False
    # nobody alone: no teacher, and the course's does not step in
    res = api.post(
        "/api/school/classes/",
        {"course_id": str(lesson.course_id), "date": day, "start_time": "12:00", "duration_minutes": 60,
         "frequency": "single", "no_teacher": True},
        format="json",
    )
    assert res.status_code in (200, 201), res.content
    added = Lesson.objects.get(course=lesson.course, date=day, start_time="12:00")
    assert added.teacher_id is None and added.no_teacher is True


def test_course_edit_keeps_nobody_on_future_classes_and_lists_it(lesson):
    """Editing the course with "update future classes" used to hand a
    "nobody" class back to the course's teacher: the edit page sent the
    course's teacher for it and the update cleared the flag. The schedule
    row now carries no_teacher, the update honours it, the Courses page
    schedule rows say so -- and a teacher on the row lifts the flag again."""
    from catalog.course_views import _weekday_name

    api = _staff(lesson.school)
    course = lesson.course
    lesson.teacher = None
    lesson.no_teacher = True
    lesson.save(update_fields=["teacher", "no_teacher"])
    weekday = _weekday_name(lesson.date)
    row = {
        "weekday": weekday, "original_weekday": weekday, "start_time": "18:00", "original_start_time": "18:00",
        "duration_minutes": 60, "teacher_id": None, "no_teacher": True, "end_date": lesson.date.isoformat(), "is_new": False,
    }
    body = {
        "lesson_type_id": str(lesson.lesson_type_id), "teacher_id": str(course.teacher_id),
        "start_time": "18:00", "duration_minutes": 60, "update_future_lessons": True, "schedules": [row],
    }
    res = api.put(f"/api/school/courses/{course.id}/full/", body, format="json")
    assert res.status_code in (200, 201), res.content
    lesson.refresh_from_db()
    assert lesson.teacher_id is None and lesson.no_teacher is True

    overview = api.get("/api/school/courses-overview/").json()
    schedules = next(c for c in overview if c["id"] == str(course.id))["_schedules"]
    assert [(s["no_teacher"], s["teacher_name"]) for s in schedules] == [(True, None)]

    row.update({"teacher_id": str(course.teacher_id), "no_teacher": False})
    assert api.put(f"/api/school/courses/{course.id}/full/", body, format="json").status_code in (200, 201)
    lesson.refresh_from_db()
    assert lesson.teacher_id == course.teacher_id and lesson.no_teacher is False
