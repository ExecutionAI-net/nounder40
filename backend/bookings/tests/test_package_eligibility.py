"""Package eligibility at booking time (PACKAGE_TO_SUBSCRIPTION.md §3.3):
allowed-lesson-types list, delivery-mode filter, weekly booking cap.
"""
import uuid
from datetime import date, time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from bookings.models import Booking
from bookings.services import BookingError, book_lesson
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db

NEXT_MONDAY = date(2026, 9, 7)  # far enough ahead that min-notice never trips


@pytest.fixture
def school():
    return School.objects.create(name="Test School", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def student(school):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name="Stu", school=school)


@pytest.fixture
def lesson_types():
    return {
        "flex": LessonType.objects.create(code=f"flex-{uuid.uuid4().hex[:6]}", name_en="Flex"),
        "sbarra": LessonType.objects.create(code=f"sbarra-{uuid.uuid4().hex[:6]}", name_en="Sbarra"),
    }


def make_lesson(school, lesson_type, *, day=NEXT_MONDAY, at=time(18, 0), is_online=False, cost=1):
    course = Course.objects.create(
        school=school, lesson_type=lesson_type, credit_cost=cost,
        min_booking_notice_hours=0, is_online=is_online,
    )
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type,
        date=day, start_time=at, end_time=time(at.hour + 1, 0),
        max_capacity=10, current_bookings=0, status="scheduled", is_online=is_online,
    )


def give_package(student, school, *, credits=10, **package_fields):
    pkg = Package.objects.create(school=school, credits=credits, **package_fields)
    return StudentPackage.objects.create(
        student=student, school=school, package=pkg,
        credits_total=credits, credits_remaining=credits,
        expires_at=timezone.now() + timedelta(days=90),
    )


# ---- allowed_lesson_types (list) ----

def test_allowed_list_blocks_other_types(school, student, lesson_types):
    give_package(student, school, allowed_lesson_types=[str(lesson_types["flex"].id)])
    lesson = make_lesson(school, lesson_types["sbarra"])
    with pytest.raises(BookingError, match="no_valid_access"):
        book_lesson(student, lesson)


def test_allowed_list_admits_listed_type(school, student, lesson_types):
    sp = give_package(student, school, allowed_lesson_types=[str(lesson_types["flex"].id)])
    booking = book_lesson(student, make_lesson(school, lesson_types["flex"]))
    assert booking.student_package_id == sp.id


def test_empty_list_falls_back_to_legacy_single_restriction(school, student, lesson_types):
    give_package(student, school, lesson_type_restriction=str(lesson_types["flex"].id))
    with pytest.raises(BookingError, match="no_valid_access"):
        book_lesson(student, make_lesson(school, lesson_types["sbarra"]))
    booking = book_lesson(student, make_lesson(school, lesson_types["flex"]))
    assert booking.access_source == Booking.AccessSource.PACKAGE


def test_list_overrides_legacy_value(school, student, lesson_types):
    # List set → legacy single value is ignored entirely.
    give_package(
        student, school,
        lesson_type_restriction=str(lesson_types["flex"].id),
        allowed_lesson_types=[str(lesson_types["sbarra"].id)],
    )
    booking = book_lesson(student, make_lesson(school, lesson_types["sbarra"]))
    assert booking.credits_deducted == 1


# ---- mode filter ----

def test_online_only_package_rejects_in_person(school, student, lesson_types):
    give_package(student, school, mode_filter="online")
    with pytest.raises(BookingError, match="no_valid_access"):
        book_lesson(student, make_lesson(school, lesson_types["flex"], is_online=False))


def test_in_person_only_package_rejects_online(school, student, lesson_types):
    give_package(student, school, mode_filter="in_person")
    with pytest.raises(BookingError, match="no_valid_access"):
        book_lesson(student, make_lesson(school, lesson_types["flex"], is_online=True))


def test_mode_all_admits_both(school, student, lesson_types):
    give_package(student, school, mode_filter="all")
    b1 = book_lesson(student, make_lesson(school, lesson_types["flex"], is_online=True))
    b2 = book_lesson(student, make_lesson(school, lesson_types["flex"], at=time(20, 0)))
    assert b1.status == b2.status == Booking.Status.CONFIRMED


# ---- weekly cap ----

def test_weekly_cap_blocks_within_same_week(school, student, lesson_types):
    give_package(student, school, weekly_booking_cap=2)
    book_lesson(student, make_lesson(school, lesson_types["flex"], day=NEXT_MONDAY))
    book_lesson(student, make_lesson(school, lesson_types["flex"], day=NEXT_MONDAY + timedelta(days=2)))
    with pytest.raises(BookingError, match="no_valid_access"):
        book_lesson(student, make_lesson(school, lesson_types["flex"], day=NEXT_MONDAY + timedelta(days=5)))


def test_weekly_cap_counts_by_lesson_week_not_booking_week(school, student, lesson_types):
    give_package(student, school, weekly_booking_cap=1)
    book_lesson(student, make_lesson(school, lesson_types["flex"], day=NEXT_MONDAY))
    # Next calendar week is a fresh allowance even though both bookings are made today.
    booking = book_lesson(student, make_lesson(school, lesson_types["flex"], day=NEXT_MONDAY + timedelta(days=7)))
    assert booking.status == Booking.Status.CONFIRMED


def test_refunded_cancellation_frees_weekly_slot(school, student, lesson_types):
    from bookings.services import cancel_booking

    give_package(student, school, weekly_booking_cap=1)
    first = book_lesson(student, make_lesson(school, lesson_types["flex"], day=NEXT_MONDAY))
    cancel_booking(first)  # far in the future → within policy → refunded
    assert Booking.objects.get(pk=first.pk).credit_refunded
    booking = book_lesson(student, make_lesson(school, lesson_types["flex"], day=NEXT_MONDAY, at=time(20, 0)))
    assert booking.status == Booking.Status.CONFIRMED


def test_burned_booking_keeps_counting(school, student, lesson_types):
    give_package(student, school, weekly_booking_cap=1)
    first = book_lesson(student, make_lesson(school, lesson_types["flex"], day=NEXT_MONDAY))
    # Simulate an out-of-policy cancellation: cancelled but credit NOT refunded.
    Booking.objects.filter(pk=first.pk).update(
        status=Booking.Status.CANCELLED, credit_refunded=False,
        cancellation_type=Booking.CancellationType.OUTSIDE_POLICY,
    )
    with pytest.raises(BookingError, match="no_valid_access"):
        book_lesson(student, make_lesson(school, lesson_types["flex"], day=NEXT_MONDAY, at=time(20, 0)))


# ---- eligibility falls through to the next package ----

def test_falls_through_to_second_eligible_package(school, student, lesson_types):
    # First-expiring package is type-restricted; the later one must be used.
    restricted = give_package(student, school, allowed_lesson_types=[str(lesson_types["sbarra"].id)])
    restricted.expires_at = timezone.now() + timedelta(days=10)
    restricted.save(update_fields=["expires_at"])
    open_pkg = give_package(student, school)
    booking = book_lesson(student, make_lesson(school, lesson_types["flex"]))
    assert booking.student_package_id == open_pkg.id
