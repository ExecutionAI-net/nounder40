"""GET /api/teacher/lessons-students/ -- the teacher calendar's "students"
filter (Carlo, 2026-09-22: the teacher calendar filters like the school's).
Same visibility as the lessons feed: her own lessons, plus the whole school's
when the school made her staff; ?scope=mine narrows back; cancelled bookings
are not there, exactly like the attendance page."""
import uuid
from datetime import date, time, timedelta

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from bookings.models import Booking
from catalog.models import Course, Lesson, LessonType
from schools.models import School
from students.models import Student
from teachers.models import Teacher, TeacherSchool

pytestmark = pytest.mark.django_db
User = get_user_model()
URL = "/api/teacher/lessons-students/"


@pytest.fixture
def school():
    return School.objects.create(name="Danza Milano", slug=f"s-{uuid.uuid4().hex[:8]}", email="milano@example.com")


@pytest.fixture
def lesson_type():
    return LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Base")


def make_teacher(school, name, **grants):
    user = User.objects.create(email=f"{name.lower()}-{uuid.uuid4().hex[:6]}@example.com", role=Role.TEACHER, roles=[Role.TEACHER])
    teacher = Teacher.objects.create(user=user, name=name, email=user.email)
    TeacherSchool.objects.create(teacher=teacher, school=school, active=True, **grants)
    return teacher


def client_for(teacher):
    api = APIClient()
    api.force_authenticate(user=teacher.user)
    return api


def make_lesson(school, lesson_type, teacher, day):
    course = Course.objects.create(school=school, lesson_type=lesson_type, credit_cost=1, min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type, teacher=teacher,
        date=day, start_time=time(18, 0), end_time=time(19, 0), max_capacity=10, status="scheduled",
    )


def make_student(school, name):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT])
    return Student.objects.create(user=user, name=name, school=school)


def book(student, lesson, status="confirmed"):
    return Booking.objects.create(student=student, lesson=lesson, school=lesson.school, status=status)


def test_her_students_by_lesson_sorted_by_name_without_cancelled(school, lesson_type):
    alessia = make_teacher(school, "Alessia")
    day = date.today() + timedelta(days=3)
    l1, l2 = make_lesson(school, lesson_type, alessia, day), make_lesson(school, lesson_type, alessia, day + timedelta(days=1))
    zoe, anna, bea = make_student(school, "Zoe"), make_student(school, "anna"), make_student(school, "Bea")
    book(zoe, l1)
    book(zoe, l2)
    book(anna, l1)
    book(bea, l2, status="cancelled")

    rows = client_for(alessia).get(URL, {"from": day.isoformat(), "to": (day + timedelta(days=7)).isoformat()}).json()
    assert [r["name"] for r in rows] == ["anna", "Zoe"]  # Bea only cancelled; case-insensitive order
    by_name = {r["name"]: set(r["lesson_ids"]) for r in rows}
    assert by_name["Zoe"] == {str(l1.id), str(l2.id)} and by_name["anna"] == {str(l1.id)}

    # the range narrows, like the feed
    rows = client_for(alessia).get(URL, {"from": day.isoformat(), "to": day.isoformat()}).json()
    assert {r["name"] for r in rows} == {"anna", "Zoe"} and all(r["lesson_ids"] == [str(l1.id)] for r in rows)


def test_colleagues_students_only_when_she_is_staff(school, lesson_type):
    alessia = make_teacher(school, "Alessia")
    marta = make_teacher(school, "Marta", can_view_all_lessons=True)
    day = date.today() + timedelta(days=3)
    mine, hers = make_lesson(school, lesson_type, alessia, day), make_lesson(school, lesson_type, marta, day)
    book(make_student(school, "Francesca"), mine)
    book(make_student(school, "Giulia"), hers)
    params = {"from": day.isoformat(), "to": day.isoformat()}

    assert [r["name"] for r in client_for(alessia).get(URL, params).json()] == ["Francesca"]
    assert [r["name"] for r in client_for(marta).get(URL, params).json()] == ["Francesca", "Giulia"]
    assert [r["name"] for r in client_for(marta).get(URL, {**params, "scope": "mine"}).json()] == ["Giulia"]

    # another school's lesson never shows, even for staff
    other = School.objects.create(name="Roma", slug=f"s-{uuid.uuid4().hex[:8]}", email="roma@example.com")
    book(make_student(other, "Rita"), make_lesson(other, lesson_type, make_teacher(other, "Sara"), day))
    assert [r["name"] for r in client_for(marta).get(URL, params).json()] == ["Francesca", "Giulia"]
