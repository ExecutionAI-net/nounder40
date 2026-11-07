"""Stripe webhook event handlers — spec 13.3's event table. Each handler is
pure (event dict in, result string out) so they're trivial to test with a
locally-crafted signed payload, no live Stripe dashboard/CLI needed."""

import logging
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal

from dateutil.relativedelta import relativedelta
from django.db import transaction
from django.utils import timezone

from .discounts import mark_redeemed

# One billing period per recurring_interval value — used to estimate the first
# period's end for a buy-ahead (trialing) purchase; the first real invoice's
# subscription.updated event overwrites it with Stripe's authoritative value.
_INTERVAL_DELTA = {
    "week": relativedelta(weeks=1),
    "month": relativedelta(months=1),
    "3month": relativedelta(months=3),
    "6month": relativedelta(months=6),
    "year": relativedelta(years=1),
}


logger = logging.getLogger(__name__)


def _as_dict(obj) -> dict:
    """Stripe event payload → plain dict. In stripe==15.4.0 StripeObject is no
    longer a Mapping (no .get()/.keys()): a *real* webhook delivery hands every
    handler below a StripeObject, not the plain dict our unit tests pass, so
    every `.get(...)` call in this module (there are several) would raise
    AttributeError exactly like the identical bug fixed in
    stripe_views.py::VerifySessionView._activate — plausibly why webhook
    delivery "doesn't seem to work" on this environment even if Stripe is
    calling it correctly. Converting once, here, keeps every handler's
    dict-style access safe without touching each one; `to_dict()` recurses,
    so nested objects (e.g. `items.data`) come back as plain dicts too."""
    if not obj:
        return {}
    if hasattr(obj, "to_dict"):
        return dict(obj.to_dict())
    return dict(obj)


def _period_end(sub) -> datetime:
    """`current_period_end` of a subscription payload. Stripe's API version
    2025-03-31 moved it off the Subscription onto each item: read either,
    like VerifySessionView already does for the account's own payloads."""
    value = sub.get("current_period_end")
    if not value:
        items = (sub.get("items") or {}).get("data") or []
        value = items[0].get("current_period_end") if items else None
    if not value:
        raise KeyError("current_period_end")
    return datetime.fromtimestamp(value, tz=dt_timezone.utc)


def _invoice_subscription_id(invoice) -> str | None:
    """The subscription an invoice bills. Stripe's API version 2025-03-31
    moved it from `invoice.subscription` to
    `invoice.parent.subscription_details.subscription`: read either."""
    sub = invoice.get("subscription")
    if isinstance(sub, dict):
        sub = sub.get("id")
    if not sub:
        details = (invoice.get("parent") or {}).get("subscription_details") or {}
        sub = details.get("subscription")
        if isinstance(sub, dict):
            sub = sub.get("id")
    return sub or None


def _invoice_line_period_ends(invoice) -> list[datetime]:
    """The period end of every invoice line (a cycle invoice may also carry
    a proration line), latest first."""
    ends = []
    for line in ((invoice.get("lines") or {}).get("data") or []):
        end = (line.get("period") or {}).get("end")
        if end:
            ends.append(datetime.fromtimestamp(end, tz=dt_timezone.utc))
    return sorted(ends, reverse=True)


def _invoice_period_start(invoice) -> datetime | None:
    """The start of the billing period an invoice is for: the cycle
    boundary, stable across every retry of the same invoice."""
    starts = [
        (line.get("period") or {}).get("start")
        for line in ((invoice.get("lines") or {}).get("data") or [])
    ]
    starts = [v for v in starts if v]
    return datetime.fromtimestamp(min(starts), tz=dt_timezone.utc) if starts else None


def _invoice_payment_intent(invoice) -> str | None:
    """The PaymentIntent that paid an invoice (none on a zero-amount one)."""
    pi = invoice.get("payment_intent")
    if isinstance(pi, dict):
        pi = pi.get("id")
    return pi or None


def handle_event(event: dict) -> str:
    etype = event["type"]
    obj = _as_dict(event["data"]["object"])
    handler = _HANDLERS.get(etype)
    return handler(obj) if handler else "ignored"


def _handle_payment_intent_succeeded(pi) -> str:
    # Accredito e prenotazione vivono in commerce/services.py: la stessa
    # attivazione arriva anche da verify-session quando il browser rientra
    # prima della consegna di Stripe, e deve comportarsi identica.
    from commerce.services import activate_package_payment, activate_shop_order_payment

    meta = pi.get("metadata") or {}
    activator = activate_shop_order_payment if meta.get("kind") == "shop_order" else activate_package_payment
    return activator(payment_id=pi["id"], amount_cents=pi["amount"], metadata=meta)


def _handle_payment_intent_failed(pi) -> str:
    """R2-M14c: una carta rifiutata non produceva alcun evento lato nostro e
    l'ordine restava `pending` per sempre (ST-R2-18). Solo lo shop: un
    pacchetto non pagato non crea nulla da chiudere, il suo StudentPackage
    nasce solo all'accredito."""
    from commerce.services import fail_shop_order

    meta = pi.get("metadata") or {}
    if meta.get("kind") != "shop_order":
        return "not_a_shop_order_payment"
    return fail_shop_order(order_id=meta.get("order_id"), payment_id=pi.get("id") or "", status="failed")


def _session_terminal(session, status: str) -> str:
    """Chiude l'ordine legato a una sessione di Checkout.

    `ShopOrder.stripe_payment_id` porta l'id della sessione fino al pagamento
    (poi diventa il PaymentIntent), quindi l'ordine si ritrova anche se i
    metadata non arrivano."""
    from commerce.services import fail_shop_order

    meta = session.get("metadata") or {}
    kind = meta.get("kind")
    if kind and kind != "shop_order":
        return "not_a_shop_order_payment"
    return fail_shop_order(
        order_id=meta.get("order_id"), payment_id=session.get("id") or "", status=status
    )


def _handle_checkout_session_expired(session) -> str:
    """Checkout abbandonato: Stripe fa scadere la sessione (24h di default)
    e manda questo evento."""
    return _session_terminal(session, "expired")


def _handle_checkout_async_payment_failed(session) -> str:
    """Metodo di pagamento asincrono (bonifico SEPA, ...) fallito dopo il
    redirect: l'ordine e' rifiutato, non scaduto."""
    return _session_terminal(session, "failed")


def _handle_subscription_created(sub) -> str:
    meta = sub.get("metadata") or {}
    if meta.get("kind") == "package":
        return _handle_recurring_package_created(sub, meta)
    if meta.get("kind") != "subscription":
        return "not_a_subscription_purchase"

    from catalog.models import SubscriptionCatalog
    from schools.models import School
    from students.models import Student, StudentSubscription

    school = School.objects.filter(pk=meta.get("school_id")).first()
    student = Student.objects.filter(pk=meta.get("student_id")).first()
    catalog = SubscriptionCatalog.objects.filter(pk=meta.get("item_id")).first()
    if not (school and student and catalog):
        return "missing_refs"

    period_end = _period_end(sub)
    StudentSubscription.objects.update_or_create(
        stripe_subscription_id=sub["id"],
        defaults=dict(
            student=student, school=school, subscription_catalog=catalog,
            access_total=catalog.access_count, access_remaining=catalog.access_count,
            started_at=timezone.now(), current_period_end=period_end, status="active",
        ),
    )
    mark_redeemed(meta.get("discount_code_id"))
    return "subscription_activated"


def _handle_recurring_package_created(sub, meta) -> str:
    """A `packages` row with is_recurring=True renews credits on each Stripe
    billing cycle instead of being a one-off payment_intent purchase.

    This handler is reached from TWO places for the SAME initial activation:
    the `customer.subscription.created` webhook, and
    `VerifySessionView._activate()`'s checkout-session fallback (the frontend
    calls verify-session on every load of the packages success URL, which
    stays live in browser history/bookmarks). Stripe also delivers webhooks
    at-least-once. So this must be idempotent for "first activation" — it
    must NOT be re-run as if it were a renewal. Genuine renewals (a real
    Stripe billing cycle rolling over) are handled entirely by
    `_handle_subscription_updated` below (`customer.subscription.updated`,
    "package_renewed"), which tops up credits based on a real period-end
    change — never by this function. So: if a StudentPackage already exists
    for this stripe_subscription_id, this call is a REPLAY of the same
    activation event, not a new purchase and not a renewal — return the
    existing package unchanged (QA R2-C3: a replay was resetting credits to
    full, resetting purchased_at, and re-sending the receipt every time).
    """
    from catalog.models import Package
    from commerce.models import Transaction
    from schools.models import School
    from students.models import Student, StudentPackage

    existing = StudentPackage.objects.filter(stripe_subscription_id=sub["id"]).first()
    if existing is not None:
        return "already_processed"

    school = School.objects.filter(pk=meta.get("school_id")).first()
    student = Student.objects.filter(pk=meta.get("student_id")).first()
    package = Package.objects.filter(pk=meta.get("item_id")).first()
    if not (school and student and package):
        return "missing_refs"

    period_end = _period_end(sub)
    expires_at = period_end
    starts_at = None
    if meta.get("starts_at"):
        # Buy-ahead: paid in full NOW, but the credit window opens when the
        # current package expires and runs one billing interval from there.
        # Stripe keeps billing on the purchase-date cycle (next_renewal_at);
        # each renewal shifts the window by one interval (see updated handler),
        # so every payment lands before the window it covers.
        try:
            starts_at = datetime.fromisoformat(meta["starts_at"])
        except ValueError:
            starts_at = None
        if starts_at is not None:
            expires_at = starts_at + _INTERVAL_DELTA.get(package.recurring_interval, relativedelta(months=1))

    with transaction.atomic():
        # get_or_create rather than create(): two concurrent deliveries of the
        # same first-activation event (webhook racing verify-session) could
        # both pass the `existing is None` check above before either commits.
        # The unique index on stripe_subscription_id (StudentPackage) backstops
        # this the same way Transaction.stripe_payment_id backstops one-time
        # packages in commerce/services.py.
        student_package, created = StudentPackage.objects.get_or_create(
            stripe_subscription_id=sub["id"],
            defaults=dict(
                student=student, school=school, package=package,
                credits_total=package.credits, credits_remaining=package.credits,
                purchased_at=timezone.now(), starts_at=starts_at,
                expires_at=expires_at, next_renewal_at=period_end,
                payment_method="stripe", stripe_customer_id=sub.get("customer") or "", status="active",
            ),
        )
        if not created:
            return "already_processed"

        # QA R2-H11: this path never created a Transaction, so subscription
        # revenue and its platform-fee split were invisible in the school's
        # own Payments/Reports. Mirror the one-time package activation in
        # commerce/services.py::activate_package_payment exactly.
        amount = package.price
        fee = (amount * school.platform_fee_percentage / Decimal("100")).quantize(Decimal("0.01"))
        Transaction.objects.get_or_create(
            stripe_payment_id=sub["id"],
            defaults=dict(
                school=school, student=student, type=Transaction.Type.SUBSCRIPTION,
                product_id=package.id, product_name=package.localized_name(student.language_preference),
                amount=amount, currency="eur",
                platform_fee=fee, school_amount=amount - fee,
                payment_method="stripe", status="completed",
            ),
        )

        mark_redeemed(meta.get("discount_code_id"))
        from .services import notify_after_purchase

        notify_after_purchase(student_package, package.price)

    return "recurring_package_activated"


def _handle_subscription_updated(sub) -> str:
    from students.models import StudentPackage, StudentSubscription

    ss = StudentSubscription.objects.filter(stripe_subscription_id=sub["id"]).first()
    if ss is not None:
        new_period_end = _period_end(sub)
        renewed = bool(ss.current_period_end and new_period_end > ss.current_period_end)
        ss.current_period_end = new_period_end
        if renewed and ss.access_total is not None:
            ss.access_remaining = ss.access_total
        if sub["status"] == "active" and ss.status == "grace_period":
            ss.status = "active"
            ss.grace_period_ends_at = None
        ss.save(update_fields=["current_period_end", "access_remaining", "status", "grace_period_ends_at"])
        return "subscription_renewed" if renewed else "subscription_updated"

    sp = StudentPackage.objects.filter(stripe_subscription_id=sub["id"]).first()
    if sp is not None:
        # Dates only. Stripe advances the period at the cycle boundary with
        # the subscription still `active` and the invoice not yet paid, so
        # credits, status and the Transaction are NOT granted here: they
        # come with the paid invoice (`invoice.paid` /
        # `invoice.payment_succeeded`, _handle_recurring_package_invoice_paid
        # below). Until 2026-11-07 this event refilled the wallet, and a
        # declined card left a full, unpaid cycle bookable (Carlo).
        if sp.next_renewal_at is None:
            # `customer.subscription.deleted` already closed it (cancelled_at
            # set, no further renewals): a stale or out-of-order `updated`
            # must not write a renewal date and a window back onto it
            return "package_cancelled"
        if sub.get("status") not in ("active", "trialing"):
            # `past_due` / `unpaid`: the grace window `invoice.payment_failed`
            # just granted must survive the status update Stripe sends right
            # after it; the paid invoice will set the dates straight
            return "package_update_unpaid"
        # Only the renewal date. The window (expires_at) moves with the paid
        # invoice: moved here, a cycle not yet paid would already be open
        # to the lessons left over from the last one.
        StudentPackage.objects.filter(pk=sp.pk).update(next_renewal_at=_period_end(sub))
        return "package_dates_synced"

    return "not_found"


def _handle_subscription_deleted(sub) -> str:
    from students.models import StudentPackage, StudentSubscription

    updated = StudentSubscription.objects.filter(stripe_subscription_id=sub["id"]).update(status="cancelled")
    if updated:
        return "subscription_cancelled"
    sp = StudentPackage.objects.filter(stripe_subscription_id=sub["id"]).first()
    if sp is None:
        return "not_found"
    now = timezone.now()
    sp.cancelled_at = now
    sp.next_renewal_at = None  # no further renewals
    # A buy-ahead window can outlive the Stripe billing period (paid through
    # the 14th, billed on the 2nd): already-paid credits stay usable until the
    # window's own end — only an already-elapsed window expires immediately.
    if not sp.expires_at or sp.expires_at <= now:
        sp.status = "expired"
    sp.save(update_fields=["cancelled_at", "next_renewal_at", "status"])
    return "package_subscription_cancelled"


def _handle_invoice_payment_failed(invoice) -> str:
    from students.models import StudentPackage, StudentSubscription

    sub_id = _invoice_subscription_id(invoice)
    if not sub_id:
        return "no_subscription"
    ss = StudentSubscription.objects.filter(stripe_subscription_id=sub_id).select_related("school").first()
    if ss is None:
        # Recurring package (the live engine): keep the credits usable for
        # the school's grace period while Stripe retries the charge. Repeated
        # failures do not stack — the window ends at renewal + grace at most;
        # subscription.deleted (Stripe giving up) still closes it.
        sp = StudentPackage.objects.filter(stripe_subscription_id=sub_id).select_related("school").first()
        if sp is None:
            return "not_found"
        now = timezone.now()
        # From the cycle boundary the unpaid invoice is for (its period
        # start: the same on every retry of that invoice, so repeated
        # failures do not stack), not from next_renewal_at, which the
        # boundary `updated` has already moved to the end of the unpaid
        # cycle. A payload without lines falls back to it as before.
        boundary = _invoice_period_start(invoice) or sp.next_renewal_at or now
        grace_until = boundary + timedelta(days=sp.school.grace_period_days)
        if sp.expires_at is None or sp.expires_at < grace_until:
            sp.expires_at = grace_until
            sp.save(update_fields=["expires_at"])
            return "grace_period_started"
        return "grace_period_already_granted"
    ss.status = "grace_period"
    ss.grace_period_ends_at = timezone.now() + timedelta(days=ss.school.grace_period_days)
    ss.save(update_fields=["status", "grace_period_ends_at"])
    return "grace_period_started"


def _handle_invoice_payment_succeeded(invoice) -> str:
    from students.models import StudentSubscription

    sub_id = _invoice_subscription_id(invoice)
    if not sub_id:
        return "no_subscription"
    ss = StudentSubscription.objects.filter(stripe_subscription_id=sub_id).first()
    if ss is None:
        return _handle_recurring_package_invoice_paid(invoice, sub_id)
    if ss.status == "grace_period":
        ss.status = "active"
        ss.grace_period_ends_at = None
        ss.save(update_fields=["status", "grace_period_ends_at"])
        return "grace_period_resolved"
    return "no_change"


def _handle_recurring_package_invoice_paid(invoice, sub_id: str) -> str:
    """A paid renewal invoice of a recurring package (the live engine): the
    credits of the new cycle, the window, the `exhausted` → `active` flip
    and the Transaction, all at once and only now that the money is in.

    The first invoice (`billing_reason` subscription_create) is the
    activation, handled by `customer.subscription.created` / verify-session
    with its own Transaction keyed on the subscription id. Only a
    `subscription_cycle` invoice is a renewal.

    Idempotent on the invoice's PaymentIntent (the invoice id when there is
    none): Stripe delivers at least once, and both `invoice.paid` and
    `invoice.payment_succeeded` reach this handler. The Transaction row is
    the gate — created inside the same transaction as
    the refill, so a retry finds it and leaves a wallet already in use
    alone. A cycle credited by the pre-2026-11-07 `updated` handler (its
    Transaction keyed on the period end) is recognised and not credited
    twice.
    """
    from commerce.models import Transaction
    from students.models import StudentPackage

    sp = (
        StudentPackage.objects.filter(stripe_subscription_id=sub_id)
        .select_related("package", "school", "student")
        .first()
    )
    if sp is None:
        return "not_found"
    if invoice.get("billing_reason") != "subscription_cycle":
        return "not_a_renewal_invoice"
    period_ends = _invoice_line_period_ends(invoice)
    period_end = period_ends[0] if period_ends else None
    interval = _INTERVAL_DELTA.get(sp.package.recurring_interval if sp.package_id else None, relativedelta(months=1))
    # The catalog row may be gone (SET_NULL): the package's own total still
    # says what a cycle holds.
    credits = sp.package.credits if sp.package_id else sp.credits_total
    # What was charged, from the invoice: the subscription keeps billing its
    # own price when the catalog price changes or a code was applied. The
    # catalog price only stands in for a payload without the amount.
    amount_paid = invoice.get("amount_paid")
    amount = (Decimal(amount_paid) / Decimal("100")) if amount_paid is not None else (sp.package.price if sp.package_id else Decimal("0"))
    currency = (invoice.get("currency") or "eur").lower()
    fee = (amount * sp.school.platform_fee_percentage / Decimal("100")).quantize(Decimal("0.01"))
    product_name = sp.package.localized_name(sp.student.language_preference) if sp.package_id else ""
    # Keyed on the PaymentIntent like a one-time purchase, so the school's
    # refund button (stripe.Refund.create(payment_intent=…)) and
    # `charge.refunded` find the row; the invoice id only for a zero-amount
    # invoice, which has no PaymentIntent.
    key = _invoice_payment_intent(invoice) or invoice["id"]
    with transaction.atomic():
        legacy_keys = [f"{sub_id}:renewal:{int(end.timestamp())}" for end in period_ends]
        if legacy_keys and Transaction.objects.filter(stripe_payment_id__in=legacy_keys).exists():
            return "already_processed"
        _tx, created = Transaction.objects.get_or_create(
            stripe_payment_id=key,
            defaults=dict(
                school=sp.school, student=sp.student, type=Transaction.Type.SUBSCRIPTION,
                product_id=sp.package_id, product_name=product_name,
                amount=amount, currency=currency,
                platform_fee=fee, school_amount=amount - fee,
                payment_method="stripe", status="completed",
            ),
        )
        if not created:
            return "already_processed"
        fields = {"credits_remaining": credits, "credits_total": credits, "credits_low_sent_at": None}
        if period_end:
            fields["next_renewal_at"] = period_end
        if sp.starts_at and sp.expires_at:
            # Buy-ahead subscription: the credit window is shifted from the
            # Stripe billing cycle — each renewal rolls it forward by one
            # interval instead of snapping to Stripe's period end.
            fields["expires_at"] = sp.expires_at + interval
        else:
            # Stripe's period end; a payload without lines falls back to the
            # renewal date the boundary `updated` synced, then to one
            # interval from the old end — the paid window must open
            fields["expires_at"] = period_end or sp.next_renewal_at or ((sp.expires_at or timezone.now()) + interval)
        # Filtered UPDATEs, not save(): the row read above may have been
        # drained by a booking meanwhile.
        StudentPackage.objects.filter(pk=sp.pk).update(**fields)
        # A row drained to `exhausted` during the last cycle comes back to
        # `active`, or the roster, the balance and the booking engine all
        # keep ignoring a package just paid for (Roberta, 2026-11-04: 59 EUR,
        # 5 lessons, none bookable). `deleted` and `expired` are decisions,
        # not balances: left as they are — but a deleted row still billed is
        # worth a line in the log, since nothing on our side stops Stripe.
        StudentPackage.reactivate_if_refilled(pk=sp.pk)
        if sp.status in (StudentPackage.Status.DELETED, StudentPackage.Status.EXPIRED):
            # deleted: the school took it away and Stripe still bills.
            # expired: Stripe had cancelled it and an open invoice got paid
            # afterwards. Neither comes back by itself: the money is
            # recorded, the credits sit in the row, a person decides.
            logger.warning(
                "recurring package %s (%s) paid a cycle while %s: credits recorded, status left alone",
                sp.pk, sub_id, sp.status,
            )
        if not sp.package_id:
            logger.warning("recurring package %s renewed without its catalog package", sp.pk)
    return "package_renewed"


def _handle_charge_refunded(charge) -> str:
    from commerce.models import Transaction

    pi = charge.get("payment_intent")
    if not pi:
        return "no_payment_intent"
    updated = Transaction.objects.filter(stripe_payment_id=pi).update(status="refunded")
    return "refunded" if updated else "not_found"


def _handle_account_updated(account) -> str:
    from schools.models import School

    school = School.objects.filter(stripe_account_id=account["id"]).first()
    if school is None:
        return "not_found"
    from .stripe_service import set_onboarding_complete

    complete = bool(account.get("charges_enabled") and account.get("details_submitted"))
    set_onboarding_complete(school, complete)
    return "account_synced"


_HANDLERS = {
    "payment_intent.succeeded": _handle_payment_intent_succeeded,
    "payment_intent.payment_failed": _handle_payment_intent_failed,
    "checkout.session.expired": _handle_checkout_session_expired,
    "checkout.session.async_payment_failed": _handle_checkout_async_payment_failed,
    "customer.subscription.created": _handle_subscription_created,
    "customer.subscription.updated": _handle_subscription_updated,
    "customer.subscription.deleted": _handle_subscription_deleted,
    "invoice.payment_failed": _handle_invoice_payment_failed,
    "invoice.payment_succeeded": _handle_invoice_payment_succeeded,
    "invoice.paid": _handle_invoice_payment_succeeded,
    "charge.refunded": _handle_charge_refunded,
    "account.updated": _handle_account_updated,
}
