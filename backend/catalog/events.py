"""Special events: a workshop the school titles itself, approved by HQ.

Product decisions (SPECIAL_EVENTS.md, Carlo 20/09/2026):

- An event is a `Course` with `is_special_event=True`, no lesson type, one
  date and one `Lesson`. The lesson exists only from HQ's approval on, so
  nothing shows anywhere -- school calendar included -- before that.
- Free event: `credit_cost` 0, booked with no package and no credit
  (`bookings.services.book_lesson`). Paid event: `credit_cost` 1 and a single
  ticket `Package` (`Package.event`) that is the only way to pay for it.
- A new event is hidden until approved. Edits after approval go live at
  once; the event is flagged (`event_changed_at`) in HQ's "Modified" list
  and HQ may suspend it. A date/time change emails the booked students.
- The platform never refunds a ticket: cancelling the event cancels the
  seats (free ones simply released) and tells the students to contact the
  school for the money.

This module owns the workflow and keeps lesson and ticket in sync with the
course; the views in `event_views.py` only parse and authorise.
"""

from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from bookings.models import Booking
from bookings.services import cancel_bookings_by_school
from core.params import parse_date, parse_int, parse_time, parse_uuid
from core.section_guard import hq_has_permission

from .course_views import _calc_end_time, _hhmm
from .models import Course, Lesson, Package

EventStatus = Course.EventStatus

# Statuses in which the school may still edit the event.
EDITABLE = {EventStatus.DRAFT, EventStatus.PENDING, EventStatus.REJECTED, EventStatus.SUSPENDED, EventStatus.APPROVED}
# From these the school (re)submits to HQ.
SUBMITTABLE = {EventStatus.DRAFT, EventStatus.REJECTED, EventStatus.SUSPENDED}

# Changes the students can see: after approval they flag the event for HQ's
# "Modified" list. Internal notes, email info, compensation and colour do not.
VISIBLE_FIELDS = (
    "name", "description", "video_url", "start_date", "start_time", "duration_minutes",
    "max_capacity", "teacher_id", "room_id", "is_online", "online_link", "notes", "language",
    "min_booking_notice_hours", "credit_cost", "price",
)
MOVE_FIELDS = ("start_date", "start_time", "duration_minutes")


class EventError(ValueError):
    """A refused request; `str(exc)` is the error code the API returns."""


# --------------------------------------------------------------------------
# Reading
# --------------------------------------------------------------------------


def event_lesson(course):
    """The event's one lesson (None before approval)."""
    return Lesson.objects.filter(course=course).order_by("-created_at").first()


def event_price(course):
    """The ticket price as a string ("12.00"), or None for a free event."""
    try:
        ticket = course.event_package
    except Package.DoesNotExist:
        ticket = None
    if course.credit_cost and ticket is not None and ticket.active:
        return str(ticket.price)
    return None


_SEAT_STATUSES = ("confirmed", "attended", "no_show")
# A seat that was paid with the event's own ticket (mirror of is_event_ticket)
_TICKET_SEAT = Q(access_source=Booking.AccessSource.PACKAGE, student_package__package__event__isnull=False)


def _seat_counts(lesson_ids) -> dict:
    """{lesson_id: (seats, paid_seats)} in one query."""
    rows = (
        Booking.objects.filter(lesson_id__in=lesson_ids, status__in=_SEAT_STATUSES)
        .values("lesson_id")
        .annotate(seats=Count("id"), paid=Count("id", filter=_TICKET_SEAT))
    )
    return {r["lesson_id"]: (r["seats"], r["paid"]) for r in rows}


def event_payloads(courses, *, with_school=False) -> list:
    """The list shape: the lessons and the seat counts of every event in two
    queries, not two per event (the school list and the HQ queue)."""
    courses = list(courses)
    lessons = {}
    for lesson in Lesson.objects.filter(course__in=courses).order_by("created_at"):
        lessons[lesson.course_id] = lesson  # the newest wins, like event_lesson
    counts = _seat_counts([lesson.id for lesson in lessons.values()])
    return [
        event_payload(c, lesson=lessons.get(c.id), counts=counts.get(getattr(lessons.get(c.id), "id", None)), with_school=with_school)
        for c in courses
    ]


def event_payload(course, *, lesson=None, counts=None, with_school=False) -> dict:
    """One JSON shape for the school pages, the HQ queue and the tests."""
    if lesson is None:
        lesson = event_lesson(course)
    bookings, paid_seats = 0, 0
    if lesson is not None:
        bookings, paid_seats = counts if counts is not None else _seat_counts([lesson.id]).get(lesson.id, (0, 0))
    data = {
        "id": str(course.id),
        "name": course.name,
        "description": course.description,
        "image_url": course.image_url or None,
        "video_url": course.video_url or None,
        "date": course.start_date.isoformat() if course.start_date else None,
        "start_time": _hhmm(course.start_time),
        "duration_minutes": course.duration_minutes,
        "max_capacity": course.max_capacity,
        "teacher_id": str(course.teacher_id) if course.teacher_id else None,
        "teacher_name": course.teacher.name if course.teacher_id else None,
        "room_id": str(course.room_id) if course.room_id else None,
        "room_name": course.room.name if course.room_id else None,
        "location_name": course.room.location.name if course.room_id and course.room.location_id else None,
        "compensation_plan_id": str(course.compensation_plan_id) if course.compensation_plan_id else None,
        "is_online": course.is_online,
        "online_link": course.online_link,
        "notes": course.notes,
        "internal_notes": course.internal_notes,
        "email_info": course.email_info,
        "language": course.language,
        "color": course.color,
        "min_booking_notice_hours": course.min_booking_notice_hours,
        "is_free": not bool(course.credit_cost),
        "price": event_price(course),
        "status": course.event_status,
        "submitted_at": course.event_submitted_at,
        "reviewed_at": course.event_reviewed_at,
        "reviewed_by": course.event_reviewed_by.email if course.event_reviewed_by_id else None,
        "review_note": course.event_review_note,
        "changed_at": course.event_changed_at,
        "created_at": course.created_at,
        "lesson_id": str(lesson.id) if lesson is not None else None,
        "lesson_status": lesson.status if lesson is not None else None,
        "bookings": bookings,
        "paid_seats": paid_seats,
    }
    if with_school:
        data["school"] = {"id": str(course.school_id), "name": course.school.name, "city": course.school.city}
    return data


# --------------------------------------------------------------------------
# Parsing the school's form
# --------------------------------------------------------------------------


def _parse_price(value):
    """'' / None / 'free' -> None (free event); otherwise a non-negative
    Decimal with two places. A zero price is a free event too."""
    if value in (None, "", "free"):
        return None
    try:
        price = Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        raise EventError("invalid_price") from None
    if price < 0:
        raise EventError("invalid_price")
    return price if price > 0 else None


def parse_event_data(data: dict, *, partial: bool = False) -> dict:
    """The form's fields, validated, as Course attributes (+ "price").
    `partial`: only the keys present are returned (PATCH)."""
    out: dict = {}

    def has(key):
        return not partial or key in data

    if has("name"):
        name = (data.get("name") or "").strip()
        if not name:
            raise EventError("name_required")
        out["name"] = name[:255]
    if has("description"):
        out["description"] = data.get("description") or ""
    if has("video_url"):
        out["video_url"] = (data.get("video_url") or "").strip()
    if has("date"):
        day = parse_date(data.get("date"), "date")
        if day is None:
            raise EventError("date_required")
        out["start_date"] = day
        out["end_date"] = day
    if has("start_time"):
        st = parse_time(data.get("start_time"), "start_time")
        if st is None:
            raise EventError("start_time_required")
        out["start_time"] = st
    if has("duration_minutes"):
        dur = parse_int(data.get("duration_minutes"), "duration_minutes", default=60, min_value=15) or 60
        out["duration_minutes"] = dur
    if has("max_capacity"):
        out["max_capacity"] = parse_int(data.get("max_capacity"), "max_capacity", default=15, min_value=1) or 15
    if has("teacher_id"):
        out["teacher_id"] = parse_uuid(data.get("teacher_id"), "teacher_id")
    if has("room_id"):
        out["room_id"] = parse_uuid(data.get("room_id"), "room_id")
    if has("compensation_plan_id"):
        out["compensation_plan_id"] = parse_uuid(data.get("compensation_plan_id"), "compensation_plan_id")
    if has("is_online"):
        out["is_online"] = bool(data.get("is_online"))
    if has("online_link"):
        out["online_link"] = (data.get("online_link") or "").strip()
    if has("notes"):
        out["notes"] = data.get("notes") or ""
    if has("internal_notes"):
        out["internal_notes"] = data.get("internal_notes") or ""
    if has("email_info"):
        out["email_info"] = data.get("email_info") or ""
    if has("language"):
        out["language"] = (data.get("language") or "it")[:8]
    if has("color"):
        out["color"] = (data.get("color") or "#6B1F3A")[:20]
    if has("min_booking_notice_hours"):
        out["min_booking_notice_hours"] = parse_int(
            data.get("min_booking_notice_hours"), "min_booking_notice_hours", default=2, min_value=0
        ) or 0
    if has("price"):
        out["price"] = _parse_price(data.get("price"))
        out["credit_cost"] = Decimal("1") if out["price"] is not None else Decimal("0")
    if not partial:
        for key in ("start_date", "start_time"):
            if key not in out:
                raise EventError(f"{key}_required")
    return out


# --------------------------------------------------------------------------
# Lesson and ticket kept in sync with the course
# --------------------------------------------------------------------------


def _lesson_fields(course) -> dict:
    return dict(
        school_id=course.school_id,
        teacher_id=course.teacher_id,
        room_id=course.room_id,
        lesson_type_id=None,
        compensation_plan_id=course.compensation_plan_id,
        date=course.start_date,
        start_time=course.start_time,
        end_time=_calc_end_time(course.start_time, course.duration_minutes or 60),
        max_capacity=course.max_capacity,
        color=course.color or "",
        is_online=course.is_online,
        online_link=course.online_link or "",
        notes=course.notes or "",
        internal_notes=course.internal_notes or "",
        email_info="",  # inherits the course's
        language="",  # inherits the course's
    )


def sync_event_lesson(course, *, create: bool):
    """Create (on approval) or update the event's lesson from the course.
    A cancelled lesson is left alone: the event is over."""
    lesson = event_lesson(course)
    fields = _lesson_fields(course)
    if lesson is None:
        if not create:
            return None
        lesson = Lesson.objects.create(course=course, status=Lesson.Status.SCHEDULED, **fields)
    elif lesson.status != Lesson.Status.CANCELLED:
        for key, value in fields.items():
            setattr(lesson, key, value)
        lesson.save(update_fields=list(fields))
    _broadcast_after_commit(lesson)
    return lesson


def _broadcast_after_commit(lesson):
    """The calendar WebSocket makes every open calendar refetch the feed:
    inside the atomic block that refetch could still miss the row."""
    from .realtime import broadcast_calendar_change

    transaction.on_commit(lambda: broadcast_calendar_change(lesson))


def sync_event_ticket(course, price):
    """The paid event's single ticket: a drop-in package worth one credit at
    the school's price, named after the event. A free event deactivates it."""
    try:
        ticket = course.event_package
    except Package.DoesNotExist:
        ticket = None
    if price is None:
        if ticket is not None and ticket.active:
            ticket.active = False
            ticket.save(update_fields=["active"])
        return None
    names = {f"name_{loc}": course.name for loc in ("it", "en", "fr", "es")}
    if ticket is None:
        ticket = Package.objects.create(
            school_id=course.school_id, event=course, credits=Decimal("1"), price=price,
            is_drop_in=True, is_recurring=False, validity_days=365, validity_unit=Package.ValidityUnit.DAYS,
            allowed_lesson_types=[], lesson_type_restriction="all", mode_filter=Package.ModeFilter.ALL,
            language=course.language or "it", active=True, **names,
        )
    else:
        ticket.price = price
        ticket.active = True
        ticket.language = course.language or "it"
        for key, value in names.items():
            setattr(ticket, key, value)
        ticket.save(update_fields=["price", "active", "language", *names])
    # Reload the reverse one-to-one on the course instance
    course.event_package = ticket
    return ticket


# --------------------------------------------------------------------------
# The school's side
# --------------------------------------------------------------------------


@transaction.atomic
def create_event(school_id, data: dict, *, submit: bool = False) -> Course:
    fields = parse_event_data(data)
    price = fields.pop("price", None)
    course = Course.objects.create(
        school_id=school_id, lesson_type=None, is_special_event=True, frequency="single",
        event_status=EventStatus.DRAFT, active=True, **fields,
    )
    sync_event_ticket(course, price)
    if submit:
        submit_event(course)
    return course


@transaction.atomic
def update_event(course, data: dict) -> Course:
    """Apply the school's edit. After approval the change is live at once:
    a student-visible one flags the event for HQ, a date/time one emails the
    booked students."""
    if course.event_status not in EDITABLE:
        raise EventError("not_editable")
    fields = parse_event_data(data, partial=True)
    if fields.get("start_date") and fields["start_date"] < timezone.localdate():
        raise EventError("date_in_past")
    price_given = "price" in fields
    price = fields.pop("price", None)
    before = {k: getattr(course, k) for k in fields}
    before_price = event_price(course)
    for key, value in fields.items():
        setattr(course, key, value)
    if fields:
        course.save(update_fields=list(fields))
    if price_given:
        sync_event_ticket(course, price)
    changed = {k for k in fields if before[k] != getattr(course, k)}
    if price_given and (event_price(course) != before_price):
        changed.add("price")
    # Once a lesson exists (approved, or suspended with its seats kept) it
    # follows the course, and a moved date/time is told to the booked students.
    lesson = sync_event_lesson(course, create=False)
    if course.event_status == EventStatus.APPROVED and changed & set(VISIBLE_FIELDS):
        course.event_changed_at = timezone.now()
        course.save(update_fields=["event_changed_at"])
    if lesson is not None and lesson.status != Lesson.Status.CANCELLED and changed & set(MOVE_FIELDS):
        from bookings.services import notify_event_updated

        booked = list(
            Booking.objects.filter(lesson=lesson, status=Booking.Status.CONFIRMED).select_related(
                "student__user", "school", "lesson__teacher", "lesson__room__location", "lesson__course",
            )
        )
        notify_event_updated(booked)
    return course


@transaction.atomic
def submit_event(course) -> Course:
    if course.event_status not in SUBMITTABLE:
        raise EventError("not_submittable")
    if not course.start_date or not course.start_time:
        raise EventError("date_required")
    if course.start_date < timezone.localdate():
        raise EventError("date_in_past")
    course.event_status = EventStatus.PENDING
    course.event_submitted_at = timezone.now()
    course.event_review_note = ""
    course.save(update_fields=["event_status", "event_submitted_at", "event_review_note"])
    _notify_hq_submitted(course)
    return course


@transaction.atomic
def cancel_event(course) -> dict:
    """The school withdraws the event. Seats are cancelled the way the
    school cancels any lesson -- credits back where there are credits (free
    seats: nothing), tickets never refunded by the platform -- and everybody
    booked gets the cancellation email. A draft with no lesson is simply
    deleted by the caller."""
    if course.event_status == EventStatus.CANCELLED:
        raise EventError("already_cancelled")
    lesson = event_lesson(course)
    refunded = 0
    if lesson is not None and lesson.status != Lesson.Status.CANCELLED:
        bookings = list(
            Booking.objects.filter(lesson=lesson, status=Booking.Status.CONFIRMED).select_related(
                "student__user", "school", "lesson__teacher", "lesson__room__location", "lesson__course",
            )
        )
        cancel_bookings_by_school(bookings)
        lesson.status = Lesson.Status.CANCELLED
        lesson.save(update_fields=["status"])
        _broadcast_after_commit(lesson)
        refunded = len(bookings)
    course.event_status = EventStatus.CANCELLED
    course.active = False
    course.save(update_fields=["event_status", "active"])
    sync_event_ticket(course, None)
    return {"cancelled": True, "bookings_cancelled": refunded}


# --------------------------------------------------------------------------
# HQ's side
# --------------------------------------------------------------------------


def _review(course, reviewer, note: str = ""):
    course.event_reviewed_at = timezone.now()
    course.event_reviewed_by = reviewer
    course.event_review_note = note or ""


@transaction.atomic
def approve_event(course, *, reviewer) -> Course:
    """Pending -> approved (also suspended -> approved, i.e. reinstated).
    The lesson is created on the first approval: from here on the event is
    on the calendar, the public board and the booking page."""
    if course.event_status not in (EventStatus.PENDING, EventStatus.SUSPENDED):
        raise EventError("not_approvable")
    if course.start_date and course.start_date < timezone.localdate():
        raise EventError("date_in_past")
    course.event_status = EventStatus.APPROVED
    course.event_changed_at = None
    _review(course, reviewer)
    course.save(update_fields=["event_status", "event_changed_at", "event_reviewed_at", "event_reviewed_by", "event_review_note"])
    sync_event_lesson(course, create=True)
    _notify_school(course, "school.event_approved")
    return course


@transaction.atomic
def reject_event(course, *, reviewer, note: str = "") -> Course:
    if course.event_status != EventStatus.PENDING:
        raise EventError("not_rejectable")
    course.event_status = EventStatus.REJECTED
    _review(course, reviewer, note)
    course.save(update_fields=["event_status", "event_reviewed_at", "event_reviewed_by", "event_review_note"])
    _notify_school(course, "school.event_rejected")
    return course


@transaction.atomic
def suspend_event(course, *, reviewer, note: str = "") -> Course:
    """Approved -> suspended: off the feeds and not bookable; the seats
    already booked stay. The school fixes and resubmits, or cancels."""
    if course.event_status != EventStatus.APPROVED:
        raise EventError("not_suspendable")
    course.event_status = EventStatus.SUSPENDED
    course.event_changed_at = None
    _review(course, reviewer, note)
    course.save(update_fields=["event_status", "event_changed_at", "event_reviewed_at", "event_reviewed_by", "event_review_note"])
    lesson = event_lesson(course)
    if lesson is not None:
        _broadcast_after_commit(lesson)
    _notify_school(course, "school.event_suspended")
    return course


@transaction.atomic
def mark_event_reviewed(course, *, reviewer) -> Course:
    """HQ looked at an edit made after approval: out of the "Modified" list."""
    if course.event_status != EventStatus.APPROVED:
        raise EventError("not_approved")
    course.event_changed_at = None
    _review(course, reviewer, course.event_review_note)
    course.save(update_fields=["event_changed_at", "event_reviewed_at", "event_reviewed_by"])
    return course


# --------------------------------------------------------------------------
# Emails (Celery, after commit -- CLAUDE.md domain rule 7)
# --------------------------------------------------------------------------


def _event_email_context(course, locale: str) -> dict:
    return {
        "school_name": course.school.name,
        "school_city": course.school.city or "",
        "event_name": course.name,
        "event_date": course.start_date.strftime("%d-%m-%Y") if course.start_date else "",
        "event_time": _hhmm(course.start_time) or "",
        "event_price": event_price(course) or "",
        "review_note": course.event_review_note or "",
        "events_url": f"{settings.FRONTEND_URL}/{locale}/school/events",
        "hq_events_url": f"{settings.FRONTEND_URL}/{locale}/hq/events",
    }


def hq_event_reviewers():
    """Active HQ members who may approve events -- the same rule the API
    guard applies (core.section_guard.hq_has_permission, "events" key)."""
    from accounts.models import HQMember

    return [
        m for m in HQMember.objects.filter(active=True).select_related("user")
        if hq_has_permission(m.user, "events")
    ]


def _notify_hq_submitted(course) -> None:
    reviewers = hq_event_reviewers()

    def _send():
        from notifications.tasks import send_transactional_email_task

        for member in reviewers:
            locale = getattr(member.user, "language_preference", "") or "en"
            send_transactional_email_task.delay(
                to_email=member.email or member.user.email, to_name=member.name, key="hq.event_submitted",
                context=_event_email_context(course, locale), locale=locale,
            )

    transaction.on_commit(_send)


def _notify_school(course, key: str) -> None:
    school = course.school
    if not school.email:
        return
    locale = school.language or "en"
    context = _event_email_context(course, locale)

    def _send():
        from notifications.tasks import send_transactional_email_task

        send_transactional_email_task.delay(
            to_email=school.email, to_name=school.name, key=key, context=context, locale=locale,
            school_id=str(school.id),
        )

    transaction.on_commit(_send)
