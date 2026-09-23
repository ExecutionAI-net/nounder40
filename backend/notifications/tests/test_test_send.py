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


def _booking(school, *, is_online, lesson_link="", course_link="", day=date(2026, 9, 8), at=time(16, 15)):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Francesca", school=school)
    lt = LessonType.objects.create(code=f"sb-{uuid.uuid4().hex[:6]}", name_en="Barre", name_it="Sbarra")
    course = Course.objects.create(school=school, lesson_type=lt, credit_cost=1, is_online=is_online, online_link=course_link)
    lesson = Lesson.objects.create(
        school=school, course=course, lesson_type=lt, teacher=Teacher.objects.create(name="Alessia"),
        is_online=is_online, online_link=lesson_link,
        date=day, start_time=at, end_time=time(at.hour + 1, at.minute), status="scheduled",
    )
    return Booking.objects.create(student=student, lesson=lesson, school=school, status=Booking.Status.CONFIRMED)


def test_an_online_template_renders_with_an_online_booking_that_has_a_link():
    """Carlo, 2026-09-23: the test email of the ".online" template came out
    with a blank join link because the NEWEST booking on the platform was in
    a studio. The template's kind picks the booking now."""
    school = School.objects.create(name="Danza Barcelona", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")
    _booking(school, is_online=True, lesson_link="https://zoom.us/j/111", day=date(2026, 9, 1))
    _booking(school, is_online=True, lesson_link="", course_link="https://zoom.us/j/222", day=date(2026, 9, 5))
    _booking(school, is_online=True, lesson_link="", course_link="", day=date(2026, 9, 6))  # online, no link anywhere
    _booking(school, is_online=False, day=date(2026, 9, 8))  # the newest booking: in a studio

    online = _test_send_context("it", key="student.booking_confirmed.online")
    assert online["online_link"] == "https://zoom.us/j/222"  # the newest online booking WITH a link (the course's)

    studio = _test_send_context("it", key="student.booking_confirmed")
    assert studio["online_link"] == "" and studio["lesson_date"] == "08-09-2026"

    # an in-person template on a platform with online bookings only still renders with a real one
    Booking.objects.filter(lesson__is_online=False).delete()
    assert _test_send_context("it", key="student.booking_confirmed")["lesson_name"] == "Sbarra"


def test_without_an_online_booking_the_sample_link_stays():
    school = School.objects.create(name="Danza Barcelona", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")
    _booking(school, is_online=False)
    ctx = _test_send_context("it", key="student.lesson_reminder_1day.online")
    assert ctx["online_link"] == _SAMPLE_VARS["online_link"]
    assert ctx["lesson_name"] == "Fondamenti di danza classica"  # the localized sample, not the studio booking
