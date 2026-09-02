"""HQ "Invia test" renders with a real booking, so an empty placeholder is
caught in HQ rather than in a student's inbox."""
import uuid
from datetime import date, time

import pytest
from django.contrib.auth import get_user_model

from bookings.models import Booking
from catalog.models import Course, Lesson, LessonType
from notifications.views import _SAMPLE_VARS, _test_send_context
from schools.models import School, SchoolLocation, SchoolRoom
from students.models import Student
from teachers.models import Teacher

pytestmark = pytest.mark.django_db


def test_empty_database_falls_back_to_samples_with_a_real_booking_url():
    ctx = _test_send_context("it")
    assert ctx["location_address"] == _SAMPLE_VARS["location_address"]
    assert ctx["booking_url"].endswith("/it/student/bookings")


def test_latest_real_booking_fills_lesson_placeholders():
    school = School.objects.create(name="Danza Barcelona", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Francesca", school=school)
    location = SchoolLocation.objects.create(school=school, name="Sede", address="Carrer Gran 1")
    room = SchoolRoom.objects.create(location=location, name="Sala B")
    lt = LessonType.objects.create(code=f"sb-{uuid.uuid4().hex[:6]}", name_en="Barre", name_it="Sbarra")
    course = Course.objects.create(school=school, lesson_type=lt, credit_cost=1)
    lesson = Lesson.objects.create(
        school=school, course=course, lesson_type=lt, room=room,
        teacher=Teacher.objects.create(name="Alessia"),
        date=date(2026, 9, 8), start_time=time(16, 15), end_time=time(17, 15), status="scheduled",
    )
    Booking.objects.create(student=student, lesson=lesson, school=school, status=Booking.Status.CONFIRMED)

    ctx = _test_send_context("it")
    assert ctx["student_name"] == "Francesca"
    assert ctx["lesson_name"] == "Sbarra"
    assert ctx["location_address"] == "Carrer Gran 1"
    assert ctx["teacher_name"] == "Alessia"
    assert ctx["credits_remaining"] == _SAMPLE_VARS["credits_remaining"]  # not a booking field: sample stays
