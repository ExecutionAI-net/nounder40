"""Teacher attendance marking (QA report #10 and #26):

- a teacher must not be able to mark attendance for a lesson that hasn't
  happened yet (its start datetime is still in the future) — this was
  creating phantom compensation debt on the school's Compensation page for
  lessons that had not occurred;
- marking attendance right after class ends on the SAME day must keep working
  (the guard compares full start datetime, not just the calendar date);
- `_apply_marks()`'s status_id-only fallback must derive the correct
  `Attendance.Status` from `AttendanceStatus.burns_credit`. `burns_credit` is
  the "Counts as absence" flag a school sets on a custom status (School
  Settings -> Attendance Statuses: "With this status the lesson is recorded
  as an absence"), so burns_credit=True -> no_show, burns_credit=False ->
  present. (QA full-regression C1: the derivation used to be inverted —
  burns_credit=True produced `present` — the exact opposite of the label.)
"""
import uuid
from datetime import date, datetime, time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from bookings.attendance_views import _apply_marks
from bookings.models import Attendance, Booking
from catalog.models import AttendanceStatus, Course, Lesson, LessonType
from schools.models import School
from students.models import Student
from teachers.models import Teacher

pytestmark = pytest.mark.django_db


@pytest.fixture
def school():
    return School.objects.create(name="Test School", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def lesson_type():
    return LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Flex")


@pytest.fixture
def teacher(school):
    user = get_user_model().objects.create(email=f"teach-{uuid.uuid4().hex[:8]}@example.com")
    return Teacher.objects.create(user=user, name="Teach", email=user.email)


@pytest.fixture
def student(school):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name="Stu", school=school)


def make_lesson(school, lesson_type, teacher, *, day, at=time(18, 0)):
    course = Course.objects.create(school=school, lesson_type=lesson_type, credit_cost=1, min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type, teacher=teacher,
        date=day, start_time=at, end_time=time((at.hour + 1) % 24, at.minute),
        max_capacity=10, current_bookings=1, status="scheduled",
    )


def book(student, lesson, school):
    return Booking.objects.create(
        student=student, lesson=lesson, school=school,
        status=Booking.Status.CONFIRMED, credits_deducted=1,
    )


def attendance_url(lesson_id):
    return f"/api/teacher/attendance/{lesson_id}/"


# ---- Bug A: future lesson guard ----

def test_future_lesson_attendance_is_rejected(school, lesson_type, teacher, student):
    future_day = timezone.localdate() + timedelta(days=2)
    lesson = make_lesson(school, lesson_type, teacher, day=future_day)
    book(student, lesson, school)

    client = APIClient()
    client.force_authenticate(teacher.user)
    resp = client.post(
        attendance_url(lesson.id), [{"student_id": str(student.id), "status": "present"}], format="json"
    )

    assert resp.status_code == 400
    assert resp.data["error"] == "lesson_not_yet_occurred"
    # No attendance record was written, and the lesson wasn't flipped to
    # "completed" — the compensation calculator only counts real Attendance
    # rows, so this alone is enough to prove no phantom debt was created.
    assert not Attendance.objects.filter(lesson=lesson, student=student).exists()
    lesson.refresh_from_db()
    assert lesson.status == "scheduled"


def test_future_lesson_same_day_but_not_yet_started_is_rejected(school, lesson_type, teacher, student):
    """A lesson scheduled later *today* hasn't happened yet either — the guard
    must key off the full start datetime, not just date == today."""
    now = timezone.localtime()
    later_today = (now + timedelta(hours=3)).time()
    # Guard against the added hours crossing midnight in this environment.
    if later_today <= now.time():
        pytest.skip("test run too close to midnight for a same-day 'later' lesson")
    lesson = make_lesson(school, lesson_type, teacher, day=now.date(), at=later_today)
    book(student, lesson, school)

    client = APIClient()
    client.force_authenticate(teacher.user)
    resp = client.post(
        attendance_url(lesson.id), [{"student_id": str(student.id), "status": "present"}], format="json"
    )

    assert resp.status_code == 400
    assert resp.data["error"] == "lesson_not_yet_occurred"


def test_past_lesson_attendance_still_works(school, lesson_type, teacher, student):
    """Happy path must not regress: a lesson that has already happened
    (yesterday) can still be marked, updates the booking, and flips the
    lesson to 'completed'."""
    past_day = timezone.localdate() - timedelta(days=1)
    lesson = make_lesson(school, lesson_type, teacher, day=past_day)
    booking = book(student, lesson, school)

    client = APIClient()
    client.force_authenticate(teacher.user)
    resp = client.post(
        attendance_url(lesson.id), [{"student_id": str(student.id), "status": "present"}], format="json"
    )

    assert resp.status_code == 200
    assert resp.data["results"] == [{"student_id": str(student.id), "ok": True}]
    att = Attendance.objects.get(lesson=lesson, student=student)
    assert att.status == Attendance.Status.PRESENT
    booking.refresh_from_db()
    assert booking.status == Booking.Status.ATTENDED
    lesson.refresh_from_db()
    assert lesson.status == "completed"


def test_same_day_attendance_after_class_started_works(school, lesson_type, teacher, student):
    """A teacher marking attendance right after class ends on the SAME day
    must not be blocked — the classic legitimate case the guard must not
    regress."""
    now = timezone.localtime()
    earlier_today = (now - timedelta(hours=1)).time()
    if earlier_today >= now.time():
        pytest.skip("test run too close to midnight for a same-day 'earlier' lesson")
    lesson = make_lesson(school, lesson_type, teacher, day=now.date(), at=earlier_today)
    book(student, lesson, school)

    client = APIClient()
    client.force_authenticate(teacher.user)
    resp = client.post(
        attendance_url(lesson.id), [{"student_id": str(student.id), "status": "present"}], format="json"
    )

    assert resp.status_code == 200
    assert Attendance.objects.filter(lesson=lesson, student=student, status=Attendance.Status.PRESENT).exists()


# ---- Bug B (QA C1): _apply_marks() status_id-only fallback direction ----
#
# `burns_credit` is the "Counts as absence" toggle a school sees in School
# Settings -> Attendance Statuses. burns_credit=True must derive to NO_SHOW
# (an absence) and burns_credit=False must derive to PRESENT — previously
# this was backwards (burns_credit=True produced `present`), which corrupted
# no-show rate/attendance rate, let an absent student count toward a
# teacher's bonus headcount, and suppressed the no-show email.

def test_apply_marks_derives_no_show_when_status_ref_burns_credit(school, lesson_type, teacher, student):
    past_day = timezone.localdate() - timedelta(days=1)
    lesson = make_lesson(school, lesson_type, teacher, day=past_day)
    book(student, lesson, school)
    status_ref = AttendanceStatus.objects.create(school=school, name="Assente", burns_credit=True)

    results = _apply_marks(lesson, teacher, [{"student_id": str(student.id), "status_id": str(status_ref.id)}])

    assert results == [{"student_id": str(student.id), "ok": True}]
    att = Attendance.objects.get(lesson=lesson, student=student)
    assert att.status == Attendance.Status.NO_SHOW
    assert att.status_ref_id == status_ref.id


def test_apply_marks_derives_present_when_status_ref_does_not_burn_credit(school, lesson_type, teacher, student):
    past_day = timezone.localdate() - timedelta(days=1)
    lesson = make_lesson(school, lesson_type, teacher, day=past_day)
    book(student, lesson, school)
    status_ref = AttendanceStatus.objects.create(school=school, name="Presente", burns_credit=False)

    results = _apply_marks(lesson, teacher, [{"student_id": str(student.id), "status_id": str(status_ref.id)}])

    assert results == [{"student_id": str(student.id), "ok": True}]
    att = Attendance.objects.get(lesson=lesson, student=student)
    assert att.status == Attendance.Status.PRESENT
    assert att.status_ref_id == status_ref.id
