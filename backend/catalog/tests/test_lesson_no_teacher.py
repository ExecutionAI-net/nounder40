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
from teachers.models import Teacher, TeacherSchool

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
