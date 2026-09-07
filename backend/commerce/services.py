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
from decimal import Decimal

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
    expires_at = validity_from + package.validity_delta()

    # Drop-in: i soldi sono stati presi per QUELLA lezione (validata al
    # checkout) — se cade oltre la validità standard del pacchetto (es. lezione
    # fra 60 giorni, validità 30), la finestra si estende fino a coprirla,
    # altrimenti book_lesson la rifiuterebbe con no_valid_access.
    lesson_for_expiry = meta.get("lesson_id")
    if lesson_for_expiry:
        from catalog.models import Lesson

        _lesson = Lesson.objects.filter(pk=lesson_for_expiry).first()
        if _lesson is not None:
            lesson_day_end = timezone.make_aware(datetime.combine(_lesson.date, datetime.max.time()))
            expires_at = max(expires_at, lesson_day_end)

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

        student_package = StudentPackage.objects.create(
            student=student, school=school, package=package,
            credits_total=package.credits, credits_remaining=package.credits,
            starts_at=starts_at,
            expires_at=expires_at,
            payment_method="stripe", stripe_payment_id=payment_id, status="active",
        )
        mark_redeemed(meta.get("discount_code_id"))
        notify_after_purchase(student_package, amount)

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


def activate_shop_order_payment(*, payment_id: str, amount_cents: int, metadata: dict) -> str:
    """Fulfils a paid ShopOrder — the shop's mirror of activate_package_payment.

    Same two arrival paths (webhook `payment_intent.succeeded` and the
    `verify-session` fallback), same at-least-once-delivery hazard. Packages
    dedupe on `Transaction.stripe_payment_id`'s partial unique index; a shop
    order doesn't always get a Transaction row (a platform-wide/HQ product has
    no school to attribute one to — see below), so the primary idempotency
    guard here is a `select_for_update` lock on the ShopOrder row itself plus
    its own status: once flipped away from "pending" a retry is a no-op. When
    the order *does* have a school, the same Transaction uniqueness packages
    rely on backstops it too.
    """
    meta = metadata or {}
    if meta.get("kind") != "shop_order":
        return "not_a_shop_order_payment"
    if not payment_id:
        return "no_payment_id"

    from .models import ShopOrder, Transaction

    order_id = meta.get("order_id")
    if not order_id:
        return "missing_refs"

    with transaction.atomic():
        # No select_related here: school/student/referral_school are all
        # nullable FKs, and Postgres refuses SELECT ... FOR UPDATE across an
        # outer join ("FOR UPDATE cannot be applied to the nullable side of
        # an outer join") — lock the bare row, then touch the FKs (lazy
        # follow-up queries, but this only runs once per payment).
        order = ShopOrder.objects.select_for_update().filter(pk=order_id).first()
        if order is None:
            return "missing_refs"
        if order.status != "pending":
            # Already fulfilled — by the other activation path racing us, or
            # by a Stripe retry of the same event.
            return "already_processed"

        school = order.school
        if school is not None:
            amount = Decimal(order.total)
            fee = (amount * school.platform_fee_percentage / Decimal("100")).quantize(Decimal("0.01"))
            _tx, created = Transaction.objects.get_or_create(
                stripe_payment_id=payment_id,
                defaults=dict(
                    school=school, student=order.student, type=Transaction.Type.SHOP,
                    product_id=_first_item_product_id(order), product_name=_order_product_name(order),
                    amount=amount, currency="eur",
                    platform_fee=fee, school_amount=amount - fee,
                    payment_method="stripe", status="completed",
                    referral_school=order.referral_school,
                    referral_commission=order.referral_discount or None,
                ),
            )
            if not created:
                # A second delivery of the very same Stripe payment, arriving
                # for a still-"pending" order only because it raced the other
                # path between the lock above and here — not a fresh sale.
                return "already_processed"

        _create_shop_sales(order)

        order.status = ShopOrder.Status.PAID
        order.stripe_payment_id = payment_id
        order.save(update_fields=["status", "stripe_payment_id"])
        # R2-M14b: la pagina di rientro promette da sempre una email di
        # conferma ordine. Ora esiste; parte su on_commit (mai dentro
        # l'atomic: un rollback manderebbe una ricevuta fantasma).
        notify_shop_order(order)

    return "shop_order_activated"


def fail_shop_order(*, order_id=None, payment_id: str = "", status: str = "failed") -> str:
    """Porta un ordine ancora `pending` in uno stato terminale (R2-M14c).

    Un pagamento rifiutato o una sessione di Checkout abbandonata non
    producevano NESSUN evento lato nostro: l'ordine restava "In attesa" per
    sempre nella pagina "I miei acquisti" dell'allieva (ST-R2-18). Lo
    chiamano i webhook `checkout.session.expired`,
    `payment_intent.payment_failed` e `checkout.session.async_payment_failed`,
    piu' la scopa periodica `expire_stale_shop_orders_task`.

    Solo `pending` -> terminale: un ordine gia' pagato non si tocca mai
    (Stripe consegna at-least-once e gli eventi possono arrivare fuori
    ordine), e un ordine gia' terminale e' un no-op idempotente.
    """
    from .models import ShopOrder

    if status not in ShopOrder.TERMINAL_STATUSES:
        return "invalid_status"

    with transaction.atomic():
        qs = ShopOrder.objects.select_for_update()
        if order_id:
            order = qs.filter(pk=order_id).first()
        elif payment_id:
            # `stripe_payment_id` porta l'id della sessione di Checkout finche'
            # l'ordine non viene pagato (poi diventa il PaymentIntent), quindi
            # sia session.id sia pi.id ci arrivano qui.
            order = qs.filter(stripe_payment_id=payment_id).first()
        else:
            return "missing_refs"
        if order is None:
            return "missing_refs"
        if order.status == ShopOrder.Status.PAID:
            return "already_paid"
        if order.status != ShopOrder.Status.PENDING:
            return "already_processed"
        order.status = status
        order.save(update_fields=["status"])
    return f"shop_order_{status}"


def notify_shop_order(order) -> None:
    """HQ > Emails "student.shop_order_confirmed" — la ricevuta dell'ordine,
    accodata su commit come ogni altra email (CLAUDE.md §4.7)."""
    from bookings.services import student_email_link
    from notifications.tasks import send_transactional_email_task

    student = order.student
    if student is None or student.user_id is None or not student.user.email:
        return
    locale = student.language_preference or "en"
    items = ", ".join(
        f"{int(it.get('qty') or 1)}× {it.get('name') or ''}".strip()
        + _variant_suffix(it)
        for it in (order.items or [])
    )
    context = {
        "student_name": student.name,
        "student_first_name": student.first_name or student.name.split(" ")[0],
        "school_name": order.school.name if order.school_id else "No Under 40",
        # Numero d'ordine leggibile: le prime 8 cifre dell'UUID, le stesse
        # che il report QA usa per citare un ordine.
        "order_number": str(order.id)[:8],
        "order_date": timezone.localtime(order.created_at).strftime("%d-%m-%Y"),
        "order_items": items,
        "order_subtotal": _money(order.subtotal),
        "order_discount": _money(order.discount_amount),
        "order_shipping": _money(order.shipping),
        "order_total": _money(order.total),
        "orders_url": student_email_link(
            f"{settings.FRONTEND_URL}/{locale}/student/shop", student.user.email
        ),
    }
    to_email, to_name = student.user.email, student.name
    school_id = str(order.school_id) if order.school_id else None
    transaction.on_commit(lambda: send_transactional_email_task.delay(
        to_email=to_email, to_name=to_name, key="student.shop_order_confirmed",
        context=context, locale=locale, school_id=school_id,
    ))


def _variant_suffix(item) -> str:
    bits = [b for b in (item.get("size"), item.get("color")) if b]
    return f" ({' / '.join(bits)})" if bits else ""


def _money(value) -> str:
    return f"€{Decimal(value or 0):.2f}"


def _first_item_product_id(order):
    items = order.items or []
    if len(items) != 1:
        # Transaction.product_id is a single FK-shaped field; a multi-line
        # cart has no single product to point it at, so leave it unset rather
        # than picking one line arbitrarily.
        return None
    try:
        import uuid

        return uuid.UUID(str(items[0].get("product_id")))
    except (ValueError, TypeError, AttributeError):
        return None


def _order_product_name(order) -> str:
    names = [it.get("name") for it in (order.items or []) if it.get("name")]
    return ", ".join(names)[:255]


def _create_shop_sales(order) -> None:
    """One ShopSale row per cart line, mirroring the proportional-discount
    split HQShopSalesView already uses for manual sales (shop_admin_views.py)
    so online orders show up in the same ledger/reports the same way manual
    ones do — the last line absorbs any rounding remainder."""
    from .models import ShopProduct, ShopProductVariant, ShopSale

    items = order.items or []
    lines = []
    subtotal = Decimal("0")
    for it in items:
        product = ShopProduct.objects.filter(pk=it.get("product_id")).first()
        if product is None:
            continue
        qty = int(it.get("qty") or 1)
        unit_price = Decimal(str(it.get("price") or "0"))
        gross = (unit_price * qty).quantize(Decimal("0.01"))
        size, color = it.get("size") or "", it.get("color") or ""
        variant = ShopProductVariant.objects.filter(product=product, size=size, color=color).first()
        lines.append(dict(product=product, variant=variant, qty=qty, unit_price=unit_price,
                           gross=gross, size=size, color=color))
        subtotal += gross
    if not lines:
        return

    discount_total = order.discount_amount or Decimal("0")
    referral_total = order.referral_discount or Decimal("0")
    referral_school = order.referral_school
    referral_pct = (
        (referral_total / subtotal * 100).quantize(Decimal("0.01"))
        if referral_school and subtotal > 0 else Decimal("0")
    )
    commission_pct = order.school.shop_commission_percentage if order.school else Decimal("0")

    discount_left, referral_left = discount_total, referral_total
    sale_rows = []
    for i, line in enumerate(lines):
        is_last = i == len(lines) - 1
        share_ratio = (line["gross"] / subtotal) if subtotal > 0 else Decimal("0")
        discount_share = discount_left if is_last else (discount_total * share_ratio).quantize(Decimal("0.01"))
        referral_share = referral_left if is_last else (referral_total * share_ratio).quantize(Decimal("0.01"))
        discount_left -= discount_share
        referral_left -= referral_share
        net = line["gross"] - discount_share
        sale_rows.append(ShopSale(
            order_id=order.id, product=line["product"], variant=line["variant"],
            student=order.student, school=order.school,
            qty=line["qty"], unit_price=line["unit_price"], total=net,
            discount=discount_share,
            commission=(net * commission_pct / Decimal("100")).quantize(Decimal("0.01")) if commission_pct else Decimal("0"),
            referrer=referral_school.name if referral_school else "",
            referrer_percentage=referral_pct, referrer_commission=referral_share,
            size=line["size"], color=line["color"],
            shipping=order.shipping if i == 0 else Decimal("0"),
            payment_method="stripe", source=ShopSale.Source.ONLINE,
        ))
    ShopSale.objects.bulk_create(sale_rows)


def notify_after_purchase(student_package, amount) -> None:
    """HQ > Emails "after_purchase" (student.after_purchase) — queued on commit,
    so a rolled-back activation never emails a receipt."""
    from bookings.services import package_email_context, school_calendar_url, student_email_link
    from notifications.tasks import send_transactional_email_task

    student, school = student_package.student, student_package.school
    locale = student.language_preference or "en"
    context = {
        "student_name": student.name,
        "student_first_name": student.first_name or student.name.split(" ")[0],
        "school_name": school.name,
        **package_email_context(student_package, locale),
        "amount": f"€{float(amount):.2f}" if amount is not None else "",
        "booking_url": student_email_link(f"{settings.FRONTEND_URL}/{locale}/student/book", student.user.email),
        "school_calendar_url": student_email_link(school_calendar_url(school.id, locale), student.user.email),
    }
    transaction.on_commit(lambda: send_transactional_email_task.delay(
        to_email=student.user.email, to_name=student.name, key="after_purchase",
        context=context, locale=locale, school_id=str(school.id),
    ))


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
                "lesson_date": lesson.date.strftime("%d-%m-%Y"), "lesson_time": lesson.start_time.strftime("%H:%M"),
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
