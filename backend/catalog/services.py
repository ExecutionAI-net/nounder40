"""Da crediti a lezioni: la traduzione che serve all'allieva.

I crediti sono la nostra contabilita'. Chi compra ragiona in lezioni: quante
ne fa e quanto le costa una. Un pacchetto "100 crediti a 95 euro" non dice
niente; "5 lezioni a 19 euro l'una" si confronta con la lezione singola in un
secondo.

La conversione e' possibile solo se i tipi di lezione coperti costano tutti
lo stesso: con corsi da 11 e da 15 crediti nello stesso pacchetto non esiste
un "numero di lezioni". In quel caso non si inventa nulla e la vetrina resta
sui crediti — e' lo stesso limite che il pannello scuola segnala quando si
marca un prezzo lezione singola.
"""

from __future__ import annotations

from decimal import Decimal

from django.db import models, transaction


def course_cost_index(school_ids) -> dict:
    """{(school_id, lesson_type_id): {(costo, is_online), ...}} per i corsi
    attivi delle scuole indicate. Una query sola: la vetrina elenca decine di
    pacchetti e calcolarlo per pacchetto sarebbe un N+1."""
    from .models import Course

    index: dict = {}
    rows = Course.objects.filter(school_id__in=list(school_ids), active=True).values_list(
        "school_id", "lesson_type_id", "credit_cost", "is_online"
    )
    for school_id, lesson_type_id, cost, is_online in rows:
        if lesson_type_id is None or cost is None:
            continue
        index.setdefault((school_id, lesson_type_id), set()).add((Decimal(cost), is_online))
    return index


def package_lesson_cost(package, index: dict) -> Decimal | None:
    """Quanti crediti costa UNA lezione fra quelle che il pacchetto copre, o
    None se i tipi coperti costano diverso (o non ci sono corsi)."""
    allowed = [t for t in (package.allowed_lesson_types or [])]
    if not allowed:
        return None

    mode = package.mode_filter or "all"
    costs = set()
    for lesson_type_id in allowed:
        for cost, is_online in index.get((package.school_id, _as_uuid(lesson_type_id)), ()):
            if mode == "online" and not is_online:
                continue
            if mode == "in_person" and is_online:
                continue
            costs.add(cost)
    if len(costs) != 1:
        return None
    cost = costs.pop()
    return cost if cost > 0 else None


def _as_uuid(value):
    import uuid

    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError):
        return value


def date_in_school_closure(school_id, d) -> bool:
    """QA #8: `SchoolClosure` (date [, end_date] range per school) was recorded
    but never checked anywhere — a student could book, and a course's weekly
    generator would happily create, a lesson on a day the school is shut.

    We treat any closure row covering `d` (date == date, or date <= d <=
    end_date when end_date is set) as blocking the WHOLE day, including a
    `type=partial` one with a `from_time`: a per-time-slot closure would need
    the lesson's start_time here too, which none of the current call sites
    (lesson generation, has no time yet decided per-date; booking, could pass
    it) plumb through consistently. Blocking the full day is the safe
    default — worst case a school marks a slot booked when it meant only the
    morning off, which they can fix by narrowing the closure, versus silently
    letting a booking through on a day the school is actually closed."""
    from schools.models import SchoolClosure

    return SchoolClosure.objects.filter(school_id=school_id, date__lte=d).filter(
        models.Q(end_date__isnull=True, date=d) | models.Q(end_date__isnull=False, end_date__gte=d)
    ).exists()


@transaction.atomic
def cascade_delete_course(course) -> dict:
    """QA #7 "ghost lessons": `Lesson.course` is `SET_NULL`, so a bare
    `Course.objects...delete()` (e.g. the generic `CourseViewSet.destroy`,
    which used to do exactly that with no override) left every Lesson it had
    generated behind — course=NULL, status still "scheduled", so still on the
    calendar, still in the teacher dashboard, still bookable, with no view
    anywhere to find and clean them up.

    Policy (deliberately not "delete everything the course generated"):
      - PAST lessons: untouched. They're the historical record attendance/
        compensation reporting reads later; course=NULL on them is fine — a
        past class doesn't need its now-deleted course to still mean anything.
      - FUTURE lessons with NO confirmed booking: hard-deleted. Nothing else
        references them, so nothing is lost, and this is what actually kills
        the ghost-lesson problem instead of just tagging it.
      - FUTURE lessons WITH a confirmed booking: the booking is refunded and
        cancelled with the same bookkeeping the class-cancel endpoints already
        use (credit/access-remaining given back, `notify_lesson_cancelled_by_school`
        email), and the Lesson is marked CANCELLED rather than deleted —
        `Booking.lesson` is `on_delete=CASCADE`, so deleting the Lesson here
        would cascade-delete the very Booking row we just finished stamping as
        refunded, destroying the refund's own audit trail. A cancelled lesson
        is not bookable (`assert_bookable` rejects non-"scheduled" lessons)
        and reads clearly in the calendar (grey, "Annullata"), same as any
        other school-side cancellation.

    Called from both the course delete endpoints (`CourseViewSet.destroy` and
    `SchoolCourseDetailView.delete`) so whichever URL a client hits behaves
    the same way. Caller is still responsible for deleting the Course row
    itself afterwards.
    """
    from datetime import date as date_cls

    from django.db.models import F
    from django.utils import timezone

    from bookings.models import Booking
    from bookings.services import notify_lesson_cancelled_by_school
    from students.models import StudentPackage, StudentSubscription

    from .models import Lesson

    # Deleting the course nulls Lesson.course, which would lose the inherited
    # language on booking/credit history — stamp it onto lessons first.
    if course.language:
        Lesson.objects.filter(course_id=course.id, language="").update(language=course.language)

    today = date_cls.today()
    future_lessons = list(
        Lesson.objects.filter(course_id=course.id, date__gte=today).exclude(status=Lesson.Status.CANCELLED)
    )
    future_ids = [lsn.id for lsn in future_lessons]

    bookings = (
        list(
            Booking.objects.filter(status="confirmed", lesson_id__in=future_ids).select_related(
                "student__user", "school", "lesson__lesson_type", "lesson__teacher", "lesson__room__location",
                "lesson__course__teacher", "lesson__course__room__location",
            )
        )
        if future_ids
        else []
    )
    booked_lesson_ids = {b.lesson_id for b in bookings}

    for b in bookings:
        if b.access_source == Booking.AccessSource.PACKAGE and b.student_package_id and b.credits_deducted > 0:
            StudentPackage.objects.filter(pk=b.student_package_id).update(
                credits_remaining=F("credits_remaining") + b.credits_deducted
            )
        elif b.access_source == Booking.AccessSource.SUBSCRIPTION and b.student_subscription_id:
            StudentSubscription.objects.filter(pk=b.student_subscription_id, access_remaining__isnull=False).update(
                access_remaining=F("access_remaining") + 1
            )
    if bookings:
        Booking.objects.filter(id__in=[b.id for b in bookings]).update(
            status=Booking.Status.CANCELLED, cancelled_at=timezone.now(),
            cancellation_type=Booking.CancellationType.WITHIN_POLICY, credit_refunded=True,
        )

    cancel_ids = [lid for lid in future_ids if lid in booked_lesson_ids]
    delete_ids = [lid for lid in future_ids if lid not in booked_lesson_ids]

    if cancel_ids:
        Lesson.objects.filter(id__in=cancel_ids).update(status=Lesson.Status.CANCELLED)
    deleted_count = 0
    if delete_ids:
        deleted_count, _ = Lesson.objects.filter(id__in=delete_ids).delete()

    notify_lesson_cancelled_by_school(bookings)

    return {
        "future_lessons": len(future_ids),
        "lessons_deleted": deleted_count,
        "lessons_cancelled": len(cancel_ids),
        "bookings_refunded": len(bookings),
    }


def lessons_for(credits, cost) -> int:
    """Quante lezioni intere paga quel credito. Il resto NON si arrotonda su:
    con 15 crediti e lezioni da 20 non ci si entra, e dire "1" sarebbe una
    promessa che la prenotazione poi non mantiene.

    Chi chiama decide cosa fare dello zero, perche' vuol dire cose diverse:
    in vetrina un pacchetto che non paga nemmeno una lezione e' meglio
    descriverlo in crediti (0 → None), mentre "0 lezioni rimaste" su un
    pacchetto esaurito e' l'informazione giusta.
    """
    return int(Decimal(credits) // Decimal(cost))
