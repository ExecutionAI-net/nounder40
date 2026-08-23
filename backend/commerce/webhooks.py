"""Stripe webhook event handlers — spec 13.3's event table. Each handler is
pure (event dict in, result string out) so they're trivial to test with a
locally-crafted signed payload, no live Stripe dashboard/CLI needed."""

from datetime import datetime, timedelta, timezone as dt_timezone

from dateutil.relativedelta import relativedelta
from django.utils import timezone

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


def handle_event(event: dict) -> str:
    etype = event["type"]
    obj = event["data"]["object"]
    handler = _HANDLERS.get(etype)
    return handler(obj) if handler else "ignored"


def _handle_payment_intent_succeeded(pi) -> str:
    from catalog.models import Package
    from commerce.models import Transaction
    from schools.models import School
    from students.models import Student, StudentPackage

    meta = pi.get("metadata") or {}
    if meta.get("kind") != "package":
        return "not_a_package_payment"

    school = School.objects.filter(pk=meta.get("school_id")).first()
    student = Student.objects.filter(pk=meta.get("student_id")).first()
    package = Package.objects.filter(pk=meta.get("item_id")).first()
    if not (school and student and package):
        return "missing_refs"

    amount = pi["amount"] / 100
    fee = amount * float(school.platform_fee_percentage) / 100

    Transaction.objects.create(
        school=school, student=student, type="package", product_id=package.id,
        product_name=package.name_en or package.name_it, amount=amount, currency="eur",
        platform_fee=fee, school_amount=amount - fee, payment_method="stripe",
        stripe_payment_id=pi["id"], status="completed",
    )
    starts_at = None
    if meta.get("starts_at"):
        try:
            starts_at = datetime.fromisoformat(meta["starts_at"])
        except ValueError:
            starts_at = None
    validity_from = starts_at or timezone.now()
    StudentPackage.objects.create(
        student=student, school=school, package=package,
        credits_total=package.credits, credits_remaining=package.credits,
        starts_at=starts_at,
        expires_at=validity_from + package.validity_delta(),
        payment_method="stripe", stripe_payment_id=pi["id"], status="active",
    )
    return "package_activated"


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
    return "subscription_activated"


def _handle_recurring_package_created(sub, meta) -> str:
    """A `packages` row with is_recurring=True renews credits on each Stripe
    billing cycle instead of being a one-off payment_intent purchase."""
    from catalog.models import Package
    from schools.models import School
    from students.models import Student, StudentPackage

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
    StudentPackage.objects.update_or_create(
        stripe_subscription_id=sub["id"],
        defaults=dict(
            student=student, school=school, package=package,
            credits_total=package.credits, credits_remaining=package.credits,
            purchased_at=timezone.now(), starts_at=starts_at,
            expires_at=expires_at, next_renewal_at=period_end,
            payment_method="stripe", stripe_customer_id=sub.get("customer") or "", status="active",
        ),
    )
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
        return "package_renewed" if renewed else "package_updated"

    return "not_found"


def _handle_subscription_deleted(sub) -> str:
    from students.models import StudentPackage, StudentSubscription

    updated = StudentSubscription.objects.filter(stripe_subscription_id=sub["id"]).update(status="cancelled")
    if updated:
        return "subscription_cancelled"
    updated = StudentPackage.objects.filter(stripe_subscription_id=sub["id"]).update(
        status="expired", cancelled_at=timezone.now()
    )
    return "package_subscription_cancelled" if updated else "not_found"


def _handle_invoice_payment_failed(invoice) -> str:
    from students.models import StudentSubscription

    sub_id = invoice.get("subscription")
    if not sub_id:
        return "no_subscription"
    ss = StudentSubscription.objects.filter(stripe_subscription_id=sub_id).select_related("school").first()
    if ss is None:
        return "not_found"
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
    complete = bool(account.get("charges_enabled") and account.get("details_submitted"))
    if complete != school.stripe_onboarding_complete:
        school.stripe_onboarding_complete = complete
        school.save(update_fields=["stripe_onboarding_complete"])
    return "account_synced"


_HANDLERS = {
    "payment_intent.succeeded": _handle_payment_intent_succeeded,
    "customer.subscription.created": _handle_subscription_created,
    "customer.subscription.updated": _handle_subscription_updated,
    "customer.subscription.deleted": _handle_subscription_deleted,
    "invoice.payment_failed": _handle_invoice_payment_failed,
    "invoice.payment_succeeded": _handle_invoice_payment_succeeded,
    "charge.refunded": _handle_charge_refunded,
    "account.updated": _handle_account_updated,
}
