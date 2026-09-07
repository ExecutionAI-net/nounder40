"""Stripe webhook event handlers — spec 13.3's event table. Each handler is
pure (event dict in, result string out) so they're trivial to test with a
locally-crafted signed payload, no live Stripe dashboard/CLI needed."""

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

    period_end = datetime.fromtimestamp(sub["current_period_end"], tz=dt_timezone.utc)
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

    period_end = datetime.fromtimestamp(sub["current_period_end"], tz=dt_timezone.utc)
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
                product_id=package.id, product_name=package.name_en or package.name_it,
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
        new_period_end = datetime.fromtimestamp(sub["current_period_end"], tz=dt_timezone.utc)
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
        new_period_end = datetime.fromtimestamp(sub["current_period_end"], tz=dt_timezone.utc)
        renewed = bool(sp.next_renewal_at and new_period_end > sp.next_renewal_at)
        if renewed and sp.starts_at and sp.package_id:
            # Buy-ahead subscription: the credit window is shifted from the
            # Stripe billing cycle — each renewal rolls it forward by one
            # interval instead of snapping to Stripe's period end.
            sp.expires_at = sp.expires_at + _INTERVAL_DELTA.get(
                sp.package.recurring_interval, relativedelta(months=1)
            )
        else:
            sp.expires_at = new_period_end
        sp.next_renewal_at = new_period_end
        if renewed and sp.package_id:
            sp.credits_remaining = sp.package.credits
            sp.credits_total = sp.package.credits
        sp.save(update_fields=["expires_at", "next_renewal_at", "credits_remaining", "credits_total"])
        if renewed and sp.package_id:
            # QA R2-H11: a genuine renewal (real Stripe billing cycle, not a
            # replay of the initial activation — see _handle_recurring_
            # package_created above) also needs its own Transaction, or the
            # school's Payments/Reports keep missing every renewal payment
            # after the first one. Idempotency key includes the period end so
            # each billing cycle gets exactly one row even if this event is
            # itself retried by Stripe.
            from commerce.models import Transaction

            amount = sp.package.price
            fee = (amount * sp.school.platform_fee_percentage / Decimal("100")).quantize(Decimal("0.01"))
            Transaction.objects.get_or_create(
                stripe_payment_id=f"{sub['id']}:renewal:{int(new_period_end.timestamp())}",
                defaults=dict(
                    school=sp.school, student=sp.student, type=Transaction.Type.SUBSCRIPTION,
                    product_id=sp.package_id, product_name=sp.package.name_en or sp.package.name_it,
                    amount=amount, currency="eur",
                    platform_fee=fee, school_amount=amount - fee,
                    payment_method="stripe", status="completed",
                ),
            )
        return "package_renewed" if renewed else "package_updated"

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

    sub_id = invoice.get("subscription")
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
        grace_until = (sp.next_renewal_at or now) + timedelta(days=sp.school.grace_period_days)
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

    sub_id = invoice.get("subscription")
    if not sub_id:
        return "no_subscription"
    ss = StudentSubscription.objects.filter(stripe_subscription_id=sub_id).first()
    if ss is None:
        return "not_found"
    if ss.status == "grace_period":
        ss.status = "active"
        ss.grace_period_ends_at = None
        ss.save(update_fields=["status", "grace_period_ends_at"])
        return "grace_period_resolved"
    return "no_change"


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
    "charge.refunded": _handle_charge_refunded,
    "account.updated": _handle_account_updated,
}
