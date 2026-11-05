"""Daily "we miss you" nudges: one email per threshold (15, 30, 90 days since
the last lesson), none for a student who is already booked again."""
import uuid
from datetime import time, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from bookings.models import Booking
from catalog.models import Course, Lesson, LessonType
from notifications.tasks import WINBACK_THRESHOLDS, absent_student_winback_task
from schools.models import School, SchoolStudent
from students.models import Student

pytestmark = pytest.mark.django_db


def _school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome")


def _student(school, locale="it"):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna Bo", school=school, language_preference=locale)
    SchoolStudent.objects.create(school=school, student=student)
    return student


def _booking(student, school, day, status=Booking.Status.ATTENDED):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(school=school, lesson_type=lt, credit_cost=Decimal("1.0"))
    lesson = Lesson.objects.create(
        school=school, course=course, lesson_type=lt, date=day, start_time=time(10, 0), end_time=time(11, 0),
        max_capacity=10, status="completed" if day <= timezone.localdate() else "scheduled",
    )
    return Booking.objects.create(student=student, lesson=lesson, school=school, status=status)


def test_the_three_thresholds_are_fifteen_thirty_and_ninety_days():
    assert [d for d, _ in WINBACK_THRESHOLDS] == [15, 30, 90]
    assert dict(WINBACK_THRESHOLDS)[15] == "student.we_miss_you_15d"


def test_fifteen_days_after_the_last_lesson_the_15d_email_goes_out():
    school = _school()
    today = timezone.localdate()
    hit = _student(school)
    _booking(hit, school, today - timedelta(days=15))
    _booking(hit, school, today - timedelta(days=40))        # an older one does not matter
    too_soon = _student(school)
    _booking(too_soon, school, today - timedelta(days=14))
    too_late = _student(school)
    _booking(too_late, school, today - timedelta(days=16))
    back_already = _student(school)
    _booking(back_already, school, today - timedelta(days=15))
    _booking(back_already, school, today + timedelta(days=3), status=Booking.Status.CONFIRMED)

    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed:
        assert absent_student_winback_task() == 1
    kwargs = delayed.call_args.kwargs
    assert kwargs["key"] == "student.we_miss_you_15d"
    assert kwargs["to_email"] == hit.user.email and kwargs["locale"] == "it"
    assert kwargs["context"]["days_absent"] == "15"
    assert kwargs["context"]["last_lesson_date"] == (today - timedelta(days=15)).strftime("%d-%m-%Y")
    assert kwargs["context"]["school_name"] == school.name


def test_each_threshold_picks_its_own_template():
    school = _school()
    today = timezone.localdate()
    for days, _ in WINBACK_THRESHOLDS:
        _booking(_student(school), school, today - timedelta(days=days))
    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed:
        assert absent_student_winback_task() == 3
    assert [c.kwargs["key"] for c in delayed.call_args_list] == [
        "student.we_miss_you_15d", "student.we_miss_you_1m", "student.we_miss_you_3m",
    ]


