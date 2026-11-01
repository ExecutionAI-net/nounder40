"""A sale the school types by hand (Carlo, 2026-11-01).

"Assign package" with reason "sale" is a payment like a Stripe one and shows
up in Payments and in the HQ reports: one Transaction (type package, the
school's own payment method, platform fee 0 -- HQ takes nothing on cash for
now) tied to the ManualCreditGrant that gave the credits. Gifts, corrections
and compensations stay credit movements only. The school can correct or
delete the payment afterwards; the credits it gave stay in the wallet and
are managed from the credits page as before."""

from datetime import datetime, timedelta
from decimal import Decimal

from django.db import transaction as db_transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.params import ensure_object_body, parse_date, parse_decimal, parse_str, parse_uuid
from core.viewsets import is_hq

from .models import Transaction

SALE_PAYMENT_METHODS = ("cash", "bank_transfer", "pos", "other")
_CENT = Decimal("0.01")


class SaleRefused(Exception):
    """A sale body that cannot be taken; `payload` is the 400 the form knows."""

    def __init__(self, error: str, status: int = 400):
        super().__init__(error)
        self.payload, self.status = {"error": error}, status


def sale_moment(school, day):
    """`day` in the school's zone at the current time of day: the period
    filters truncate under that zone, so the sale lands on the day the
    school typed, and two sales typed one after the other keep their order
    (the first-purchase badges read the history in that order)."""
    now_local = timezone.now().astimezone(school.tzinfo())
    return datetime.combine(day, now_local.time().replace(microsecond=0), tzinfo=school.tzinfo())


def parse_sale_fields(body, school, defaults=None):
    """(sold_at, price, discount, payment_method) of a sale body. Absent
    fields take `defaults` (an existing sale) or, for a new sale, today and
    nothing off. Price is required, the discount cannot exceed it, the day
    cannot be more than one day ahead of the server (UTC vs the browser)."""
    d = defaults or {}
    raw_day = body.get("sold_at")
    if raw_day in (None, ""):
        sold_at = d.get("sold_at") or timezone.now().astimezone(school.tzinfo()).date()
    else:
        try:
            sold_at = parse_date(raw_day, "sold_at")
        except Exception:  # noqa: BLE001 -- a non-date: same code the form knows
            raise SaleRefused("invalid_sold_at") from None
    if sold_at > timezone.localdate() + timedelta(days=1):
        raise SaleRefused("invalid_sold_at")

    # "12,50" or "abc" typed by hand: the code the form knows, not a bare 400
    try:
        price = parse_decimal(body.get("price"), "price", default=d.get("price"))
    except ValidationError:
        raise SaleRefused("price_required") from None
    if price is None or price < 0 or price >= Decimal("1e8"):
        raise SaleRefused("price_required")
    try:
        discount = parse_decimal(body.get("discount"), "discount", default=d.get("discount", Decimal("0")))
    except ValidationError:
        raise SaleRefused("invalid_discount") from None
    discount = max(Decimal("0"), discount)
    if discount > price:
        raise SaleRefused("discount_over_price")

    method = body.get("payment_method", d.get("payment_method"))
    if method not in SALE_PAYMENT_METHODS:
        raise SaleRefused("invalid_payment_method")
    return sold_at, price.quantize(_CENT), discount.quantize(_CENT), method


def create_sale_transaction(*, grant, school, student, catalog, moment, price, discount, payment_method):
    """`moment` is the one the caller stamped on the StudentPackage: the
    package and its payment carry the same instant."""
    net = price - discount
    name = catalog.localized_name(student.language_preference) if catalog is not None else (grant.package_name or "")
    return Transaction.objects.create(
        school=school, student=student, type=Transaction.Type.PACKAGE,
        product_id=catalog.id if catalog is not None else None, product_name=name,
        amount=net, discount=discount, currency="eur", platform_fee=Decimal("0"), school_amount=net,
        payment_method=payment_method, status=Transaction.Status.COMPLETED,
        created_at=moment, manual_grant=grant,
    )


def _move_package(pkg, moment):
    """The package starts on the corrected day. Its expiry is rebuilt, not
    shifted: the base is the catalog validity from the new start (or the old
    expiry moved by the same amount for a package without a catalog row),
    then the extensions ledger (students/extensions.py) replays the school's
    closures on it. Closure rows are recomputable and are dropped first;
    a hand-picked date (kind=manual) is absolute and stays the base."""
    from students.extensions import settle
    from students.models import StudentPackageExtension

    shift = moment - pkg.purchased_at
    pkg.purchased_at = moment
    if pkg.expires_at:
        if pkg.package_id and pkg.package is not None:
            pkg.expires_at = moment + pkg.package.validity_delta()
        else:
            pkg.expires_at = pkg.expires_at + shift
    pkg.extensions.filter(kind=StudentPackageExtension.Kind.CLOSURE).delete()
    pkg.save(update_fields=["purchased_at", "expires_at"])
    settle(pkg)
    pkg.refresh_from_db(fields=["expires_at"])


def _caller_school_id(request):
    user = request.user
    school_id = (parse_uuid(request.query_params.get("school"), "school") if is_hq(user) else None) or user.active_school_id
    if not school_id:
        raise PermissionDenied("school is required")
    return school_id


class SchoolTransactionDetailView(APIView):
    """PATCH / DELETE /api/school/transactions/<uuid:pk>/ -- correct or remove a
    payment the school typed by hand. PATCH takes `sold_at`, `price`,
    `discount`, `payment_method`, `note` (the credit row's note); what the
    body leaves out stays; a new day moves the package too (its start and
    expiry shift by the same amount, so a hand extension survives). DELETE
    removes the payment only: the credits stay in the wallet (the credits
    page takes them out), and the credit row forgets its price so the
    credits page stops counting it as revenue. A Stripe payment is not
    touched either way (409)."""

    permission_classes = [IsAuthenticated]

    def _locked(self, request, pk):
        from schools.models import School

        school_id = _caller_school_id(request)
        tx = (
            Transaction.objects.select_for_update(of=("self",))
            .select_related("school", "manual_grant")
            .filter(pk=pk, school_id=school_id)
            .first()
        )
        if tx is None:
            raise SaleRefused("not_found", 404)
        if tx.manual_grant_id is None:
            raise SaleRefused("online_payment_locked", 409)
        if tx.status != Transaction.Status.COMPLETED:
            # the package was taken out of the wallet: the payment is history
            raise SaleRefused("payment_refunded", 409)
        return tx, School.objects.get(pk=school_id)

    def patch(self, request, pk):
        body = ensure_object_body(request.data)
        try:
            with db_transaction.atomic():
                tx, school = self._locked(request, pk)
                current = {
                    "sold_at": tx.created_at.astimezone(school.tzinfo()).date(),
                    "price": Decimal(tx.amount) + Decimal(tx.discount), "discount": Decimal(tx.discount),
                    "payment_method": tx.payment_method,
                }
                sold_at, price, discount, method = parse_sale_fields(body, school, current)
                grant = tx.manual_grant
                pkg = grant.package
                # The moment moves only when the day does: a corrected price
                # must not jump the sale past the ones typed after it (the
                # first-purchase badges read the history in time order)
                if sold_at != current["sold_at"]:
                    moment = sale_moment(school, sold_at)
                    if pkg is not None:
                        _move_package(pkg, moment)
                    tx.created_at = moment
                tx.amount = tx.school_amount = price - discount
                tx.discount = discount
                tx.payment_method = method
                tx.save(update_fields=["created_at", "amount", "school_amount", "discount", "payment_method"])
                if pkg is not None:
                    pkg.payment_method = method
                    pkg.save(update_fields=["payment_method"])
                # the credit row carries what was collected, net of the discount
                grant.price, grant.payment_method = price - discount, method
                fields = ["price", "payment_method"]
                if "note" in body:
                    grant.note = parse_str(body.get("note"), "note")
                    fields.append("note")
                grant.save(update_fields=fields)
        except SaleRefused as refused:
            return Response(refused.payload, status=refused.status)
        from .report_views import _serialize_transactions

        return Response(_serialize_transactions(Transaction.objects.filter(pk=tx.pk).select_related("student", "school", "manual_grant"), school_id=school.pk)[0])

    def delete(self, request, pk):
        try:
            with db_transaction.atomic():
                tx, _school = self._locked(request, pk)
                grant = tx.manual_grant
                grant.price, grant.payment_method = None, ""
                grant.save(update_fields=["price", "payment_method"])
                tx.delete()
        except SaleRefused as refused:
            return Response(refused.payload, status=refused.status)
        return Response(status=204)
