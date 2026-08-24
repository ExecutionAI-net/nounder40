"""Discount code redemption — one place, so the package checkout and the shop
checkout agree on what a code means.

Two owners (spec 7.13 + 6.x): a code with `school` set belongs to that school
and applies to its own packages; a code with `school = null` is HQ's and
applies to the HQ shop. A code is never valid outside its owner's catalogue.
"""

from decimal import Decimal

from django.utils import timezone

from .models import DiscountCode


class DiscountError(Exception):
    """Reason a code was refused — the string is the API error payload."""


def resolve_discount(code: str | None, *, school, scope: str, subtotal: Decimal):
    """Return (DiscountCode | None, amount_off). No code → (None, 0).

    `school` is the owner of what is being bought (None for the HQ shop);
    `scope` is one of the DiscountCode.ValidFor values other than "all".
    Raises DiscountError for anything the student should be told about.
    """
    if not code:
        return None, Decimal("0")

    dc = DiscountCode.objects.filter(school=school, code__iexact=code.strip(), active=True).first()
    if dc is None:
        raise DiscountError("invalid_discount_code")
    if dc.expires_at is not None and dc.expires_at <= timezone.now():
        raise DiscountError("discount_code_expired")
    if dc.valid_for not in (DiscountCode.ValidFor.ALL, scope):
        raise DiscountError("discount_code_wrong_scope")
    if dc.max_uses is not None and dc.usage_count >= dc.max_uses:
        raise DiscountError("discount_code_exhausted")
    if dc.minimum_order is not None and subtotal < Decimal(dc.minimum_order):
        raise DiscountError("discount_code_minimum_not_met")

    if dc.type == DiscountCode.Type.PERCENTAGE:
        amount = subtotal * Decimal(dc.value) / Decimal("100")
    else:
        amount = Decimal(dc.value)
    # Never below zero, and never more than what is being bought.
    return dc, min(max(amount, Decimal("0")), subtotal)


def mark_redeemed(discount_code_id) -> None:
    """Count one redemption (F() so concurrent checkouts don't lose counts)."""
    if not discount_code_id:
        return
    from django.db.models import F

    DiscountCode.objects.filter(pk=discount_code_id).update(usage_count=F("usage_count") + 1)
