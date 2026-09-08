"""
Booking engine — the credit/access rules from the spec (sections 10-11).

Deduction priority: active subscription (1 access) → active package (credit_cost)
→ blocked. Cancellation compares hours-until-lesson against the school threshold:
before → refund, after → burn. No-show burns (handled at attendance, Phase 5).
"""

import html as html_mod
from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from schools.models import School, SchoolStudent
from students.models import StudentPackage, StudentSubscription

from .models import Attendance, Booking


class BookingError(Exception):
    """Raised with a machine-ish reason string the API maps to 400.
    ``documents`` optionally carries the human-readable name(s) of the school
    document type(s) missing/invalid, for the "documents_required" reason —
    so the API can pass real names through instead of the frontend building
    its own (previously empty) copy of the same message (QA H-1/H-8)."""

    def __init__(self, reason, documents=None):
        super().__init__(reason)
        self.documents = documents or []


def _lesson_datetime(lesson):
    """QA R2-H14: `lesson.date`/`lesson.start_time` are naive — chosen by the
    school in ITS OWN local wall-clock time, not UTC. Django's own
    `TIME_ZONE` is "UTC", so `timezone.make_aware()` (which uses the current/
    default timezone) previously stamped "12:12" as 12:12 UTC — a ~2h drift
    from a Rome school's actual CEST offset that inverted refund/booking-
    eligibility decisions right at the policy boundary (live: server said
    "within policy, refund" while the UI, using the browser's local zone,
    said it would not be refunded). Interpret the wall-clock time in the
    SCHOOL's own configured timezone (`School.timezone`) instead."""
    try:
        tz = ZoneInfo(lesson.school.timezone or "UTC")
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("UTC")
    return datetime.combine(lesson.date, lesson.start_time, tzinfo=tz)


def upcoming_lessons_q(now=None):
    """Queryset-level twin of `_lesson_datetime()`: keep only lessons that have
    NOT started yet, decided in each school's own timezone.

    A lesson whose start time has passed is no longer bookable, so it must
    leave the student booking calendar and the public board — even when it is
    still "today" (at 10:00:01 the 10:00 class is gone). Filtering by `date` alone
    (`date__gte=today`, the previous behaviour, QA R2 ST-R2-21 / TCH-R2-13)
    kept every lesson of the day visible with a live "Book" button that could
    only end in a "too late" error.

    `date`/`start_time` are naive wall-clock values in `School.timezone`, so
    "now" is converted into each timezone in use (one Q branch per distinct
    value — a handful at most); blank/unknown names fall back to UTC exactly
    like `_lesson_datetime()`.
    """
    now = now or timezone.now()
    q = Q(pk__in=[])  # matches nothing until a timezone branch is OR-ed in
    for tz_name in set(School.objects.values_list("timezone", flat=True).distinct()):
        try:
            tz = ZoneInfo(tz_name or "UTC")
        except (ZoneInfoNotFoundError, ValueError):
            tz = ZoneInfo("UTC")
        local = now.astimezone(tz)
        q |= Q(school__timezone=tz_name) & (
            Q(date__gt=local.date()) | Q(date=local.date(), start_time__gte=local.time())
        )
    return q


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


def _missing_required_document_names(student, school) -> list[str]:
    """Spec 11.2: a required document that isn't currently 'valid' (missing,
    expiring soon is still OK, but expired or never uploaded is not) blocks
    booking when the school has block_booking_on_documents enabled. Returns
    the human-readable name(s) of the required document type(s) this student
    doesn't currently have a 'valid' upload for at this school — used to
    build a real documents_required error message instead of a bare reason
    code the frontend has no way to fill in on its own (QA H-1/H-8)."""
    from schools.models import SchoolDocumentType
    from students.models import StudentDocument

    required_types = SchoolDocumentType.objects.filter(school=school, required=True, active=True)
    return [
        doc_type.name
        for doc_type in required_types
        if not StudentDocument.objects.filter(
            student=student, school=school, type_ref=doc_type, status="valid"
        )
        # QA R2-H6: a document with no actual attachment (files=[] and no
        # file_url -- reachable via a direct API call, bypassing the
        # frontend's own client-side file-count check) must never satisfy a
        # required-document gate on status alone.
        .exclude(files=[], file_url="")
        .exists()
    ]


def _bump_lesson(lesson, delta):
    lesson.current_bookings = max(0, (lesson.current_bookings or 0) + delta)
    lesson.save(update_fields=["current_bookings"])


def _localized_lesson_type_name(lesson_type, locale: str) -> str:
    if lesson_type is None:
        return ""
    return getattr(lesson_type, f"name_{locale}", "") or lesson_type.name_en or lesson_type.code


# Heading of the {{school_info_block}} placeholder, per student locale.
_SCHOOL_INFO_HEADING = {
    "it": "Importante — Informazioni dalla scuola",
    "en": "Important — Information from the school",
    "es": "Importante — Información de la escuela",
    "fr": "Important — Informations de l'école",
    "de": "Wichtig — Informationen der Schule",
}


def _school_info(lesson) -> str:
    """Course/lesson "info for confirmation & reminder emails": the per-lesson
    override wins, an empty one inherits the course-level text."""
    info = (lesson.email_info or "").strip()
    if not info and lesson.course_id:
        info = (lesson.course.email_info or "").strip()
    return info


def _school_info_block(lesson, locale: str) -> str:
    """{{school_info_block}}: empty string when the school wrote nothing, else
    a ready-made HTML block ("Importante — Informazioni dalla scuola" + text).
    Templates have no conditionals, so the if-filled logic lives here. The text
    is school-written free text going into an HTML body: escape it."""
    info = _school_info(lesson)
    if not info:
        return ""
    heading = _SCHOOL_INFO_HEADING.get(locale, _SCHOOL_INFO_HEADING["en"])
    text = html_mod.escape(info, quote=False).replace("\n", "<br>")
    return f"<br><br><strong>❗ {heading}:</strong><br>{text}"


def _location_line(room) -> str:
    """{{location_line}}: the "📍 place · room" segment of lesson emails.

    ST-R2-15: the built-in templates used to hardcode "📍 {{location_name}} ·
    {{room_name}}" — with no room assigned that rendered a bare "📍 · " line.
    Same fix as _school_info_block: templates have no conditionals, so the
    if-filled logic (and the leading newline that separates it from the
    teacher line above it) lives here instead."""
    location = room.location if room else None
    header = " · ".join(p for p in (
        location.name if location else None,
        room.name if room else None,
    ) if p)
    lines = ([f"📍 {header}"] if header else []) + ([location.address] if location and location.address else [])
    return ("\n" + "\n".join(lines)) if lines else ""


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
        "student_first_name": student.first_name or student.name.split(" ")[0],
        "school_name": booking.school.name,
        "lesson_name": (course.name if course else "") or _localized_lesson_type_name(lesson.lesson_type, locale),
        "lesson_date": lesson.date.strftime("%d-%m-%Y"),
        "lesson_time": lesson.start_time.strftime("%H:%M"),
        "lesson_duration": f"{minutes} min",
        "teacher_name": teacher.name if teacher else "",
        "teacher_first_name": (teacher.first_name or teacher.name.split(" ")[0]) if teacher else "",
        "location_name": location.name if location else "",
        "location_address": location.address if location else "",
        "room_name": room.name if room else "",
        "location_line": _location_line(room),
        "online_link": lesson.online_link or (course.online_link if course else ""),
        "school_info": _school_info(lesson),
        "school_info_block": _school_info_block(lesson, locale),
        "booking_url": student_email_link(f"{settings.FRONTEND_URL}/{locale}/student/bookings", student.user.email),
        "school_calendar_url": student_email_link(school_calendar_url(booking.school_id, locale), student.user.email),
        "cancellation_hours": str(booking.school.cancellation_policy_hours),
    }


def student_email_link(url: str, email: str) -> str:
    """Append the recipient to a student-facing link (?for=email): the app
    shows a "you are logged in as X but this was for Y" banner when the
    browser holds another session. Purely informative — never an identity."""
    from urllib.parse import quote

    sep = "&" if "?" in url else "?"
    return f"{url}{sep}for={quote(email)}"


def school_calendar_url(school_id, locale: str = "en") -> str:
    """The school's own calendar link (same one the school copies from its
    profile): {{school_calendar_url}} in every email that has a school."""
    return f"{settings.FRONTEND_URL}/{locale}/student/book?school_id={school_id}"


def _fmt_credits(value) -> str:
    return format(Decimal(value).normalize(), "f")


# {{package_summary}} (ST-R2-15): "10 lezioni (10 crediti)" / singular
# "1 lezione (1 credito)" / and — when the package covers every lesson type
# and package_lesson_cost() can't name a single per-lesson cost — a phrase
# instead of the blank count that used to reach "✨  lezioni (10 crediti)".
_LESSON_WORD = {
    "it": ("lezione", "lezioni"),
    "en": ("lesson", "lessons"),
    "es": ("clase", "clases"),
    "fr": ("cours", "cours"),
    "de": ("Stunde", "Stunden"),
}
_CREDIT_WORD = {
    "it": ("credito", "crediti"),
    "en": ("credit", "credits"),
    "es": ("crédito", "créditos"),
    "fr": ("crédit", "crédits"),
    "de": ("Credit", "Credits"),
}
_ALL_LESSON_TYPES = {
    "it": "tutte le tipologie di lezione",
    "en": "all lesson types",
    "es": "todos los tipos de clase",
    "fr": "tous les types de cours",
    "de": "alle Stundenarten",
}


def _pluralize(value_str: str, singular: str, plural: str) -> str:
    try:
        return singular if Decimal(value_str) == 1 else plural
    except Exception:
        return plural


def _package_summary(lessons_str: str, credits_str: str, locale: str) -> str:
    credit_singular, credit_plural = _CREDIT_WORD.get(locale, _CREDIT_WORD["en"])
    credits_phrase = f"{credits_str} {_pluralize(credits_str, credit_singular, credit_plural)}"
    if not lessons_str:
        head = _ALL_LESSON_TYPES.get(locale, _ALL_LESSON_TYPES["en"])
        return f"{head} ({credits_phrase})"
    lesson_singular, lesson_plural = _LESSON_WORD.get(locale, _LESSON_WORD["en"])
    lessons_phrase = f"{lessons_str} {_pluralize(lessons_str, lesson_singular, lesson_plural)}"
    return f"{lessons_phrase} ({credits_phrase})"


def package_email_context(student_package, locale: str = "en", *, lesson_cost=None) -> dict:
    """Placeholders about a package (credits_low, after_purchase, package_expiring).

    Lessons, not just credits: the same conversion "I miei pacchetti" shows
    (catalog.services) — the credit cost of the lessons the package covers.
    lesson_cost overrides it with the cost of the lesson just booked; when
    neither is known (mixed costs) the lessons placeholders render empty."""
    from catalog.services import course_cost_index, package_lesson_cost

    pkg = student_package.package
    cost = lesson_cost
    if cost is None and pkg is not None and not pkg.is_unlimited:
        cost = package_lesson_cost(pkg, course_cost_index([student_package.school_id]))

    def lessons(credits):
        return str(int(Decimal(credits) // Decimal(cost))) if cost else ""

    credits_total = _fmt_credits(student_package.credits_total)
    lessons_total = lessons(student_package.credits_total)

    return {
        "package_name": pkg.localized_name(locale) if pkg else "",
        "package_expiry": student_package.expires_at.strftime("%d-%m-%Y") if student_package.expires_at else "",
        "credits_remaining": _fmt_credits(student_package.credits_remaining),
        "credits_total": credits_total,
        "lessons_remaining": lessons(student_package.credits_remaining),
        "lessons_total": lessons_total,
        "package_summary": _package_summary(lessons_total, credits_total, locale),
    }


def _dispatch_credits_low(booking, student_package, *, before, cost) -> None:
    """HQ > Emails "credits_low": once, when this booking takes the package
    across the HQ threshold (not on every booking below it). The threshold
    counts LESSONS left — credits divided by what this lesson costs — because
    "5 credits" means nothing to a student whose lesson costs 20."""
    from notifications.emails import get_setting

    threshold = Decimal(get_setting("credits_low_threshold", "5"))
    lessons_after = student_package.credits_remaining / cost
    lessons_before = before / cost
    if not (lessons_after <= threshold < lessons_before):
        return
    student = booking.student
    locale = student.language_preference or "en"
    context = {
        **booking_email_context(booking, locale),
        **package_email_context(student_package, locale, lesson_cost=cost),
        "credits_threshold": _fmt_credits(threshold),
    }

    def _send():
        from notifications.tasks import send_transactional_email_task

        send_transactional_email_task.delay(
            to_email=student.user.email, to_name=student.name, key="credits_low",
            context=context, locale=locale, school_id=str(booking.school_id),
        )

    transaction.on_commit(_send)


def lesson_email_key(lesson, key: str) -> str:
    """HQ keeps a separate "<key>.online" template (join link instead of the
    address); emails.get_template falls back to the in-person one if it is
    not written."""
    return f"student.{key}.online" if lesson.is_online else key


# The school hears about the same events, from its own HQ > Emails templates.
_SCHOOL_KEYS = {"booking_confirmed": "school.new_booking", "booking_cancelled": "school.booking_cancelled"}


def _dispatch_email(booking, key: str) -> None:
    """Queue the student's email (and the school's counterpart, if the event
    has one) only after the DB transaction actually commits — dispatching
    inside the atomic block would let a Celery worker pick up the task before
    (or despite) a later rollback."""
    student, lesson, school = booking.student, booking.lesson, booking.school
    locale = student.language_preference or "en"
    school_key = _SCHOOL_KEYS.get(key)

    def _send():
        from notifications.tasks import send_transactional_email_task

        send_transactional_email_task.delay(
            to_email=student.user.email, to_name=student.name, key=lesson_email_key(lesson, key),
            context=booking_email_context(booking, locale),
            locale=locale,
            school_id=str(booking.school_id),
        )
        if school_key and school.email:
            school_locale = school.language or "en"
            send_transactional_email_task.delay(
                to_email=school.email, to_name=school.name, key=school_key,
                context={
                    **booking_email_context(booking, school_locale),
                    "student_email": student.user.email,
                    "dashboard_url": f"{settings.FRONTEND_URL}/{school_locale}/school/lessons",
                },
                locale=school_locale,
                school_id=str(booking.school_id),
            )

    transaction.on_commit(_send)


def notify_lesson_cancelled_by_school(bookings) -> None:
    """The school cancelled a lesson (class or whole course deleted): every
    student who held a confirmed booking gets "lesson_cancelled_by_school"
    (online variant when applicable). Call after the refund/status updates;
    the emails queue on commit like every other one."""
    for booking in bookings:
        _dispatch_email(booking, "lesson_cancelled_by_school")


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
    # QA #8: SchoolClosure was recorded but never enforced anywhere — a
    # student could book straight through a day the school marked closed.
    # Checked here (not just at lesson-generation time) so an existing lesson
    # that predates the closure is still blocked from new bookings, without
    # us touching bookings/lessons that already existed on it (out of scope).
    from catalog.services import date_in_school_closure

    if date_in_school_closure(lesson.school_id, lesson.date):
        raise BookingError("school_closed")
    if (lesson.current_bookings or 0) >= (lesson.max_capacity or 0):
        raise BookingError("full")
    if Booking.objects.filter(student=student, lesson=lesson).exclude(status="cancelled").exists():
        raise BookingError("already_booked")
    # QA TCH-R2-13: a lesson whose start has already passed used to fall out
    # of the same "hours until lesson < min_booking_notice_hours" check as a
    # genuinely-future lesson inside the notice window, so both cases raised
    # the identical "min_notice" reason. The UI showed "too late to book" for
    # a class that hadn't even happened yet, which reads as "come back closer
    # to class time" — misleading when the real answer is "this already ran".
    # Split the two: a lesson that has actually started/ended gets its own
    # reason, `min_notice` is now reserved for a genuinely future lesson still
    # inside the school's/course's notice window.
    lesson_dt = _lesson_datetime(lesson)
    if lesson_dt <= now:
        raise BookingError("lesson_already_started")
    if lesson_dt - now < timedelta(hours=_min_notice_hours(lesson)):
        raise BookingError("min_notice")

    school = lesson.school
    if school.block_booking_on_documents:
        missing = _missing_required_document_names(student, school)
        if missing:
            raise BookingError("documents_required", documents=missing)


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

    # Booking here makes her one of this school's students (the link carries
    # the free-lesson flag), and if she has no home school yet — registration
    # from a shared lesson link skips "choose your school" — this becomes it.
    ss, _ = SchoolStudent.objects.get_or_create(school=school, student=student)
    if student.school_id is None:
        student.school = school
        student.save(update_fields=["school"])

    # Free first lesson (per student per school): her first booking here.
    if school.free_first_lesson and not ss.free_lesson_used:
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
        _dispatch_credits_low(booking, pkg, before=pkg.credits_remaining + cost, cost=cost)
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
    Teacher marks a booked student Present/No-show. Attendance never touches
    credits (decision with Carlo, 2026-08-30): the credit was deducted at
    booking time and only moves with a cancellation — by the student, within
    or outside the school's notice period, or by the school cancelling the
    whole lesson (refund for everyone). A status' "counts as absence" flag
    (AttendanceStatus.burns_credit) only decides present vs no_show, i.e.
    statistics and the no_show email. Re-marking is allowed.
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

    booking.status = Booking.Status.ATTENDED if status == Attendance.Status.PRESENT else Booking.Status.NO_SHOW
    booking.save(update_fields=["status"])
    if booking.status == Booking.Status.NO_SHOW and not booking.credit_refunded:
        # HQ > Emails "no_show": the absence cost her the credit
        _dispatch_email(booking, "no_show")

    attendance, _ = Attendance.objects.update_or_create(
        lesson=lesson, student=student,
        defaults=dict(booking=booking, teacher=teacher, status=status, status_ref=status_ref, marked_at=now),
    )
    return attendance


# ---------------------------------------------------------------------------
# Manual enrolment "at the desk": the school from its panel, or a teacher the
# school made staff (TeacherSchool.can_manage_bookings, teachers/access.py).
# This was the body of catalog.course_views.SchoolClassStudentsView; it lives
# here now that it has two callers — there must not be a second way of moving
# credits.
#
# Deliberate differences from book_lesson (the student's self-service): no
# minimum notice, closure or document checks — whoever is at the desk
# decides; no welcome free lesson; no emails. Same charging priority:
# active subscription first, then the package expiring soonest.
#
# Capacity is the one exception (QA R2-M12): the desk may still squeeze
# someone in, but never by accident. Over capacity the enrolment is refused
# with "lesson_full" unless the caller explicitly asks for `allow_overbooking`,
# and the resulting booking carries `overbooked = True` so the API can say so.
# ---------------------------------------------------------------------------


def refund_bookings(bookings) -> None:
    """Give credit/access back for the given bookings (a school-side
    cancellation is always within policy)."""
    from django.db.models import F

    for b in bookings:
        if b.access_source == Booking.AccessSource.PACKAGE and b.student_package_id and b.credits_deducted > 0:
            StudentPackage.objects.filter(pk=b.student_package_id).update(
                credits_remaining=F("credits_remaining") + b.credits_deducted
            )
        elif b.access_source == Booking.AccessSource.SUBSCRIPTION and b.student_subscription_id:
            StudentSubscription.objects.filter(pk=b.student_subscription_id, access_remaining__isnull=False).update(
                access_remaining=F("access_remaining") + 1
            )


@transaction.atomic
def staff_enrol(lesson, student_id, *, now=None, allow_overbooking=False):
    """Book `student_id` onto `lesson` on the student's behalf.
    BookingError: lesson_cancelled, already_booked, lesson_full,
    no_valid_access.

    `allow_overbooking=True` is the desk saying "yes, I know, put her in
    anyway": the seat limit is then ignored and the returned booking has
    `overbooked = True` (a transient attribute, not a column) so the caller
    can warn."""
    from django.db.models import F

    now = now or timezone.now()
    if lesson.status == "cancelled":
        raise BookingError("lesson_cancelled")
    if Booking.objects.filter(lesson=lesson, student_id=student_id, status__in=["confirmed", "attended"]).exists():
        raise BookingError("already_booked")
    overbooked = (lesson.current_bookings or 0) >= (lesson.max_capacity or 0)
    if overbooked and not allow_overbooking:
        raise BookingError("lesson_full")

    school_id = lesson.school_id
    credit_cost = lesson.course.credit_cost if lesson.course_id else 1
    access_source = Booking.AccessSource.PACKAGE
    student_package_id = None
    student_subscription_id = None
    credits_deducted = 0

    sub = StudentSubscription.objects.filter(student_id=student_id, school_id=school_id, status="active").first()
    if sub and (sub.access_total is None or (sub.access_remaining or 0) > 0):
        access_source = Booking.AccessSource.SUBSCRIPTION
        student_subscription_id = sub.id
        if sub.access_total is not None:
            StudentSubscription.objects.filter(pk=sub.id).update(access_remaining=F("access_remaining") - 1)
    else:
        pkg = (
            StudentPackage.objects.filter(
                student_id=student_id, school_id=school_id, status="active", credits_remaining__gte=credit_cost
            )
            .order_by("expires_at")
            .first()
        )
        if not pkg:
            raise BookingError("no_valid_access")
        student_package_id = pkg.id
        credits_deducted = credit_cost
        StudentPackage.objects.filter(pk=pkg.id).update(credits_remaining=F("credits_remaining") - credit_cost)

    booking = Booking.objects.create(
        student_id=student_id, lesson=lesson, school_id=school_id, access_source=access_source,
        student_package_id=student_package_id, student_subscription_id=student_subscription_id,
        credits_deducted=credits_deducted, status=Booking.Status.CONFIRMED, booked_at=now,
    )
    type(lesson).objects.filter(pk=lesson.pk).update(current_bookings=F("current_bookings") + 1)
    booking.overbooked = overbooked
    return booking


@transaction.atomic
def staff_unenrol(lesson, student_id, *, now=None):
    """Cancel the student's confirmed booking on `lesson`, credit given back
    (always within policy: the school decided). BookingError
    booking_not_found — an attended/no-show booking is history, not a seat."""
    now = now or timezone.now()
    booking = Booking.objects.filter(
        lesson=lesson, student_id=student_id, school_id=lesson.school_id, status="confirmed"
    ).first()
    if booking is None:
        raise BookingError("booking_not_found")
    refund_bookings([booking])
    booking.status = Booking.Status.CANCELLED
    booking.cancelled_at = now
    booking.cancellation_type = Booking.CancellationType.WITHIN_POLICY
    booking.credit_refunded = True
    booking.save(update_fields=["status", "cancelled_at", "cancellation_type", "credit_refunded"])
    lesson.refresh_from_db(fields=["current_bookings"])
    _bump_lesson(lesson, -1)
    return booking
