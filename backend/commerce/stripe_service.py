"""Stripe Connect (Express) — checkout, webhooks, onboarding, refunds.

Platform fee split (spec 13.1-13.2): when the school has completed Connect
onboarding, checkout sessions use `application_fee_amount` +
`transfer_data.destination` so Stripe splits the payment automatically.
Schools that haven't connected Stripe cannot sell (spec 5): checkout refuses
with `school_not_connected` rather than silently taking a platform-only payment.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import stripe
from django.conf import settings
from django.utils import timezone

from geography.services import country_code_for

stripe.api_key = settings.STRIPE_SECRET_KEY


class CheckoutError(Exception):
    pass


def _platform_fee_cents(amount_cents: int, fee_percentage: Decimal) -> int:
    return int(round(amount_cents * float(fee_percentage) / 100))


def _stripe_interval(recurring_interval: str) -> tuple[str, int]:
    return {
        "week": ("week", 1),
        "month": ("month", 1),
        "3month": ("month", 3),
        "6month": ("month", 6),
        "year": ("year", 1),
    }.get(recurring_interval, ("month", 1))


def create_checkout_session(*, kind: str, item, school, student, success_url: str, cancel_url: str, discount_code=None, discount_amount=None, start_at=None, lesson=None):
    """kind: 'package' | 'subscription'. `item` is a catalog.Package or
    catalog.SubscriptionCatalog row (already validated as belonging to `school`).

    `start_at` (optional datetime): buy-ahead — the student PAYS NOW but the
    package's validity starts then instead of now (spec 9.5 overlap rule: the
    next period starts when the current one expires, no days lost). Passed
    through metadata; the webhook handlers shift the credit window. For a
    recurring package Stripe keeps billing on the purchase-date cycle while
    our credit windows stay shifted — each payment lands before the window
    it covers, exactly like the first one."""
    if not school.stripe_onboarding_complete or not school.stripe_account_id:
        raise CheckoutError("school_not_connected")

    # Lo sconto arriva già calcolato da commerce/discounts.py: un solo motore,
    # così l'importo verificato prima di pagare è esattamente quello addebitato.
    price = max(Decimal(item.price) - Decimal(discount_amount or 0), Decimal("0"))

    amount_cents = int(price * 100)
    name = item.name_en or item.name_it or "Purchase"
    metadata = {
        "kind": kind, "item_id": str(item.id), "school_id": str(school.id), "student_id": str(student.id),
    }
    # The redemption is counted when the payment lands, not here: an abandoned
    # checkout must not consume a promo's uses (see commerce/webhooks.py).
    if discount_code is not None:
        metadata["discount_code_id"] = str(discount_code.id)

    # Ignore a start in the past (or seconds away) — that's a normal purchase.
    if start_at is not None and start_at <= timezone.now() + timedelta(minutes=5):
        start_at = None
    if start_at is not None:
        metadata["starts_at"] = start_at.isoformat()

    # Drop-in: la lezione viaggia col pagamento, cosi' l'accredito e la
    # prenotazione avvengono insieme e l'allieva non deve ritrovarla a mano.
    if lesson is not None:
        metadata["lesson_id"] = str(lesson.id)

    common = dict(
        success_url=success_url,
        cancel_url=cancel_url,
        customer_email=student.email or student.user.email,
        metadata=metadata,
    )

    if kind == "package" and getattr(item, "is_recurring", False):
        interval, interval_count = _stripe_interval(item.recurring_interval)
        price_obj = stripe.Price.create(
            currency="eur", unit_amount=amount_cents,
            recurring={"interval": interval, "interval_count": interval_count},
            product_data={"name": name},
        )
        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": price_obj.id, "quantity": 1}],
            subscription_data={
                "application_fee_percent": float(school.platform_fee_percentage),
                "transfer_data": {"destination": school.stripe_account_id},
                "metadata": metadata,
            },
            **common,
        )
    elif kind == "package":
        session = stripe.checkout.Session.create(
            mode="payment",
            line_items=[{
                "price_data": {"currency": "eur", "product_data": {"name": name}, "unit_amount": amount_cents},
                "quantity": 1,
            }],
            payment_intent_data={
                "application_fee_amount": _platform_fee_cents(amount_cents, school.platform_fee_percentage),
                "transfer_data": {"destination": school.stripe_account_id},
                "metadata": metadata,
            },
            **common,
        )
    elif kind == "subscription":
        price_obj = stripe.Price.create(
            currency="eur", unit_amount=amount_cents, recurring={"interval": "month"},
            product_data={"name": name},
        )
        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": price_obj.id, "quantity": 1}],
            subscription_data={
                "application_fee_percent": float(school.platform_fee_percentage),
                "transfer_data": {"destination": school.stripe_account_id},
                "metadata": metadata,
            },
            **common,
        )
    else:
        raise CheckoutError("invalid_kind")

    return session


def start_connect_onboarding(school, *, refresh_url: str, return_url: str) -> str:
    if not school.stripe_account_id:
        # Il paese arriva dalla scuola, non da un default. Stripe NON permette
        # di cambiare il paese di un account dopo la creazione: un account
        # aperto col paese sbagliato va cancellato e rifatto da zero, con
        # tutta la KYC ripetuta. Meglio fermarsi qui con un errore chiaro.
        country = country_code_for(school.country)
        if not country:
            raise CheckoutError(
                "school_country_missing" if not (school.country or "").strip()
                else "school_country_unknown"
            )
        account = stripe.Account.create(
            type="express", country=country, email=school.email,
            capabilities={"card_payments": {"requested": True}, "transfers": {"requested": True}},
        )
        school.stripe_account_id = account.id
        school.save(update_fields=["stripe_account_id"])

    link = stripe.AccountLink.create(
        account=school.stripe_account_id, refresh_url=refresh_url, return_url=return_url, type="account_onboarding",
    )
    return link.url


def refresh_onboarding_status(school) -> bool:
    if not school.stripe_account_id:
        return False
    try:
        account = stripe.Account.retrieve(school.stripe_account_id)
    except Exception:
        # Misconfigured/placeholder STRIPE_SECRET_KEY or a transient Stripe
        # API error shouldn't crash the whole payments page — fall back to
        # the last-known cached status instead.
        return school.stripe_onboarding_complete
    complete = bool(account.charges_enabled and account.details_submitted)
    if complete != school.stripe_onboarding_complete:
        school.stripe_onboarding_complete = complete
        school.save(update_fields=["stripe_onboarding_complete"])
    return complete


def refund_transaction(transaction) -> None:
    if not transaction.stripe_payment_id:
        raise CheckoutError("no_stripe_payment_id")
    stripe.Refund.create(payment_intent=transaction.stripe_payment_id)
    transaction.status = "refunded"
    transaction.save(update_fields=["status"])
