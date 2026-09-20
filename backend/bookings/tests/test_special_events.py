"""Special events (SPECIAL_EVENTS.md) — the booking engine's side.

A free event is a seat and nothing else; a paid event is payable only with
its own ticket; the platform never refunds a ticket; nothing about an event
touches the welcome free lesson; an event is bookable and browsable only
while HQ's approval stands.
"""
import uuid
from datetime import timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from bookings.models import Booking
from bookings.services import (
    BookingError,
    book_lesson,
    cancel_booking,
    package_covers_lesson,
    resolve_drop_in_package,
    resolve_upsell_package,
    staff_enrol,
)
from catalog import events
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolStudent
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db


@pytest.fixture
def school():
    return School.objects.create(
        name="Test School", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        active=True, free_first_lesson=True, cancellation_policy_hours=24,
    )


@pytest.fixture
def student(school):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name="Stu", school=school)


@pytest.fixture
def reviewer():
    return get_user_model().objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com")


def _event_data(*, price=None, days_ahead=10, at="18:00", **extra):
    day = timezone.localdate() + timedelta(days=days_ahead)
    data = {
        "name": "Workshop di punte", "description": "Una serata speciale", "date": day.isoformat(),
        "start_time": at, "duration_minutes": 90, "max_capacity": 12, "price": price,
        "min_booking_notice_hours": 0,
    }
    data.update(extra)
    return data


def make_event(school, reviewer, *, price=None, approve=True, **extra):
    """Create, submit and (by default) approve: returns (course, lesson)."""
    course = events.create_event(school.id, _event_data(price=price, **extra), submit=True)
    if approve:
        events.approve_event(course, reviewer=reviewer)
    return course, events.event_lesson(course)


def give_package(student, school, package, credits=None):
    credits = Decimal(credits if credits is not None else package.credits)
    return StudentPackage.objects.create(
        student=student, school=school, package=package,
        credits_total=credits, credits_remaining=credits,
        expires_at=timezone.now() + timedelta(days=90),
    )


# ---- free event ------------------------------------------------------------

def test_free_event_is_booked_with_no_package_and_no_credit(school, student, reviewer):
    course, lesson = make_event(school, reviewer)
    assert course.credit_cost == 0 and course.event_status == "approved" and lesson is not None

    booking = book_lesson(student, lesson)

    assert booking.access_source == Booking.AccessSource.EVENT
    assert booking.credits_deducted == 0 and booking.student_package_id is None
    lesson.refresh_from_db()
    assert lesson.current_bookings == 1


def test_free_event_never_consumes_the_welcome_free_lesson(school, student, reviewer):
    _, lesson = make_event(school, reviewer)
    book_lesson(student, lesson)
    link = SchoolStudent.objects.get(school=school, student=student)
    assert link.free_lesson_used is False


def test_free_event_seat_can_be_given_back_inside_the_notice_period(school, student, reviewer):
    # 2 hours away (in the school's own zone, QA R2-H14), policy 24h: a
    # lesson would burn the credit — an event seat has none, so it is
    # simply released.
    start = timezone.now().astimezone(ZoneInfo(school.timezone)) + timedelta(hours=2)
    _, lesson = make_event(school, reviewer, date=start.date().isoformat(), at=start.strftime("%H:%M"))
    booking = book_lesson(student, lesson)

    booking = cancel_booking(booking)

    assert booking.status == Booking.Status.CANCELLED
    assert booking.credit_refunded is False
    assert booking.cancellation_type == Booking.CancellationType.WITHIN_POLICY
    lesson.refresh_from_db()
    assert lesson.current_bookings == 0


# ---- paid event: only its ticket -----------------------------------------------

def test_paid_event_has_a_ticket_package_hidden_from_the_storefront(school, reviewer):
    course, _ = make_event(school, reviewer, price="25")
    ticket = course.event_package
    assert ticket.is_drop_in and ticket.credits == 1 and ticket.price == Decimal("25.00")
    assert ticket.event_id == course.id and course.credit_cost == 1
    assert events.event_price(course) == "25.00"


def test_paid_event_refuses_ordinary_packages_and_the_welcome_lesson(school, student, reviewer):
    _, lesson = make_event(school, reviewer, price="25")
    generic = Package.objects.create(school=school, credits=Decimal("10"), price=Decimal("100"))
    give_package(student, school, generic)

    with pytest.raises(BookingError, match="no_valid_access"):
        book_lesson(student, lesson)
    # and the welcome free lesson was not spent on the attempt either
    assert not SchoolStudent.objects.filter(school=school, student=student, free_lesson_used=True).exists()


def test_paid_event_is_booked_with_its_ticket(school, student, reviewer):
    course, lesson = make_event(school, reviewer, price="25")
    sp = give_package(student, school, course.event_package)

    booking = book_lesson(student, lesson)

    assert booking.access_source == Booking.AccessSource.PACKAGE
    assert booking.student_package_id == sp.id and booking.credits_deducted == 1
    sp.refresh_from_db()
    assert sp.credits_remaining == 0 and sp.status == "exhausted"


def test_only_the_ticket_is_offered_as_drop_in_and_only_for_its_event(school, reviewer):
    course, lesson = make_event(school, reviewer, price="25")
    cheaper_generic_drop_in = Package.objects.create(
        school=school, credits=Decimal("1"), price=Decimal("5"), is_drop_in=True, active=True
    )
    Package.objects.create(school=school, credits=Decimal("10"), price=Decimal("80"), active=True)

    assert resolve_drop_in_package(lesson) == course.event_package
    assert resolve_upsell_package(lesson) is None

    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Flex")
    ordinary = Course.objects.create(school=school, lesson_type=lt, credit_cost=1, min_booking_notice_hours=0)
    ordinary_lesson = Lesson.objects.create(
        school=school, course=ordinary, lesson_type=lt, date=lesson.date,
        start_time=lesson.start_time, end_time=lesson.end_time, max_capacity=10,
    )
    assert package_covers_lesson(course.event_package, ordinary_lesson) is False
    assert resolve_drop_in_package(ordinary_lesson) == cheaper_generic_drop_in


def test_ticket_holder_cannot_cancel_online(school, student, reviewer):
    course, lesson = make_event(school, reviewer, price="25")
    give_package(student, school, course.event_package)
    booking = book_lesson(student, lesson)

    with pytest.raises(BookingError, match="contact_school"):
        cancel_booking(booking)
    booking.refresh_from_db()
    assert booking.status == Booking.Status.CONFIRMED


def test_school_cancellation_releases_seats_but_never_refunds_a_ticket(school, student, reviewer):
    course, lesson = make_event(school, reviewer, price="25")
    sp = give_package(student, school, course.event_package)
    paid = book_lesson(student, lesson)
    other = Student.objects.create(
        user=get_user_model().objects.create(email=f"o-{uuid.uuid4().hex[:8]}@example.com"), name="Other", school=school
    )
    desk = staff_enrol(lesson, other.id)  # free of charge at the desk

    result = events.cancel_event(course)

    assert result["bookings_cancelled"] == 2
    paid.refresh_from_db()
    desk.refresh_from_db()
    assert paid.status == Booking.Status.CANCELLED and paid.credit_refunded is False
    assert desk.status == Booking.Status.CANCELLED and desk.access_source == Booking.AccessSource.EVENT
    sp.refresh_from_db()
    assert sp.credits_remaining == 0  # the money is between her and the school
    lesson.refresh_from_db()
    assert lesson.status == Lesson.Status.CANCELLED and lesson.current_bookings == 0
    course.refresh_from_db()
    assert course.event_status == "cancelled"
    course.event_package.refresh_from_db()
    assert course.event_package.active is False


def test_desk_enrolment_on_a_paid_event_is_free_of_charge(school, student, reviewer):
    _, lesson = make_event(school, reviewer, price="25")
    booking = staff_enrol(lesson, student.id)
    assert booking.access_source == Booking.AccessSource.EVENT
    assert booking.credits_deducted == 0 and booking.student_package_id is None


# ---- approval gates ---------------------------------------------------------

def test_pending_event_has_no_lesson_and_suspended_one_is_not_bookable(school, student, reviewer):
    pending, lesson = make_event(school, reviewer, approve=False)
    assert pending.event_status == "pending" and lesson is None

    course, lesson = make_event(school, reviewer)
    events.suspend_event(course, reviewer=reviewer, note="Titolo non adatto")
    with pytest.raises(BookingError, match="lesson_not_bookable"):
        book_lesson(student, lesson)

    # Off the browse feeds too (student browse + public board), on again once reinstated
    api = APIClient()
    ids = {r["id"] for r in api.get("/api/student/lessons/").json()["results"]}
    assert str(lesson.id) not in ids
    assert str(lesson.id) not in {r["id"] for r in api.get("/api/lessons/public/upcoming/?days=14").json()}

    events.approve_event(course, reviewer=reviewer)
    ids = {r["id"] for r in api.get("/api/student/lessons/").json()["results"]}
    assert str(lesson.id) in ids
    row = next(r for r in api.get("/api/student/lessons/").json()["results"] if r["id"] == str(lesson.id))
    assert row["courses"]["is_special_event"] is True and row["courses"]["event_price"] is None
    assert row["lesson_type"] is None and row["courses"]["name"] == "Workshop di punte"


def test_edit_after_approval_is_live_flags_hq_and_moves_the_lesson(school, student, reviewer):
    course, lesson = make_event(school, reviewer, price="25")
    events.update_event(course, {"internal_notes": "solo per noi"})
    course.refresh_from_db()
    assert course.event_changed_at is None  # staff-only change: nothing for HQ to review

    new_day = (timezone.localdate() + timedelta(days=20)).isoformat()
    events.update_event(course, {"date": new_day, "start_time": "19:30", "price": "30"})
    course.refresh_from_db()
    lesson.refresh_from_db()
    assert course.event_changed_at is not None and course.event_status == "approved"
    assert lesson.date.isoformat() == new_day and lesson.start_time.strftime("%H:%M") == "19:30"
    assert lesson.end_time.strftime("%H:%M") == "21:00"
    assert events.event_price(course) == "30.00"

    events.mark_event_reviewed(course, reviewer=reviewer)
    course.refresh_from_db()
    assert course.event_changed_at is None


def test_making_a_paid_event_free_retires_its_ticket(school, reviewer):
    course, _ = make_event(school, reviewer, price="25")
    events.update_event(course, {"price": ""})
    course.refresh_from_db()
    assert course.credit_cost == 0 and events.event_price(course) is None
    assert Package.objects.get(event=course).active is False


# ---- what the review round found (20/09/2026) ----------------------------------

def test_school_cancellation_never_claims_a_refund_for_a_free_seat(school, student, reviewer):
    course, lesson = make_event(school, reviewer)
    seat = book_lesson(student, lesson)
    events.cancel_event(course)
    seat.refresh_from_db()
    assert seat.status == Booking.Status.CANCELLED and seat.credit_refunded is False


def test_desk_unenrolment_keeps_ticket_and_free_seat_unrefunded(school, student, reviewer):
    from bookings.services import staff_unenrol

    course, lesson = make_event(school, reviewer, price="25")
    sp = give_package(student, school, course.event_package)
    book_lesson(student, lesson)
    ticket = staff_unenrol(lesson, student.id)
    sp.refresh_from_db()
    assert ticket.credit_refunded is False and sp.credits_remaining == 0

    other = Student.objects.create(
        user=get_user_model().objects.create(email=f"o-{uuid.uuid4().hex[:8]}@example.com"), name="Other", school=school
    )
    staff_enrol(lesson, other.id)
    free_seat = staff_unenrol(lesson, other.id)
    assert free_seat.credit_refunded is False and free_seat.access_source == Booking.AccessSource.EVENT


def test_edit_while_suspended_moves_the_kept_seats_lesson(school, student, reviewer):
    course, lesson = make_event(school, reviewer)
    book_lesson(student, lesson)
    events.suspend_event(course, reviewer=reviewer, note="Rivedere il titolo")
    new_day = (timezone.localdate() + timedelta(days=30)).isoformat()
    events.update_event(course, {"date": new_day, "start_time": "10:00"})
    lesson.refresh_from_db()
    course.refresh_from_db()
    assert lesson.date.isoformat() == new_day and lesson.start_time.strftime("%H:%M") == "10:00"
    assert course.event_changed_at is None  # only a live (approved) edit is flagged for HQ
    events.approve_event(course, reviewer=reviewer)
    assert events.event_lesson(course).id == lesson.id  # reinstated, same lesson, same seats


def test_an_edit_cannot_move_an_event_into_the_past(school, reviewer):
    course, _ = make_event(school, reviewer)
    with pytest.raises(events.EventError, match="date_in_past"):
        events.update_event(course, {"date": (timezone.localdate() - timedelta(days=1)).isoformat()})


def test_free_seat_cannot_be_released_once_the_event_started(school, student, reviewer):
    start = timezone.now().astimezone(ZoneInfo(school.timezone)) - timedelta(minutes=30)
    course = events.create_event(school.id, _event_data(date=start.date().isoformat(), at=start.strftime("%H:%M")), submit=True)
    course.event_status = "pending"  # submit refuses a past date only on the calendar day; force the approval
    events.approve_event(course, reviewer=reviewer)
    lesson = events.event_lesson(course)
    booking = Booking.objects.create(
        student=student, lesson=lesson, school=school, access_source=Booking.AccessSource.EVENT, credits_deducted=0,
    )
    with pytest.raises(BookingError, match="lesson_already_started"):
        cancel_booking(booking)


def test_no_show_on_a_free_seat_sends_no_credit_email(school, student, reviewer, monkeypatch):
    from bookings import services as svc

    _, lesson = make_event(school, reviewer)
    book_lesson(student, lesson)
    sent = []
    monkeypatch.setattr(svc, "_dispatch_email", lambda booking, key: sent.append(key))
    svc.mark_attendance(lesson, student, None, status="no_show")
    assert "no_show" not in sent


def test_wallet_total_leaves_the_ticket_out_but_the_booking_page_sees_its_event(school, student, reviewer):
    course, lesson = make_event(school, reviewer, price="25")
    give_package(student, school, course.event_package)
    api = APIClient()
    api.force_authenticate(student.user)
    credits = api.get("/api/student/credits/").json()  # one row per school
    assert all(Decimal(str(row["credits"])) == 0 for row in credits)
    packages = api.get("/api/student/packages/").json()
    mine = next(p for p in packages if p["package_event"] == str(course.id))
    assert mine["credits_remaining"] in ("1.0", 1, "1")
    row = next(r for r in api.get("/api/student/lessons/").json()["results"] if r["id"] == str(lesson.id))
    assert row["courses"]["id"] == str(course.id)
