"""The confirmation email carries every placeholder the HQ editor offers —
a missing one renders as "" and "🕐 16:15 ()" reaches the student."""
import uuid
from datetime import date, time, timedelta
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from bookings.services import book_lesson
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolLocation, SchoolRoom
from students.models import Student, StudentPackage
from teachers.models import Teacher

pytestmark = pytest.mark.django_db

NEXT_MONDAY = date(2026, 9, 7)


@pytest.fixture
def school():
    return School.objects.create(name="Test School", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def student(school):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Francesca", school=school, language_preference="it")
    pkg = Package.objects.create(school=school, credits=10)
    StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=10, credits_remaining=10,
        expires_at=timezone.now() + timedelta(days=90),
    )
    return student


def _lesson(school, *, is_online=False):
    lesson_type = LessonType.objects.create(code=f"sbarra-{uuid.uuid4().hex[:6]}", name_en="Barre", name_it="Sbarra")
    teacher = Teacher.objects.create(name="Alessia", first_name="Alessia", last_name="Rossi")
    location = SchoolLocation.objects.create(school=school, name="Sede Centro", address="Via Roma 12")
    room = SchoolRoom.objects.create(location=location, name="Sala A")
    course = Course.objects.create(
        school=school, lesson_type=lesson_type, credit_cost=1, min_booking_notice_hours=0, is_online=is_online,
    )
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type, teacher=teacher, room=room,
        date=NEXT_MONDAY, start_time=time(16, 15), end_time=time(17, 30),
        max_capacity=10, status="scheduled", is_online=is_online, online_link="https://meet/x" if is_online else "",
    )


@pytest.fixture
def delayed():
    with patch("notifications.tasks.send_transactional_email_task.delay") as mock:
        yield mock


def test_confirmation_email_has_every_placeholder(school, student, delayed, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, _lesson(school))
    kwargs = delayed.call_args.kwargs
    assert kwargs["key"] == "booking_confirmed"
    assert kwargs["locale"] == "it"
    assert kwargs["context"] == {
        "student_name": "Francesca", "school_name": "Test School",
        "lesson_name": "Sbarra", "lesson_date": "07-09-2026", "lesson_time": "16:15", "lesson_duration": "75 min",
        "teacher_name": "Alessia Rossi", "location_name": "Sede Centro", "location_address": "Via Roma 12",
        "room_name": "Sala A", "online_link": "",
        "booking_url": kwargs["context"]["booking_url"],
    }
    assert kwargs["context"]["booking_url"].endswith("/it/student/bookings")


def test_online_lesson_uses_the_online_template(school, student, delayed, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, _lesson(school, is_online=True))
    kwargs = delayed.call_args.kwargs
    assert kwargs["key"] == "student.booking_confirmed.online"
    assert kwargs["context"]["online_link"] == "https://meet/x"
