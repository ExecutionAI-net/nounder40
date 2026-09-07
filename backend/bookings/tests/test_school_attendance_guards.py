"""School-side attendance guards (QA round 2: SCH-R2-08 / R2-M5 and
TCH-R2-03 / R2-M10).

Two holes on the credit-burn path:

- `SchoolAttendanceView.post` had no "has this lesson happened" check, so the
  school panel could mark a lesson two weeks ahead as an absence and fire the
  "we missed you today" e-mail. The teacher endpoint already returned
  `lesson_not_yet_occurred`; the two must behave identically.
- `_apply_marks()` turned an unknown or foreign `status_id` into
  `status_ref=None` and derived PRESENT from it, silently overwriting the
  previous mark. Statuses are a per-school configurable matrix
  (`AttendanceStatus.burns_credit`), so the id must be validated against the
  lesson's own school and rejected otherwise — never defaulted.

Attendance never moves credits (bookings.services.mark_attendance), so every
test here also asserts the wallet is untouched.
"""
import uuid
from datetime import time, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from bookings.models import Attendance, Booking
from catalog.models import AttendanceStatus, Course, Lesson, LessonType
from schools.models import School, SchoolMembership
from students.models import Student, StudentPackage
from teachers.models import Teacher

pytestmark = pytest.mark.django_db


@pytest.fixture
def school():
    return School.objects.create(name="Att School", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def other_school():
    return School.objects.create(name="Other School", slug=f"o-{uuid.uuid4().hex[:8]}", email="o@example.com")


@pytest.fixture
def lesson_type():
    return LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Flex")


@pytest.fixture
def teacher():
    user = get_user_model().objects.create(email=f"teach-{uuid.uuid4().hex[:8]}@example.com")
    return Teacher.objects.create(user=user, name="Teach", email=user.email)


@pytest.fixture
def student(school):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name="Stu", school=school)


@pytest.fixture
def school_admin(school):
    user = get_user_model().objects.create(
        email=f"adm-{uuid.uuid4().hex[:8]}@example.com", role="school", roles=["school"],
    )
    user.active_school = school
    user.save()
    SchoolMembership.objects.create(profile=user, school=school, sub_role="admin")
    return user


def make_lesson(school, lesson_type, teacher, *, day, at=time(18, 0)):
    course = Course.objects.create(school=school, lesson_type=lesson_type, credit_cost=1, min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type, teacher=teacher,
        date=day, start_time=at, end_time=time((at.hour + 1) % 24, at.minute),
        max_capacity=10, current_bookings=1, status="scheduled",
    )


def wallet(student, school):
    """Half-credit steps: the balance is a Decimal, never a float."""
    return StudentPackage.objects.create(
        student=student, school=school, credits_total=Decimal("5.0"),
        credits_remaining=Decimal("5.0"), status="active", purchased_at=timezone.now(),
    )


def book(student, lesson, school, pkg=None):
    return Booking.objects.create(
        student=student, lesson=lesson, school=school, student_package=pkg,
        status=Booking.Status.CONFIRMED, credits_deducted=Decimal("1.0"),
    )


def school_url(lesson_id):
    return f"/api/school/attendance/{lesson_id}/"


def teacher_url(lesson_id):
    return f"/api/teacher/attendance/{lesson_id}/"


# ---- SCH-R2-08 / R2-M5: school endpoint must refuse a future lesson ----

def test_school_attendance_on_a_future_lesson_is_rejected(
    school, lesson_type, teacher, student, school_admin
):
    lesson = make_lesson(school, lesson_type, teacher, day=timezone.localdate() + timedelta(days=16))
    pkg = wallet(student, school)
    booking = book(student, lesson, school, pkg)
    absent = AttendanceStatus.objects.create(school=school, name="Assente", burns_credit=True)

    client = APIClient()
    client.force_authenticate(school_admin)
    resp = client.post(
        school_url(lesson.id),
        {"attendance": [{"student_id": str(student.id), "status_id": str(absent.id)}]},
        format="json",
    )

    assert resp.status_code == 400
    assert resp.data["error"] == "lesson_not_yet_occurred"
    # Nothing written -> nothing to trigger the no_show e-mail, which is
    # dispatched from mark_attendance() when the booking flips to no_show.
    assert not Attendance.objects.filter(lesson=lesson).exists()
    booking.refresh_from_db()
    assert booking.status == Booking.Status.CONFIRMED
    lesson.refresh_from_db()
    assert lesson.status == "scheduled"
    pkg.refresh_from_db()
    assert pkg.credits_remaining == Decimal("5.0")


def test_school_attendance_on_a_past_lesson_still_works(
    school, lesson_type, teacher, student, school_admin
):
    lesson = make_lesson(school, lesson_type, teacher, day=timezone.localdate() - timedelta(days=1))
    pkg = wallet(student, school)
    book(student, lesson, school, pkg)
    absent = AttendanceStatus.objects.create(school=school, name="Assente", burns_credit=True)

    client = APIClient()
    client.force_authenticate(school_admin)
    resp = client.post(
        school_url(lesson.id),
        {"attendance": [{"student_id": str(student.id), "status_id": str(absent.id)}]},
        format="json",
    )

    assert resp.status_code == 200
    assert resp.data["results"] == [{"student_id": str(student.id), "ok": True}]
    att = Attendance.objects.get(lesson=lesson, student=student)
    assert att.status == Attendance.Status.NO_SHOW  # burns_credit=True
    pkg.refresh_from_db()
    assert pkg.credits_remaining == Decimal("5.0")  # attendance never moves credits


# ---- TCH-R2-03 / R2-M10: unknown or foreign status_id ----

def _mark_then_probe(client, url, student, good_status, probe_status_id):
    """Mark once with a valid status, then re-post with `probe_status_id` and
    return the second response — the previous mark must survive it."""
    ok = client.post(
        url, {"attendance": [{"student_id": str(student.id), "status_id": str(good_status.id)}]}, format="json"
    )
    assert ok.status_code == 200
    return client.post(
        url, {"attendance": [{"student_id": str(student.id), "status_id": probe_status_id}]}, format="json"
    )


def test_unknown_status_id_is_rejected_and_does_not_overwrite(
    school, lesson_type, teacher, student, school_admin
):
    lesson = make_lesson(school, lesson_type, teacher, day=timezone.localdate() - timedelta(days=1))
    pkg = wallet(student, school)
    book(student, lesson, school, pkg)
    late = AttendanceStatus.objects.create(school=school, name="Ritardo", burns_credit=False)

    client = APIClient()
    client.force_authenticate(school_admin)
    resp = _mark_then_probe(
        client, school_url(lesson.id), student, late, "00000000-0000-0000-0000-0000000000aa",
    )

    assert resp.status_code == 400
    assert resp.data["error"] == "invalid_status_id"
    assert resp.data["results"] == [
        {"student_id": str(student.id), "ok": False, "error": "invalid_status_id"}
    ]
    att = Attendance.objects.get(lesson=lesson, student=student)
    assert att.status_ref_id == late.id  # the first mark survived
    assert att.status == Attendance.Status.PRESENT
    pkg.refresh_from_db()
    assert pkg.credits_remaining == Decimal("5.0")


def test_foreign_school_status_id_is_rejected(
    school, other_school, lesson_type, teacher, student, school_admin
):
    lesson = make_lesson(school, lesson_type, teacher, day=timezone.localdate() - timedelta(days=1))
    pkg = wallet(student, school)
    book(student, lesson, school, pkg)
    late = AttendanceStatus.objects.create(school=school, name="Ritardo", burns_credit=False)
    foreign = AttendanceStatus.objects.create(school=other_school, name="Foreign", burns_credit=True)

    client = APIClient()
    client.force_authenticate(school_admin)
    resp = _mark_then_probe(client, school_url(lesson.id), student, late, str(foreign.id))

    assert resp.status_code == 400
    assert resp.data["error"] == "invalid_status_id"
    att = Attendance.objects.get(lesson=lesson, student=student)
    assert att.status_ref_id == late.id
    pkg.refresh_from_db()
    assert pkg.credits_remaining == Decimal("5.0")


def test_teacher_endpoint_rejects_an_unknown_status_id_too(school, lesson_type, teacher, student):
    """Same rule on both endpoints — the teacher register is where a status
    deleted mid-session actually shows up."""
    lesson = make_lesson(school, lesson_type, teacher, day=timezone.localdate() - timedelta(days=1))
    book(student, lesson, school)

    client = APIClient()
    client.force_authenticate(teacher.user)
    resp = client.post(
        teacher_url(lesson.id),
        [{"student_id": str(student.id), "status_id": "00000000-0000-0000-0000-0000000000aa"}],
        format="json",
    )

    assert resp.status_code == 400
    assert resp.data["error"] == "invalid_status_id"
    assert not Attendance.objects.filter(lesson=lesson).exists()


def test_a_valid_status_id_is_still_accepted_and_burns_per_the_matrix(
    school, lesson_type, teacher, student, school_admin
):
    """The fix must not hardcode present/no_show: the derivation still comes
    from the school's own AttendanceStatus.burns_credit flag."""
    lesson = make_lesson(school, lesson_type, teacher, day=timezone.localdate() - timedelta(days=1))
    book(student, lesson, school)
    burning = AttendanceStatus.objects.create(school=school, name="Assente", burns_credit=True)
    non_burning = AttendanceStatus.objects.create(school=school, name="Presente", burns_credit=False)

    client = APIClient()
    client.force_authenticate(school_admin)
    for status_ref, expected in ((burning, Attendance.Status.NO_SHOW), (non_burning, Attendance.Status.PRESENT)):
        resp = client.post(
            school_url(lesson.id),
            {"attendance": [{"student_id": str(student.id), "status_id": str(status_ref.id)}]},
            format="json",
        )
        assert resp.status_code == 200
        att = Attendance.objects.get(lesson=lesson, student=student)
        assert (att.status, att.status_ref_id) == (expected, status_ref.id)
