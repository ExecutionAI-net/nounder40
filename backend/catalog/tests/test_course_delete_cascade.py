"""QA #7 "ghost lessons": deleting a Course must not leave future,
still-bookable, calendar-visible Lesson rows behind with no cleanup path.

Policy under test (see catalog.services.cascade_delete_course):
  - past lessons: left alone (course goes NULL, historical record).
  - future lessons with no confirmed booking: hard-deleted.
  - future lessons WITH a confirmed booking: booking refunded+cancelled,
    Lesson marked cancelled (not deleted, so the refunded Booking survives —
    Booking.lesson is on_delete=CASCADE).

Exercised through BOTH course-delete endpoints — the generic router DELETE
(CourseViewSet, previously unguarded) and the school panel's own
.../full/ endpoint (SchoolCourseDetailView) — since both must share the
same policy now.
"""
import uuid
from datetime import date, time, timedelta
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role
from bookings.models import Booking
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def lesson_type():
    return LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")


@pytest.fixture
def course(school, lesson_type):
    return Course.objects.create(
        school=school, lesson_type=lesson_type, credit_cost=1, language="it",
        start_time=time(10, 0), duration_minutes=60,
    )


@pytest.fixture
def student(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name="Anna", school=school)


@pytest.fixture
def staff_client(school):
    staff = User.objects.create(
        email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    client = APIClient()
    client.force_authenticate(staff)
    return client


def _lesson(school, course, lesson_type, *, d, language=""):
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type, date=d, language=language,
        start_time=time(10, 0), end_time=time(11, 0), max_capacity=10, status="scheduled",
    )


def _booking(student, school, lesson, *, sp):
    b = Booking.objects.create(
        student=student, lesson=lesson, school=school, access_source="package",
        student_package=sp, credits_deducted=1, status="confirmed", booked_at=timezone.now(),
    )
    lesson.current_bookings = 1
    lesson.save(update_fields=["current_bookings"])
    return b


def _package(student, school):
    pkg = Package.objects.create(school=school, credits=10)
    return StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=10, credits_remaining=9,
        expires_at=timezone.now() + timedelta(days=90),
    )


@pytest.mark.parametrize("endpoint", ["bare", "full"])
def test_delete_hard_deletes_future_lesson_without_booking(endpoint, school, course, lesson_type, staff_client):
    future_empty = _lesson(school, course, lesson_type, d=date.today() + timedelta(days=7))

    url = (
        f"/api/school/courses/{course.id}/"
        if endpoint == "bare"
        else f"/api/school/courses/{course.id}/full/"
    )
    res = staff_client.delete(url)
    assert res.status_code in (200, 204)
    assert not Course.objects.filter(pk=course.id).exists()
    assert not Lesson.objects.filter(pk=future_empty.pk).exists()


@pytest.mark.parametrize("endpoint", ["bare", "full"])
def test_delete_leaves_past_lesson_untouched(endpoint, school, course, lesson_type, staff_client):
    past = _lesson(school, course, lesson_type, d=date.today() - timedelta(days=7))

    url = (
        f"/api/school/courses/{course.id}/"
        if endpoint == "bare"
        else f"/api/school/courses/{course.id}/full/"
    )
    res = staff_client.delete(url)
    assert res.status_code in (200, 204)

    past.refresh_from_db()
    assert past.course_id is None  # SET_NULL, historical record kept
    assert past.status == "scheduled"  # never touched


@pytest.mark.parametrize("endpoint", ["bare", "full"])
def test_delete_refunds_and_cancels_future_lesson_with_booking(
    endpoint, school, course, lesson_type, student, staff_client, django_capture_on_commit_callbacks,
):
    future_booked = _lesson(school, course, lesson_type, d=date.today() + timedelta(days=7))
    sp = _package(student, school)
    booking = _booking(student, school, future_booked, sp=sp)

    url = (
        f"/api/school/courses/{course.id}/"
        if endpoint == "bare"
        else f"/api/school/courses/{course.id}/full/"
    )
    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, django_capture_on_commit_callbacks(execute=True):
        res = staff_client.delete(url)
    assert res.status_code in (200, 204)

    # Lesson survives (not deleted out from under the booking) but is cancelled.
    future_booked.refresh_from_db()
    assert future_booked.status == "cancelled"
    assert future_booked.course_id is None

    booking.refresh_from_db()
    assert booking.status == "cancelled"
    assert booking.credit_refunded is True
    sp.refresh_from_db()
    assert sp.credits_remaining == 10  # 9 + 1 refunded
    assert [c.kwargs["key"] for c in delayed.call_args_list] == ["lesson_cancelled_by_school"]


def test_bare_endpoint_stamps_course_language_before_delete(school, course, lesson_type, staff_client):
    """Deleting nulls Lesson.course — the inherited language must be stamped
    onto lessons first, or booking/credit history silently loses it."""
    past = _lesson(school, course, lesson_type, d=date.today() - timedelta(days=1), language="")
    res = staff_client.delete(f"/api/school/courses/{course.id}/")
    assert res.status_code in (200, 204)
    past.refresh_from_db()
    assert past.language == "it"
