"""SCH-R3-14c: a school-side cancellation has to give the seat back.

`Lesson.current_bookings` is denormalised on purpose and every transition is
supposed to bump it (bookings/signals.py says so in its header). Two paths
do: `cancel_booking()` via `_bump_lesson`, and a hard delete via
`free_seat_on_booking_delete`. The lesson- and course-level cancellations
flip `Booking.status` with a queryset `.update()`, which fires no signal and
calls no service -- so the seat stayed taken.

Not cosmetic: the school can PATCH the lesson back to `scheduled` and the
phantom occupant comes with it, and every reader trusts the stored count.
"""
import uuid
from datetime import date, datetime, time, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from bookings.models import Booking
from bookings.services import book_lesson
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolMembership, SchoolStudent
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()

FAR = date(2027, 12, 1)


@pytest.fixture
def school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome",
    )


@pytest.fixture
def owner_client(school):
    user = User.objects.create(
        email=f"own-{uuid.uuid4().hex[:8]}@example.com", role="school", roles=["school"], active_school=school,
    )
    SchoolMembership.objects.create(school=school, profile=user, sub_role="owner")
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def lesson_type():
    return LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")


def _course(school, lesson_type, **kwargs):
    return Course.objects.create(
        school=school, lesson_type=lesson_type, credit_cost=Decimal("1"),
        min_booking_notice_hours=0, **kwargs,
    )


def _lesson(school, course, lesson_type, *, day=FAR, capacity=1):
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type, date=day,
        start_time=time(10, 0), end_time=time(11, 0), max_capacity=capacity, status="scheduled",
    )


def _student(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna", school=school)
    SchoolStudent.objects.create(school=school, student=student)
    pkg = Package.objects.create(school=school, credits=Decimal("10"))
    StudentPackage.objects.create(
        student=student, school=school, package=pkg,
        credits_total=Decimal("10"), credits_remaining=Decimal("10"),
        expires_at=datetime(2029, 1, 1, tzinfo=dt_timezone.utc),
    )
    return student


def test_cancelling_one_class_frees_its_seat(school, owner_client, lesson_type):
    lesson = _lesson(school, _course(school, lesson_type), lesson_type)
    book_lesson(_student(school), lesson, now=datetime(2027, 1, 1, tzinfo=dt_timezone.utc))
    lesson.refresh_from_db()
    assert lesson.current_bookings == 1

    assert owner_client.delete(f"/api/school/classes/{lesson.id}/").status_code in (200, 204)
    lesson.refresh_from_db()
    assert lesson.status == "cancelled"
    assert lesson.current_bookings == 0


def test_a_reactivated_class_does_not_inherit_the_phantom_seat(school, owner_client, lesson_type):
    """The reason this is not cosmetic: capacity 1, so a stale seat makes the
    lesson permanently full for everybody else."""
    lesson = _lesson(school, _course(school, lesson_type), lesson_type, capacity=1)
    book_lesson(_student(school), lesson, now=datetime(2027, 1, 1, tzinfo=dt_timezone.utc))
    owner_client.delete(f"/api/school/classes/{lesson.id}/")

    resp = owner_client.patch(f"/api/school/classes/{lesson.id}/", {"status": "scheduled"}, format="json")
    assert resp.status_code == 200, resp.data
    lesson.refresh_from_db()
    assert (lesson.status, lesson.current_bookings) == ("scheduled", 0)

    # A different student can now take the seat the cancelled booking left.
    booking = book_lesson(_student(school), lesson, now=datetime(2027, 1, 1, tzinfo=dt_timezone.utc))
    assert booking.status == Booking.Status.CONFIRMED


def test_deleting_a_course_frees_the_seats_of_the_lessons_it_cancels(school, owner_client, lesson_type):
    course = _course(school, lesson_type)
    booked = _lesson(school, course, lesson_type, day=FAR, capacity=5)
    book_lesson(_student(school), booked, now=datetime(2027, 1, 1, tzinfo=dt_timezone.utc))
    book_lesson(_student(school), booked, now=datetime(2027, 1, 1, tzinfo=dt_timezone.utc))
    booked.refresh_from_db()
    assert booked.current_bookings == 2

    assert owner_client.delete(f"/api/school/courses/{course.id}/full/").status_code in (200, 204)
    booked.refresh_from_db()
    assert booked.status == "cancelled"
    assert booked.current_bookings == 0


def test_attended_and_no_show_seats_are_not_given_back(school, owner_client, lesson_type):
    """The cancel paths only void CONFIRMED bookings. Zeroing the counter
    would erase seats those two statuses still hold."""
    lesson = _lesson(school, _course(school, lesson_type), lesson_type, capacity=5)
    kept = book_lesson(_student(school), lesson, now=datetime(2027, 1, 1, tzinfo=dt_timezone.utc))
    book_lesson(_student(school), lesson, now=datetime(2027, 1, 1, tzinfo=dt_timezone.utc))
    Booking.objects.filter(pk=kept.pk).update(status=Booking.Status.ATTENDED)
    lesson.refresh_from_db()
    assert lesson.current_bookings == 2

    owner_client.delete(f"/api/school/classes/{lesson.id}/")
    lesson.refresh_from_db()
    assert lesson.current_bookings == 1  # only the confirmed one came back


def test_cancelling_an_empty_class_does_not_go_negative(school, owner_client, lesson_type):
    lesson = _lesson(school, _course(school, lesson_type), lesson_type)
    owner_client.delete(f"/api/school/classes/{lesson.id}/")
    lesson.refresh_from_db()
    assert lesson.current_bookings == 0
