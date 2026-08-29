"""Attivazione di un pagamento pacchetto — un solo punto, idempotente.

Ci arrivano due strade: il webhook `payment_intent.succeeded` e, quando il
browser rientra prima che Stripe abbia consegnato, `verify-session`. Stripe
consegna at-least-once e ritenta su risposta non-2xx, quindi la stessa
attivazione puo' arrivare piu' volte anche dalla stessa strada: la prima
scrive, le altre sono no-op. La chiave e' `Transaction.stripe_payment_id`,
con indice unico parziale a proteggere le corse.

Se il pagamento portava con se' una lezione (drop-in, DROP_IN_BOOKING.md §5.2)
la prenotazione parte subito dopo l'accredito, con il motore di prenotazione
normale: stessa capienza, stesso preavviso, stessi documenti, stessa politica
di cancellazione.
"""

from __future__ import annotations

from datetime import datetime

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from commerce.discounts import mark_redeemed


def activate_package_payment(*, payment_id: str, amount_cents: int, metadata: dict) -> str:
    """Accredita il pacchetto pagato e, se c'era, prenota la lezione.

    Ritorna una stringa di esito (usata dal webhook come risultato e dai test).
    """
    from catalog.models import Package
    from commerce.models import Transaction
    from schools.models import School
    from students.models import Student, StudentPackage

    meta = metadata or {}
    if meta.get("kind") != "package":
        return "not_a_package_payment"
    if not payment_id:
        return "no_payment_id"

    school = School.objects.filter(pk=meta.get("school_id")).first()
    student = Student.objects.filter(pk=meta.get("student_id")).first()
    package = Package.objects.filter(pk=meta.get("item_id")).first()
    if not (school and student and package):
        return "missing_refs"

    amount = amount_cents / 100
    fee = amount * float(school.platform_fee_percentage) / 100

    starts_at = None
    if meta.get("starts_at"):
        try:
            starts_at = datetime.fromisoformat(meta["starts_at"])
        except ValueError:
            starts_at = None
    validity_from = starts_at or timezone.now()

    with transaction.atomic():
        _tx, created = Transaction.objects.get_or_create(
            stripe_payment_id=payment_id,
            defaults=dict(
                school=school, student=student, type="package", product_id=package.id,
                product_name=package.name_en or package.name_it, amount=amount, currency="eur",
                platform_fee=fee, school_amount=amount - fee, payment_method="stripe",
                status="completed",
            ),
        )
        if not created:
            # Gia' incassato e accreditato: un retry non deve raddoppiare
            # nulla. La prenotazione, se prevista, l'ha gia' tentata il primo
            # passaggio (ed e' comunque dedotta da book_lesson).
            return "already_processed"

        StudentPackage.objects.create(
            student=student, school=school, package=package,
            credits_total=package.credits, credits_remaining=package.credits,
            starts_at=starts_at,
            expires_at=validity_from + package.validity_delta(),
            payment_method="stripe", stripe_payment_id=payment_id, status="active",
        )
        mark_redeemed(meta.get("discount_code_id"))

        # DENTRO la transazione, non dopo: se il processo morisse fra il commit
        # dei crediti e la prenotazione, il retry di Stripe troverebbe la
        # transazione gia' registrata, risponderebbe "already_processed" e la
        # lezione non verrebbe prenotata MAI. Cosi' invece o commettono
        # entrambi o si rifa' tutto al tentativo successivo.
        # book_lesson ha un suo atomic: un BookingError annulla solo il suo
        # savepoint, i crediti restano (ed e' quello che vogliamo, §3.3).
        lesson_id = meta.get("lesson_id")
        if not lesson_id:
            return "package_activated"
        return f"package_activated_{book_paid_lesson(student, lesson_id)}"


def book_paid_lesson(student, lesson_id: str) -> str:
    """Prenota la lezione che l'allieva aveva scelto prima di pagare.

    Se nel frattempo la lezione si e' riempita (o e' stata annullata) NON si
    rimborsa in denaro: il credito resta nel portafoglio, valido per un'altra
    lezione dello stesso tipo, e glielo diciamo (§3.3/§5.2.4). Il rimborso in
    denaro resta una decisione manuale della scuola, come per ogni altra
    prenotazione.
    """
    from bookings.services import BookingError, book_lesson
    from catalog.models import Lesson

    lesson = Lesson.objects.filter(pk=lesson_id).first()
    if lesson is None:
        return "lesson_gone"

    try:
        book_lesson(student, lesson)
    except BookingError as exc:
        reason = str(exc)
        if reason == "already_booked":
            # Seconda consegna dello stesso pagamento, o l'allieva ha
            # prenotato a mano nel frattempo: nulla da fare.
            return "already_booked"
        _notify_booking_failed(student, lesson, reason)
        return f"not_booked_{reason}"
    return "booked"


def _notify_booking_failed(student, lesson, reason: str) -> None:
    from notifications.models import Notification

    Notification.objects.create(
        user=student.user, user_role="student", type="drop_in_booking_failed",
        title="Prenotazione non riuscita",
        body="La lezione non e' piu' disponibile. Il tuo credito resta valido "
             "per un'altra lezione dello stesso tipo.",
        data={"lesson_id": str(lesson.id), "reason": reason, "school_id": str(lesson.school_id)},
    )

    def _send():
        from notifications.tasks import send_transactional_email_task

        send_transactional_email_task.delay(
            to_email=student.user.email, to_name=student.name, key="drop_in_booking_failed",
            context={
                "student_name": student.name, "school_name": lesson.school.name,
                "lesson_date": str(lesson.date), "lesson_time": lesson.start_time.strftime("%H:%M"),
                # Il template built-in ci mette il bottone "scegli un'altra
                # lezione": senza questa chiave il pulsante punterebbe a nulla.
                "booking_url": f"{settings.FRONTEND_URL}/student/book",
                "reason": reason,
            },
            locale=student.language_preference or "en",
            school_id=str(lesson.school_id),
        )

    # Mai dentro l'atomic: un rollback lascerebbe partire una mail fantasma.
    transaction.on_commit(_send)
