"""
Booking engine — the credit/access rules from the spec (sections 10-11).

Deduction priority: active subscription (1 access) → active package (credit_cost)
→ blocked. Cancellation compares hours-until-lesson against the school threshold:
before → refund, after → burn. No-show burns (handled at attendance, Phase 5).
"""

from datetime import datetime, timedelta
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from schools.models import SchoolStudent
from students.models import StudentPackage, StudentSubscription

from .models import Attendance, Booking


class BookingError(Exception):
    """Raised with a machine-ish reason string the API maps to 400."""


def _lesson_datetime(lesson):
    return timezone.make_aware(datetime.combine(lesson.date, lesson.start_time))


def _restriction_matches(restriction, lesson) -> bool:
    if not restriction or restriction == "all":
        return True
    return str(restriction) == str(lesson.lesson_type_id)


def _package_type_matches(package, lesson) -> bool:
    """Lesson-type dimension of package eligibility (PACKAGE_TO_SUBSCRIPTION.md
    §3.2/3.3): the new allowed_lesson_types list wins when set; an empty list
    falls back to the legacy single-value restriction old clients still write."""
    allowed = package.allowed_lesson_types or []
    if allowed:
        return str(lesson.lesson_type_id) in {str(t) for t in allowed}
    return _restriction_matches(package.lesson_type_restriction, lesson)


def _package_mode_matches(package, lesson) -> bool:
    """Delivery-mode dimension: online-only / in-person-only / both."""
    mode = package.mode_filter
    if not mode or mode == "all":
        return True
    return lesson.is_online == (mode == "online")


def _weekly_cap_reached(student_package, lesson) -> bool:
    """Optional per-package cap on bookings per calendar week (Mon-Sun),
    counted by the *lesson's* date. Confirmed/attended bookings count; so do
    burned ones (no-show, out-of-policy cancellation) — only a cancellation
    that refunded the credit frees the weekly slot again (§3.1b)."""
    cap = student_package.package.weekly_booking_cap if student_package.package_id else None
    if not cap:
        return False
    week_start = lesson.date - timedelta(days=lesson.date.weekday())
    week_end = week_start + timedelta(days=6)
    used = (
        Booking.objects.filter(
            student_package=student_package,
            lesson__date__gte=week_start,
            lesson__date__lte=week_end,
        )
        .exclude(status=Booking.Status.CANCELLED, credit_refunded=True)
        .count()
    )
    return used >= cap


def _credit_cost(lesson):
    if lesson.course_id and lesson.course.credit_cost:
        return lesson.course.credit_cost
    return Decimal("1")


def _min_notice_hours(lesson):
    if lesson.course_id:
        return lesson.course.min_booking_notice_hours
    return lesson.school.min_booking_notice_hours


def _has_valid_required_documents(student, school) -> bool:
    """Spec 11.2: a required document that isn't currently 'valid' (missing,
    expiring soon is still OK, but expired or never uploaded is not) blocks
    booking when the school has block_booking_on_documents enabled."""
    from schools.models import SchoolDocumentType
    from students.models import StudentDocument

    required_types = SchoolDocumentType.objects.filter(school=school, required=True, active=True)
    for doc_type in required_types:
        if not StudentDocument.objects.filter(
            student=student, school=school, type_ref=doc_type, status="valid"
        ).exists():
            return False
    return True


def _bump_lesson(lesson, delta):
    lesson.current_bookings = max(0, (lesson.current_bookings or 0) + delta)
    lesson.save(update_fields=["current_bookings"])


def _localized_lesson_type_name(lesson_type, locale: str) -> str:
    if lesson_type is None:
        return ""
    return getattr(lesson_type, f"name_{locale}", "") or lesson_type.name_en or lesson_type.code


def booking_email_context(booking, locale: str = "en") -> dict:
    """Every placeholder the HQ editor advertises for lesson emails (SAMPLE_VARS
    in hq/emails/page.tsx). A key missing here renders as an empty string, which
    is how "🕐 16:15 ()" and a bare "👩‍🏫" once reached a student's inbox."""
    student, lesson = booking.student, booking.lesson
    course = lesson.course
    teacher = lesson.teacher or (course.teacher if course else None)
    room = lesson.room or (course.room if course else None)
    location = room.location if room else None
    minutes = (datetime.combine(lesson.date, lesson.end_time) - datetime.combine(lesson.date, lesson.start_time)).seconds // 60
    return {
        "student_name": student.name,
        "school_name": booking.school.name,
        "lesson_name": (course.name if course else "") or _localized_lesson_type_name(lesson.lesson_type, locale),
        "lesson_date": lesson.date.strftime("%d-%m-%Y"),
        "lesson_time": lesson.start_time.strftime("%H:%M"),
        "lesson_duration": f"{minutes} min",
        "teacher_name": teacher.name if teacher else "",
        "location_name": location.name if location else "",
        "location_address": location.address if location else "",
        "room_name": room.name if room else "",
        "online_link": lesson.online_link or (course.online_link if course else ""),
        "booking_url": f"{settings.FRONTEND_URL}/{locale}/student/bookings",
    }


def lesson_email_key(lesson, key: str) -> str:
    """HQ keeps a separate "<key>.online" template (join link instead of the
    address); emails.get_template falls back to the in-person one if it is
    not written."""
    return f"student.{key}.online" if lesson.is_online else key


def _dispatch_email(booking, key: str) -> None:
    """Queue the confirmation/cancellation email only after the DB transaction
    actually commits — dispatching inside the atomic block would let a Celery
    worker pick up the task before (or despite) a later rollback."""
    student, lesson = booking.student, booking.lesson
    locale = student.language_preference or "en"

    def _send():
        from notifications.tasks import send_transactional_email_task

        send_transactional_email_task.delay(
            to_email=student.user.email, to_name=student.name, key=lesson_email_key(lesson, key),
            context=booking_email_context(booking, locale),
            locale=locale,
            school_id=str(booking.school_id),
        )

    transaction.on_commit(_send)


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
    """First eligible package for this lesson. Validity is checked against the
    LESSON's datetime, not the booking moment — so a buy-ahead package (whose
    starts_at is in the future) already covers next period's lessons, and a
    package expiring before the lesson never pays for it. Deduction order:
    recurring packages ("subscriptions") first, then earliest expiry."""
    lesson_dt = _lesson_datetime(lesson)
    candidates = StudentPackage.objects.filter(
        student=student, school=school, status="active"
    ).select_related("package")
    ordered = sorted(
        candidates,
        key=lambda p: (
            0 if (p.package_id and p.package.is_recurring) else 1,
            p.expires_at or lesson_dt,
        ),
    )
    for pkg in ordered:
        if pkg.starts_at and pkg.starts_at > lesson_dt:
            continue
        if pkg.expires_at and pkg.expires_at < lesson_dt:
            continue
        if pkg.credits_remaining < cost:
            continue
        if pkg.package_id:
            if not _package_type_matches(pkg.package, lesson):
                continue
            if not _package_mode_matches(pkg.package, lesson):
                continue
            if _weekly_cap_reached(pkg, lesson):
                continue
        return pkg
    return None


def assert_bookable(student, lesson, *, now=None):
    """Le condizioni di prenotabilita' che NON dipendono dal credito.

    Estratte da book_lesson perche' servono anche prima di incassare: il
    checkout drop-in (DROP_IN_BOOKING.md §5.1) le rivaluta prima di aprire la
    sessione Stripe, cosi' non prendiamo soldi per una lezione che gia'
    sappiamo non prenotabile. Solleva BookingError col motivo."""
    now = now or timezone.now()

    if lesson.status != "scheduled":
        raise BookingError("lesson_not_bookable")
    if (lesson.current_bookings or 0) >= (lesson.max_capacity or 0):
        raise BookingError("full")
    if Booking.objects.filter(student=student, lesson=lesson).exclude(status="cancelled").exists():
        raise BookingError("already_booked")
    if _lesson_datetime(lesson) - now < timedelta(hours=_min_notice_hours(lesson)):
        raise BookingError("min_notice")

    school = lesson.school
    if school.block_booking_on_documents and not _has_valid_required_documents(student, school):
        raise BookingError("documents_required")


def package_covers_lesson(package, lesson) -> bool:
    """Il pacchetto puo' pagare questa lezione? Tipo, modalita' e crediti
    sufficienti. `package` e' un catalog.Package, non uno StudentPackage."""
    return (
        package.credits >= _credit_cost(lesson)
        and _package_type_matches(package, lesson)
        and _package_mode_matches(package, lesson)
    )


def resolve_drop_in_package(lesson):
    """Il pacchetto "prezzo lezione singola" con cui comprare QUESTA lezione,
    o None se la scuola non ne ha configurato uno che la copra.

    Fra i drop-in attivi della scuola si tengono quelli compatibili per tipo e
    modalita' e con crediti sufficienti a pagarla; se piu' d'uno, vince il
    piu' economico. Nessun prodotto creato al volo: il catalogo resta pulito e
    il prezzo in mano alla scuola (DROP_IN_BOOKING.md §4)."""
    from catalog.models import Package

    candidates = [
        pkg
        for pkg in Package.objects.filter(
            school_id=lesson.school_id, active=True, is_drop_in=True, is_recurring=False
        )
        if package_covers_lesson(pkg, lesson)
    ]
    return min(candidates, key=lambda pkg: pkg.price, default=None)


def resolve_upsell_package(lesson):
    """Il pacchetto normale piu' conveniente fra quelli che coprono questa
    lezione, per la riga di upsell accanto al drop-in ("con 10 Lezioni questa
    lezione ti costerebbe X"). Si sceglie sul prezzo PER lezione, non sul
    totale: e' quello il confronto onesto col drop-in.

    Restano fuori i drop-in stessi e i ricorrenti: la riga deve dire una cosa
    vera e semplice, e un abbonamento non si compra per una lezione sola."""
    from catalog.models import Package

    cost = _credit_cost(lesson)
    candidates = [
        pkg
        for pkg in Package.objects.filter(
            school_id=lesson.school_id, active=True, is_drop_in=False, is_recurring=False
        )
        if pkg.credits > 0 and package_covers_lesson(pkg, lesson)
    ]
    return min(candidates, key=lambda pkg: Decimal(pkg.price) / Decimal(pkg.credits) * cost, default=None)


@transaction.atomic
def book_lesson(student, lesson, *, now=None):
    now = now or timezone.now()
    lesson = type(lesson).objects.select_for_update().get(pk=lesson.pk)

    assert_bookable(student, lesson, now=now)
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
        _dispatch_email(booking, "booking_confirmed")
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
        _dispatch_email(booking, "booking_confirmed")
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
        _dispatch_email(booking, "booking_confirmed")
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
    _dispatch_email(booking, "booking_cancelled")
    return booking


@transaction.atomic
def mark_attendance(lesson, student, teacher, *, status, status_ref=None, now=None):
    """
    Teacher marks a booked student Present/No-show. Credits/access were already
    deducted at booking time (eager deduction), so:
      - present  → booking finalized as 'attended', nothing further burned/refunded
      - no-show  → booking finalized as 'no_show'; the deduction stands (never
        refunded) UNLESS the school's custom AttendanceStatus says this status
        doesn't burn credit (status_ref.burns_credit is False), in which case
        the credit/access is refunded back — same refund logic as a policy-
        compliant cancellation.
    Re-marking (teacher corrects a mistake before the record is relied upon)
    is allowed and re-applies the correct refund/burn state idempotently.
    """
    now = now or timezone.now()
    if status not in (Attendance.Status.PRESENT, Attendance.Status.NO_SHOW):
        raise BookingError("invalid_status")

    booking = (
        Booking.objects.select_for_update()
        .filter(lesson=lesson, student=student)
        .exclude(status=Booking.Status.CANCELLED)
        .first()
    )
    if booking is None:
        raise BookingError("no_booking_for_student")

    should_refund = status == Attendance.Status.NO_SHOW and status_ref is not None and not status_ref.burns_credit

    if should_refund and not booking.credit_refunded:
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
        booking.credit_refunded = True

    booking.status = Booking.Status.ATTENDED if status == Attendance.Status.PRESENT else Booking.Status.NO_SHOW
    booking.save(update_fields=["status", "credit_refunded"])

    attendance, _ = Attendance.objects.update_or_create(
        lesson=lesson, student=student,
        defaults=dict(booking=booking, teacher=teacher, status=status, status_ref=status_ref, marked_at=now),
    )
    return attendance
