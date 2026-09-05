"""Package eligibility at booking time (PACKAGE_TO_SUBSCRIPTION.md §3.3):
allowed-lesson-types list, delivery-mode filter, weekly booking cap.
"""
import uuid
from datetime import date, datetime, time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from bookings.models import Booking
from bookings.services import BookingError, book_lesson
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db


def _monday_at_least(days_ahead: int) -> date:
    """First Monday at least `days_ahead` days out — relative, never a fixed
    calendar date: the lesson has to stay far enough in the future that
    min-notice never trips, whenever the suite happens to run."""
    day = timezone.localdate() + timedelta(days=days_ahead)
    return day + timedelta(days=-day.weekday() % 7)


NEXT_MONDAY = _monday_at_least(14)


def lesson_starts_at(lesson):
    """The lesson's datetime — what package validity is compared against in
    `bookings.services._active_package`. Anchor expiry dates to this, not to
    `now() + N days`, or the outcome depends on the hour the suite runs."""
    return timezone.make_aware(datetime.combine(lesson.date, lesson.start_time))


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


# ---- validity window is checked against the LESSON date ----

def test_package_expiring_before_lesson_is_not_eligible(school, student, lesson_types):
    sp = give_package(student, school)
    lesson = make_lesson(school, lesson_types["flex"])
    sp.expires_at = lesson_starts_at(lesson) - timedelta(days=1)  # still valid today, gone by the lesson
    sp.save(update_fields=["expires_at"])
    with pytest.raises(BookingError, match="no_valid_access"):
        book_lesson(student, lesson)


def test_buy_ahead_package_books_future_lessons_now(school, student, lesson_types):
    # October-style package bought in advance: starts in the future, and its
    # future lessons are bookable today.
    sp = give_package(student, school)
    lesson = make_lesson(school, lesson_types["flex"], day=NEXT_MONDAY + timedelta(days=14))
    sp.starts_at = timezone.now() + timedelta(days=7)
    sp.expires_at = lesson_starts_at(lesson) + timedelta(days=1)
    sp.save(update_fields=["starts_at", "expires_at"])
    booking = book_lesson(student, lesson)
    assert booking.student_package_id == sp.id


def test_buy_ahead_package_cannot_book_lessons_before_it_starts(school, student, lesson_types):
    sp = give_package(student, school)
    sp.starts_at = timezone.make_aware(datetime.combine(NEXT_MONDAY + timedelta(days=10), time(0, 0)))
    sp.save(update_fields=["starts_at"])
    with pytest.raises(BookingError, match="no_valid_access"):
        book_lesson(student, make_lesson(school, lesson_types["flex"], day=NEXT_MONDAY))


def test_current_and_next_period_each_pay_their_own_lessons(school, student, lesson_types):
    # The user story: September package active now, October one bought ahead —
    # a September lesson uses the September package, an October lesson the
    # October one, both booked today.
    sept = give_package(student, school)
    sept.expires_at = timezone.make_aware(datetime.combine(NEXT_MONDAY + timedelta(days=6), time(23, 59)))
    sept.save(update_fields=["expires_at"])
    oct_ = give_package(student, school)
    oct_.starts_at = sept.expires_at
    oct_.expires_at = sept.expires_at + timedelta(days=31)
    oct_.save(update_fields=["starts_at", "expires_at"])

    b_sept = book_lesson(student, make_lesson(school, lesson_types["flex"], day=NEXT_MONDAY))
    b_oct = book_lesson(student, make_lesson(school, lesson_types["flex"], day=NEXT_MONDAY + timedelta(days=14)))
    assert b_sept.student_package_id == sept.id
    assert b_oct.student_package_id == oct_.id


# ---- deduction priority: recurring ("subscription") first ----

def test_recurring_package_deducts_before_one_time(school, student, lesson_types):
    lesson = make_lesson(school, lesson_types["flex"])
    onetime = give_package(student, school)
    # Covers the lesson but expires first, so it would win on expiry order.
    onetime.expires_at = lesson_starts_at(lesson) + timedelta(days=1)
    onetime.save(update_fields=["expires_at"])
    recurring = give_package(student, school, is_recurring=True, recurring_interval="month")
    booking = book_lesson(student, lesson)
    assert booking.student_package_id == recurring.id


def test_recurring_falls_back_to_one_time_when_ineligible(school, student, lesson_types):
    give_package(
        student, school, is_recurring=True, recurring_interval="month",
        allowed_lesson_types=[str(lesson_types["sbarra"].id)],
    )
    onetime = give_package(student, school)
    booking = book_lesson(student, make_lesson(school, lesson_types["flex"]))
    assert booking.student_package_id == onetime.id


# ---- eligibility falls through to the next package ----

def test_falls_through_to_second_eligible_package(school, student, lesson_types):
    # First-expiring package is type-restricted; the later one must be used.
    lesson = make_lesson(school, lesson_types["flex"])
    restricted = give_package(student, school, allowed_lesson_types=[str(lesson_types["sbarra"].id)])
    restricted.expires_at = lesson_starts_at(lesson) + timedelta(days=1)
    restricted.save(update_fields=["expires_at"])
    open_pkg = give_package(student, school)
    booking = book_lesson(student, lesson)
    assert booking.student_package_id == open_pkg.id
