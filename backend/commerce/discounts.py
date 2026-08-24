"""Discount code redemption — one place, so the package checkout and the shop
checkout agree on what a code means.

Two owners (spec 7.13 + 6.x): a code with `school` set belongs to that school
and applies to its own packages; a code with `school = null` is HQ's and
applies to the HQ shop. A code is never valid outside its owner's catalogue.

A code can also be restricted to specific items (`applies_to`): the discount
is then computed only on the matching lines of what is being bought.
"""

from decimal import ROUND_HALF_UP, Decimal

from django.utils import timezone

from .models import DiscountCode


class DiscountError(Exception):
    """Reason a code was refused — the string is the API error payload."""


def resolve_discount(code: str | None, *, school, scope: str, subtotal=None, lines=None):
    """Return (DiscountCode | None, amount_off). No code → (None, 0).

    `school` is the owner of what is being bought (None for the HQ shop);
    `scope` is one of the DiscountCode.ValidFor values other than "all".
    `lines` is what is in the basket: [{"id": <item id>, "amount": <line
    total>}, …] — one line for a package purchase, one per product in a shop
    cart. `subtotal` is only needed when there are no lines to sum.
    Raises DiscountError for anything the student should be told about.
    """
    lines = [{"id": str(ln["id"]), "amount": Decimal(str(ln["amount"]))} for ln in (lines or [])]
    total = sum((ln["amount"] for ln in lines), Decimal("0")) if lines else Decimal(str(subtotal or 0))

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
    if dc.minimum_order is not None and total < Decimal(dc.minimum_order):
        raise DiscountError("discount_code_minimum_not_met")

    # Restricted to specific items: only those lines are discounted. Without
    # lines (a bare price check) an item-restricted code can't be verified.
    allowed = [str(i) for i in (dc.applies_to or [])]
    if allowed:
        eligible = sum((ln["amount"] for ln in lines if ln["id"] in allowed), Decimal("0"))
        if eligible <= 0:
            raise DiscountError("discount_code_not_applicable")
    else:
        eligible = total

    if dc.type == DiscountCode.Type.PERCENTAGE:
        amount = eligible * Decimal(dc.value) / Decimal("100")
    else:
        amount = Decimal(dc.value)
    # Rounded to the cent here and nowhere else, so the amount shown before
    # paying is exactly the one charged (Stripe works in whole cents).
    amount = amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    # Never below zero, and never more than the items it applies to.
    return dc, min(max(amount, Decimal("0")), eligible)


def mark_redeemed(discount_code_id) -> None:
    """Count one redemption (F() so concurrent checkouts don't lose counts)."""
    if not discount_code_id:
        return
    from django.db.models import F

    DiscountCode.objects.filter(pk=discount_code_id).update(usage_count=F("usage_count") + 1)
