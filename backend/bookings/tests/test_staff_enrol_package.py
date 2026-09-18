"""`staff_enrol()` — the school's or the teacher's "add a student" on a
lesson — must draw on a package exactly as `book_lesson()` does for the
student herself: the same eligibility (lesson type, online / in person,
validity at the lesson's date) and the same `exhausted` once the credits
are gone. It used to take the first active package with enough credits,
whatever it covered, and left a drained package `active` at 0 credits: the
school's Reports and usage modal then showed it as active while the
student's own page already treated it as used up."""
import uuid
from datetime import date, datetime, time, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from bookings.services import BookingError, staff_enrol
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolStudent
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome"
    )


@pytest.fixture
def student(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna", school=school)
    SchoolStudent.objects.create(school=school, student=student)
    return student


def _lesson(school, *, is_online=False):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(
        school=school, lesson_type=lt, credit_cost=Decimal("1.5"), min_booking_notice_hours=0, is_online=is_online
    )
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt, date=date(2027, 6, 1), start_time=time(12, 0),
        end_time=time(13, 0), max_capacity=10, status="scheduled", is_online=is_online,
    )


def _package(student, school, *, credits="10.0", expires=datetime(2028, 1, 1, tzinfo=dt_timezone.utc), **catalog):
    pkg = Package.objects.create(school=school, credits=Decimal(credits), **catalog)
    return StudentPackage.objects.create(
        student=student, school=school, package=pkg,
        credits_total=Decimal(credits), credits_remaining=Decimal(credits), expires_at=expires,
    )


def test_a_package_drained_from_the_register_becomes_exhausted(school, student):
    single = _package(student, school, credits="1.5")

    booking = staff_enrol(_lesson(school), student.id)

    single.refresh_from_db()
    assert booking.student_package_id == single.id and booking.credits_deducted == Decimal("1.5")
    assert single.credits_remaining == Decimal("0") and single.status == "exhausted"


def test_a_package_with_credits_left_stays_active(school, student):
    ten = _package(student, school)

    staff_enrol(_lesson(school), student.id)

    ten.refresh_from_db()
    assert ten.credits_remaining == Decimal("8.5") and ten.status == "active"


def test_the_register_skips_a_package_that_does_not_cover_the_lesson(school, student):
    # The online-only package expires first: the old code charged it for a
    # lesson in the studio, which the student herself could never have done.
    zoom = _package(student, school, expires=datetime(2027, 9, 1, tzinfo=dt_timezone.utc), mode_filter="online")
    sala = _package(student, school)

    booking = staff_enrol(_lesson(school, is_online=False), student.id)

    zoom.refresh_from_db()
    sala.refresh_from_db()
    assert booking.student_package_id == sala.id
    assert zoom.credits_remaining == Decimal("10.0") and sala.credits_remaining == Decimal("8.5")


def test_no_covering_package_is_refused_like_the_student_would_be(school, student):
    other_type = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Pointe")
    only_pointe = _package(student, school, allowed_lesson_types=[str(other_type.id)])
    lesson = _lesson(school)

    with pytest.raises(BookingError) as exc:
        staff_enrol(lesson, student.id)

    assert str(exc.value) == "no_valid_access"
    lesson.refresh_from_db()
    only_pointe.refresh_from_db()
    assert lesson.current_bookings == 0 and only_pointe.credits_remaining == Decimal("10.0")
