"""
Booking engine — the credit/access rules from the spec (sections 10-11).

Deduction priority: active subscription (1 access) → active package (credit_cost)
→ blocked. Cancellation compares hours-until-lesson against the school threshold:
before → refund, after → burn. No-show burns (handled at attendance, Phase 5).
"""

from datetime import datetime, timedelta

from django.db import transaction
from django.utils import timezone

from schools.models import SchoolStudent
from students.models import StudentPackage, StudentSubscription

from .models import Booking


class BookingError(Exception):
    """Raised with a machine-ish reason string the API maps to 400."""


def _lesson_datetime(lesson):
    return timezone.make_aware(datetime.combine(lesson.date, lesson.start_time))


def _restriction_matches(restriction, lesson) -> bool:
    if not restriction or restriction == "all":
        return True
    return str(restriction) == str(lesson.lesson_type_id)


def _credit_cost(lesson) -> int:
    if lesson.course_id and lesson.course.credit_cost:
        return lesson.course.credit_cost
    return 1


def _min_notice_hours(lesson):
    if lesson.course_id:
        return lesson.course.min_booking_notice_hours
    return lesson.school.min_booking_notice_hours


def _bump_lesson(lesson, delta):
    lesson.current_bookings = max(0, (lesson.current_bookings or 0) + delta)
    lesson.save(update_fields=["current_bookings"])


def _active_subscription(student, school, lesson, now):
    for sub in StudentSubscription.objects.filter(
        student=student, school=school, status="active"
    ).order_by("current_period_end"):
        if sub.current_period_end and sub.current_period_end < now:
            continue
        if not _restriction_matches(
            sub.subscription_catalog.lesson_type_restriction if sub.subscription_catalog_id else "all",
            lesson,
        ):
            continue
        if sub.access_remaining is not None and sub.access_remaining <= 0:
            continue
        return sub
    return None


def _active_package(student, school, lesson, cost, now):
    for pkg in StudentPackage.objects.filter(
        student=student, school=school, status="active"
    ).order_by("expires_at"):
        if pkg.expires_at and pkg.expires_at < now:
            continue
        if pkg.credits_remaining < cost:
            continue
        if not _restriction_matches(
            pkg.package.lesson_type_restriction if pkg.package_id else "all", lesson
        ):
            continue
        return pkg
    return None


@transaction.atomic
def book_lesson(student, lesson, *, now=None):
    now = now or timezone.now()
    lesson = type(lesson).objects.select_for_update().get(pk=lesson.pk)

    if lesson.status != "scheduled":
        raise BookingError("lesson_not_bookable")
    if (lesson.current_bookings or 0) >= (lesson.max_capacity or 0):
        raise BookingError("full")
    if Booking.objects.filter(student=student, lesson=lesson).exclude(status="cancelled").exists():
        raise BookingError("already_booked")
    if _lesson_datetime(lesson) - now < timedelta(hours=_min_notice_hours(lesson)):
        raise BookingError("min_notice")

    school = lesson.school

    # Free first lesson (per student per school).
    ss = SchoolStudent.objects.filter(school=school, student=student).first()
    if school.free_first_lesson and ss and not ss.free_lesson_used:
        booking = Booking.objects.create(
            student=student, lesson=lesson, school=school,
            access_source=Booking.AccessSource.FREE_LESSON, credits_deducted=0,
            status=Booking.Status.CONFIRMED, booked_at=now,
        )
        ss.free_lesson_used = True
        ss.save(update_fields=["free_lesson_used"])
        _bump_lesson(lesson, +1)
        return booking

    # Subscription first (priority), then package.
    sub = _active_subscription(student, school, lesson, now)
    if sub is not None:
        if sub.access_remaining is not None:
            sub.access_remaining -= 1
            sub.save(update_fields=["access_remaining"])
        booking = Booking.objects.create(
            student=student, lesson=lesson, school=school,
            access_source=Booking.AccessSource.SUBSCRIPTION, student_subscription=sub,
            credits_deducted=0, status=Booking.Status.CONFIRMED, booked_at=now,
        )
        _bump_lesson(lesson, +1)
        return booking

    cost = _credit_cost(lesson)
    pkg = _active_package(student, school, lesson, cost, now)
    if pkg is not None:
        pkg.credits_remaining -= cost
        if pkg.credits_remaining <= 0:
            pkg.status = "exhausted"
        pkg.save(update_fields=["credits_remaining", "status"])
        booking = Booking.objects.create(
            student=student, lesson=lesson, school=school,
            access_source=Booking.AccessSource.PACKAGE, student_package=pkg,
            credits_deducted=cost, status=Booking.Status.CONFIRMED, booked_at=now,
        )
        _bump_lesson(lesson, +1)
        return booking

    raise BookingError("no_valid_access")


@transaction.atomic
def cancel_booking(booking, *, now=None):
    now = now or timezone.now()
    booking = Booking.objects.select_for_update().get(pk=booking.pk)
    if booking.status != Booking.Status.CONFIRMED:
        raise BookingError("not_cancellable")

    lesson = booking.lesson
    school = booking.school
    within_policy = _lesson_datetime(lesson) - now >= timedelta(hours=school.cancellation_policy_hours)

    if within_policy:
        if booking.access_source == Booking.AccessSource.SUBSCRIPTION and booking.student_subscription_id:
            sub = booking.student_subscription
            if sub.access_remaining is not None:
                sub.access_remaining += 1
                sub.save(update_fields=["access_remaining"])
        elif booking.access_source == Booking.AccessSource.PACKAGE and booking.student_package_id:
            pkg = booking.student_package
            pkg.credits_remaining += booking.credits_deducted
            if pkg.status == "exhausted":
                pkg.status = "active"
            pkg.save(update_fields=["credits_remaining", "status"])
        elif booking.access_source == Booking.AccessSource.FREE_LESSON:
            ss = SchoolStudent.objects.filter(school=school, student=booking.student).first()
            if ss and ss.free_lesson_used:
                ss.free_lesson_used = False
                ss.save(update_fields=["free_lesson_used"])
        booking.credit_refunded = True
        booking.cancellation_type = Booking.CancellationType.WITHIN_POLICY
    else:
        booking.cancellation_type = Booking.CancellationType.OUTSIDE_POLICY

    booking.status = Booking.Status.CANCELLED
    booking.cancelled_at = now
    booking.save(update_fields=["status", "cancelled_at", "cancellation_type", "credit_refunded"])
    _bump_lesson(lesson, -1)
    return booking
