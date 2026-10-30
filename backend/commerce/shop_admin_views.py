"""HQ shop management extras — stock matrix, image gallery, manual sales
(spec 18: Shop). Split from views.py since ShopProductViewSet (list/create/
update/delete) is a plain HQOnlyModelViewSet, while these need custom,
non-CRUD request/response shapes."""

import uuid
from decimal import Decimal

from django.db import transaction
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.params import parse_decimal, parse_int, parse_uuid
from core.viewsets import is_hq

from .models import ShopProduct, ShopProductVariant, ShopReferrer, ShopSale
from .serializers import ShopSaleSerializer

_PAYMENT_METHODS = ["bonifico", "carta", "contante", "cambio", "regalo"]


class _SaleRefused(Exception):
    """A line of a manual sale that cannot be sold: raised inside the atomic
    block so the stock already scaled for earlier lines rolls back."""

    def __init__(self, payload: dict, status: int = 400):
        super().__init__(payload.get("error"))
        self.payload, self.status = payload, status


def _variant_key(size, color):
    return f"{size or ''}|{color or ''}"


class HQShopVariantsView(APIView):
    """PUT /api/hq/shop/<uuid:pk>/variants/ — replace a product's stock
    matrix. Existing size/color combos keep their `sold` counter; combos no
    longer present are removed. Body: {variants: [{size, color, stock}]}."""

    permission_classes = [IsAuthenticated]

    def put(self, request, pk):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        product = ShopProduct.objects.filter(pk=pk, school__isnull=True).first()
        if product is None:
            return Response({"error": "Product not found"}, status=404)

        incoming = request.data.get("variants")
        incoming = incoming if isinstance(incoming, list) else []

        existing = {_variant_key(v.size, v.color): v for v in product.variants.all()}
        incoming_keys = set()

        for v in incoming:
            size = str(v.get("size") or "")
            color = str(v.get("color") or "")
            stock = max(0, int(v.get("stock") or 0))
            key = _variant_key(size, color)
            incoming_keys.add(key)
            existing_variant = existing.get(key)
            if existing_variant:
                existing_variant.stock = stock
                existing_variant.save(update_fields=["stock"])
            else:
                ShopProductVariant.objects.create(product=product, size=size, color=color, stock=stock)

        to_delete = [v.id for key, v in existing.items() if key not in incoming_keys]
        if to_delete:
            ShopProductVariant.objects.filter(id__in=to_delete).delete()

        variants = product.variants.all()
        return Response({
            "variants": [
                {"id": str(v.id), "size": v.size, "color": v.color, "stock": v.stock, "sold": v.sold}
                for v in variants
            ]
        })


class HQShopImagesView(APIView):
    """POST (multipart 'file') / DELETE (body {url}) /api/hq/shop/<uuid:pk>/images/
    — product image gallery, max 6 images."""

    permission_classes = [IsAuthenticated]
    _ALLOWED = ("image/jpeg", "image/png", "image/webp")
    _MAX_SIZE = 4 * 1024 * 1024
    _MAX_IMAGES = 6

    def _get_product(self, pk):
        return ShopProduct.objects.filter(pk=pk, school__isnull=True).first()

    def post(self, request, pk):
        from core.storage import save_public

        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        product = self._get_product(pk)
        if product is None:
            return Response({"error": "Product not found"}, status=404)
        if len(product.images) >= self._MAX_IMAGES:
            return Response({"error": "max_images"}, status=400)

        f = request.FILES.get("file")
        if not f:
            return Response({"error": "file is required"}, status=400)
        if f.content_type not in self._ALLOWED:
            return Response({"error": "invalid_type"}, status=400)
        if f.size > self._MAX_SIZE:
            return Response({"error": "too_large"}, status=400)

        url = save_public(f, subdir=f"shop/{pk}")
        product.images = [*product.images, url]
        product.save(update_fields=["images"])
        return Response({"images": product.images})

    def delete(self, request, pk):
        from core.storage import delete_public

        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        product = self._get_product(pk)
        if product is None:
            return Response({"error": "Product not found"}, status=404)

        url = request.data.get("url")
        product.images = [u for u in product.images if u != url]
        product.save(update_fields=["images"])
        if url:
            delete_public(url)
        return Response({"images": product.images})


class HQShopSalesView(APIView):
    """GET (sales log, most recent first, capped at 500) / POST (multi-line
    manual sale, cart-style) /api/hq/shop/sales/. On create: scales stock
    (never below zero), distributes any manual discount proportionally
    across lines (last line absorbs rounding), and computes school +
    referrer commission on the post-discount (net) amount per line."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        qs = ShopSale.objects.select_related("product", "student", "school").order_by("-created_at")[:500]
        return Response(ShopSaleSerializer(qs, many=True).data)

    def post(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")

        from students.models import Student

        body = request.data
        student_id = parse_uuid(body.get("student_id"), "student_id")
        payment_method = body.get("payment_method") if body.get("payment_method") in _PAYMENT_METHODS else "contante"
        # The referrer comes from the registry (referrer_id); the name is
        # stamped on the sale as it is today. Plain `referrer` text is still
        # taken from older clients.
        referrer_contact = None
        referrer = (body.get("referrer") or "").strip()
        referrer_id = parse_uuid(body.get("referrer_id"), "referrer_id")  # a non-UUID is a 400, not a 500
        if referrer_id:
            referrer_contact = ShopReferrer.objects.filter(pk=referrer_id, active=True).first()
            if referrer_contact is None:
                return Response({"error": "referrer_not_found"}, status=400)
            referrer = referrer_contact.full_name
        # core.params: a non-number is a 400, NaN/Infinity never get through
        pct = parse_decimal(body.get("referrer_percentage"), "referrer_percentage", default=Decimal("0"))
        referrer_pct = float(min(Decimal("100"), max(Decimal("0"), pct))) if referrer else 0.0
        requested_discount = float(max(Decimal("0"), parse_decimal(body.get("discount"), "discount", default=Decimal("0"))))
        notes = body.get("notes") or ""
        items = body.get("items")
        items = items if isinstance(items, list) and all(isinstance(i, dict) for i in items) else []
        if not items:
            return Response({"error": "invalid_item"}, status=400)

        student_obj = None
        school = None
        commission_pct = 0.0
        if student_id:
            student_obj = Student.objects.filter(pk=student_id).select_related("school").first()
            if student_obj and student_obj.school_id:
                school = student_obj.school
                commission_pct = float(school.shop_commission_percentage or 0)

        order_id = uuid.uuid4()

        try:
            with transaction.atomic():
                # Every line is checked before any stock moves: a refused line
                # raises, and the block rolls back the lines before it
                # (review 30/10/2026: a plain `return` committed them).
                lines = []
                for item in items:
                    qty = parse_int(item.get("qty"), "qty", default=0)
                    product_id = parse_uuid(item.get("product_id"), "product_id")
                    variant_id = parse_uuid(item.get("variant_id"), "variant_id")
                    if not product_id or not variant_id or qty < 1:
                        raise _SaleRefused({"error": "invalid_item"})
                    product = ShopProduct.objects.filter(pk=product_id, school__isnull=True).first()
                    if product is None:
                        raise _SaleRefused({"error": "product_not_found"}, 404)
                    variant = (
                        ShopProductVariant.objects.select_for_update()
                        .filter(pk=variant_id, product=product)
                        .first()
                    )
                    if variant is None:
                        raise _SaleRefused({"error": "variant_not_found"}, 404)
                    # The list price, unless HQ typed another one on this sale
                    # (Carlo, 30/10/2026). Absent = list price; present but not
                    # a positive amount that fits the column = refused.
                    unit_price = float(product.price)
                    try:
                        typed = parse_decimal(item.get("unit_price"), "unit_price")
                    except ValidationError:  # not a number at all: same code the form knows
                        raise _SaleRefused({"error": "invalid_unit_price", "product": product.name}) from None
                    if typed is not None:
                        if typed <= 0 or typed >= Decimal("1e8"):
                            raise _SaleRefused({"error": "invalid_unit_price", "product": product.name})
                        unit_price = float(typed.quantize(Decimal("0.01")))
                    lines.append({
                        "product": product, "variant": variant, "size": variant.size, "color": variant.color,
                        "qty": qty, "unit_price": unit_price, "gross": round(unit_price * qty, 2),
                    })

                for line in lines:
                    variant = line["variant"]
                    variant.stock = max(0, variant.stock - line["qty"])
                    variant.sold = variant.sold + line["qty"]
                    variant.save(update_fields=["stock", "sold"])

                subtotal = round(sum(line["gross"] for line in lines), 2)
                discount = min(requested_discount, subtotal)
                discount_left = discount
                sale_rows = []
                for i, line in enumerate(lines):
                    if i == len(lines) - 1:
                        share = round(discount_left, 2)
                    else:
                        share = round(discount * (line["gross"] / subtotal), 2) if subtotal > 0 else 0.0
                    discount_left = round(discount_left - share, 2)
                    net = round(line["gross"] - share, 2)
                    sale_rows.append(ShopSale(
                        order_id=order_id, product=line["product"], variant=line["variant"],
                        student=student_obj, school=school,
                        qty=line["qty"], unit_price=line["unit_price"], discount=share, total=net,
                        commission=round(net * commission_pct / 100, 2),
                        referrer=referrer, referrer_contact=referrer_contact, referrer_percentage=referrer_pct,
                        referrer_commission=round(net * referrer_pct / 100, 2),
                        size=line["size"], color=line["color"], payment_method=payment_method,
                        source=ShopSale.Source.MANUAL, notes=notes,
                    ))
                ShopSale.objects.bulk_create(sale_rows)
        except _SaleRefused as refused:
            return Response(refused.payload, status=refused.status)

        total = round(sum(float(r.total) for r in sale_rows), 2)
        return Response(
            {"order_id": str(order_id), "sales": ShopSaleSerializer(sale_rows, many=True).data, "total": total},
            status=201,
        )

