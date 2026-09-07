"""QA regression (bonus finding, Teacher/HQ/School UX group): TeacherStatsView's
"present" field feeds the "Students Followed" KPI on the teacher Performance
page (frontend/src/app/[locale]/teacher/performance/page.tsx), but it used to
be a straight count of Attendance rows with status="present" -- so a teacher
who sees the same student across several lessons had that one student counted
once per lesson instead of once. Fixed by counting distinct student ids for
the "present" field, while keeping "no_show"/"attendance_rate" on the
original row-based count (they are rates over attendance *events*, not over
students, so they must stay consistent with "attendance_marked").
"""
import uuid
from datetime import time

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from bookings.models import Attendance
from catalog.models import Course, Lesson, LessonType
from schools.models import School
from students.models import Student
from teachers.models import Teacher, TeacherSchool

pytestmark = pytest.mark.django_db


def _client(user):
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


@pytest.fixture
def school():
    return School.objects.create(name="Test School", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def lesson_type():
    return LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Flex")


@pytest.fixture
def teacher(school):
    user = get_user_model().objects.create(email=f"teach-{uuid.uuid4().hex[:8]}@example.com")
    teacher = Teacher.objects.create(user=user, name="Teach", email=user.email)
    TeacherSchool.objects.create(teacher=teacher, school=school, active=True)
    return teacher


@pytest.fixture
def student():
    user = get_user_model().objects.create(email=f"stud-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name="Same Student")


def make_lesson(school, lesson_type, teacher, *, day, at=time(18, 0)):
    course = Course.objects.create(school=school, lesson_type=lesson_type, credit_cost=1, min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type, teacher=teacher,
        date=day, start_time=at, end_time=time((at.hour + 1) % 24, at.minute),
        max_capacity=10, current_bookings=0, status="completed",
    )


def test_present_counts_distinct_students_not_attendance_rows(school, lesson_type, teacher, student):
    past_day = timezone.localdate()
    lesson_a = make_lesson(school, lesson_type, teacher, day=past_day)
    lesson_b = make_lesson(school, lesson_type, teacher, day=past_day)

    # Same student, marked present in two different lessons taught by the
    # same teacher -- one real student, two attendance rows.
    Attendance.objects.create(lesson=lesson_a, student=student, teacher=teacher, status="present")
    Attendance.objects.create(lesson=lesson_b, student=student, teacher=teacher, status="present")

    res = _client(teacher.user).get("/api/teacher/stats/")

    assert res.status_code == 200
    data = res.json()
    # The KPI must count the student once, not once per attendance row.
    assert data["present"] == 1
    # Row-based figures stay row-based: two attendance rows marked, both
    # present, so no_show is 0 and the rate is 100% -- unaffected by the
    # distinct-student fix above.
    assert data["attendance_marked"] == 2
    assert data["no_show"] == 0
    assert data["attendance_rate"] == 1.0


def test_present_counts_two_when_two_different_students(school, lesson_type, teacher, student):
    other_user = get_user_model().objects.create(email=f"stud2-{uuid.uuid4().hex[:8]}@example.com")
    other_student = Student.objects.create(user=other_user, name="Other Student")
    past_day = timezone.localdate()
    lesson = make_lesson(school, lesson_type, teacher, day=past_day)

    Attendance.objects.create(lesson=lesson, student=student, teacher=teacher, status="present")
    lesson_b = make_lesson(school, lesson_type, teacher, day=past_day)
    Attendance.objects.create(lesson=lesson_b, student=other_student, teacher=teacher, status="present")

    res = _client(teacher.user).get("/api/teacher/stats/")

    assert res.status_code == 200
    data = res.json()
    assert data["present"] == 2
