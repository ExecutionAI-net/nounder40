import logging

from celery import shared_task

from .emails import send_transactional_email

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def send_transactional_email_task(self, *, to_email, to_name, key, context, locale="en", school_id=None):
    """Async dispatch so a slow/unavailable ZeptoMail never blocks the actual
    business transaction (a booking succeeds even if its confirmation email
    is momentarily delayed)."""
    from schools.models import School

    school = School.objects.filter(pk=school_id).first() if school_id else None
    try:
        return send_transactional_email(
            to_email=to_email, to_name=to_name, key=key, context=context, locale=locale, school=school
        )
    except Exception as exc:  # noqa: BLE001 — retry on any transient send failure
        logger.warning("email send failed (key=%s to=%s): %s", key, to_email, exc)
        raise self.retry(exc=exc)


def _lesson_datetime(lesson):
    from datetime import datetime

    from django.utils import timezone as tz

    return tz.make_aware(datetime.combine(lesson.date, lesson.start_time))


@shared_task
def lesson_reminder_task(hours_before: int):
    """Beat fires this ~hourly; only sends to bookings whose lesson falls in
    the [hours_before, hours_before+1) window from now, so each booking gets
    exactly one reminder regardless of how often Beat actually runs."""
    from datetime import timedelta

    from django.utils import timezone

    from bookings.models import Booking
    from bookings.services import booking_email_context, lesson_email_key

    now = timezone.now()
    key = "lesson_reminder_1day" if hours_before >= 24 else "lesson_reminder_2hour"
    max_date = (now + timedelta(hours=hours_before + 1)).date()
    candidates = Booking.objects.filter(
        status=Booking.Status.CONFIRMED, lesson__date__gte=now.date(), lesson__date__lte=max_date,
    ).select_related(
        "student__user", "school", "lesson__lesson_type", "lesson__teacher", "lesson__room__location",
        "lesson__course__teacher", "lesson__course__room__location",
    )

    sent = 0
    for booking in candidates:
        delta_hours = (_lesson_datetime(booking.lesson) - now).total_seconds() / 3600
        if hours_before <= delta_hours < hours_before + 1:
            locale = booking.student.language_preference or "en"
            send_transactional_email_task.delay(
                to_email=booking.student.user.email, to_name=booking.student.name,
                key=lesson_email_key(booking.lesson, key),
                context=booking_email_context(booking, locale),
                locale=locale,
                school_id=str(booking.school_id),
            )
            sent += 1
    return sent


@shared_task
def absent_student_winback_task():
    """Beat fires this daily: courtesy "we miss you" emails to students whose
    LAST lesson at a school was exactly 30 (or 90) days ago and who have no
    upcoming booking there. The exact-day match means each student gets at
    most one email per threshold with no sent-state to track."""
    from datetime import timedelta

    from django.conf import settings

    from bookings.services import school_calendar_url
    from django.db.models import Max
    from django.utils import timezone

    from bookings.models import Booking
    from students.models import Student

    today = timezone.localdate()
    sent = 0
    for days, key in ((30, "student.we_miss_you_1m"), (90, "student.we_miss_you_3m")):
        target = today - timedelta(days=days)
        rows = (
            Booking.objects.filter(
                status__in=[Booking.Status.CONFIRMED, Booking.Status.ATTENDED], lesson__date__lte=today
            )
            .values("student_id", "school_id", "school__name")
            .annotate(last_date=Max("lesson__date"))
            .filter(last_date=target)
        )
        for r in rows:
            # Already coming back — no nudge needed
            if Booking.objects.filter(
                student_id=r["student_id"], school_id=r["school_id"],
                status=Booking.Status.CONFIRMED, lesson__date__gt=today,
            ).exists():
                continue
            student = Student.objects.select_related("user").filter(pk=r["student_id"]).first()
            if not student or not student.user_id or not student.user.email:
                continue
            send_transactional_email_task.delay(
                to_email=student.user.email, to_name=student.name, key=key,
                context={
                    "student_name": student.name,
                    "student_first_name": student.first_name or student.name.split(" ")[0],
                    "school_name": r["school__name"],
                    "days_absent": str(days), "last_lesson_date": target.strftime("%d-%m-%Y"),
                    "booking_url": f"{settings.FRONTEND_URL}/{student.language_preference or 'en'}/student/book",
                    "school_calendar_url": school_calendar_url(r["school_id"], student.language_preference or "en"),
                },
                locale=student.language_preference or "en",
                school_id=str(r["school_id"]),
            )
            sent += 1
    return sent


@shared_task
def document_expiry_reminder_task():
    """Spec 7.11: reminders at 30 and 7 days before a document expires."""
    from datetime import timedelta

    from django.utils import timezone

    from students.models import StudentDocument

    now = timezone.now()
    sent = 0
    for days, key in ((30, "document_expiring_30"), (7, "document_expiring_7")):
        window_start = now + timedelta(days=days)
        window_end = window_start + timedelta(days=1)
        docs = StudentDocument.objects.filter(
            expires_at__gte=window_start, expires_at__lt=window_end
        ).exclude(status="expired").select_related("student__user", "school")
        for doc in docs:
            send_transactional_email_task.delay(
                to_email=doc.student.user.email, to_name=doc.student.name, key=key,
                context={
                    "student_name": doc.student.name,
                    "student_first_name": doc.student.first_name or doc.student.name.split(" ")[0],
                    "document_type": doc.type, "days": str(days), "school_name": doc.school.name,
                },
                locale=doc.student.language_preference or "en",
                school_id=str(doc.school_id),
            )
            sent += 1
    return sent


@shared_task
def sync_document_statuses_task():
    """Housekeeping: valid → expiring (<30d) → expired, driven off expires_at."""
    from datetime import timedelta

    from django.utils import timezone

    from students.models import StudentDocument

    now = timezone.now()
    expired = StudentDocument.objects.filter(expires_at__lt=now).exclude(status="expired").update(status="expired")
    expiring = StudentDocument.objects.filter(
        expires_at__gte=now, expires_at__lt=now + timedelta(days=30), status="valid"
    ).update(status="expiring")
    return {"expired": expired, "expiring": expiring}


@shared_task
def weekly_kpi_report_task():
    """Spec 6.6: weekly KPI report email to HQ."""
    from datetime import timedelta

    from django.utils import timezone

    from accounts.models import HQMember
    from catalog.models import Lesson
    from schools.models import School
    from students.models import Student

    today = timezone.now().date()
    stats = {
        "active_schools": str(School.objects.filter(active=True).count()),
        "total_students": str(Student.objects.count()),
        "lessons_this_week": str(Lesson.objects.filter(date__gte=today, date__lt=today + timedelta(days=7)).count()),
    }
    sent = 0
    for member in HQMember.objects.filter(active=True).select_related("user"):
        send_transactional_email_task.delay(
            # "hq." prefix: that is the card's key in HQ > Emails (bare keys
            # only get the "student." fallback)
            to_email=member.user.email, to_name=member.name, key="hq.weekly_kpi_report", context=stats,
            locale=getattr(member.user, "language_preference", "") or "en",
        )
        sent += 1
    return sent


@shared_task
def package_expiring_task():
    """Daily: HQ > Emails "package_expiring" N days before a non-recurring
    package with credits left expires (N = HQ setting expiry_reminder_days)."""
    from datetime import timedelta

    from django.conf import settings
    from django.utils import timezone

    from bookings.services import package_email_context, school_calendar_url
    from students.models import StudentPackage

    from .emails import get_setting

    try:
        days = int(get_setting("expiry_reminder_days", "7"))
    except ValueError:
        days = 7
    window_start = timezone.now() + timedelta(days=days)
    window_end = window_start + timedelta(days=1)
    candidates = (
        StudentPackage.objects.filter(
            status="active", credits_remaining__gt=0, expires_at__gte=window_start, expires_at__lt=window_end,
        )
        .exclude(package__is_recurring=True)
        .select_related("student__user", "school", "package")
    )
    sent = 0
    for sp in candidates:
        student = sp.student
        locale = student.language_preference or "en"
        send_transactional_email_task.delay(
            to_email=student.user.email, to_name=student.name, key="package_expiring",
            context={
                "student_name": student.name,
                "student_first_name": student.first_name or student.name.split(" ")[0],
                "school_name": sp.school.name,
                **package_email_context(sp, locale),
                "days": str(days),
                "booking_url": f"{settings.FRONTEND_URL}/{locale}/student/book",
                "school_calendar_url": school_calendar_url(sp.school_id, locale),
            },
            locale=locale, school_id=str(sp.school_id),
        )
        sent += 1
    return sent
