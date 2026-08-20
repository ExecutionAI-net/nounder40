"""HQ shop management extras — stock matrix, image gallery, manual sales
(spec 18: Shop). Split from views.py since ShopProductViewSet (list/create/
update/delete) is a plain HQOnlyModelViewSet, while these need custom,
non-CRUD request/response shapes."""

import uuid

from django.db import transaction
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.viewsets import is_hq

from .models import ShopProduct, ShopProductVariant, ShopSale
from .serializers import ShopSaleSerializer

_PAYMENT_METHODS = ["bonifico", "carta", "contante", "cambio", "regalo"]


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
        student_id = body.get("student_id") or None
        payment_method = body.get("payment_method") if body.get("payment_method") in _PAYMENT_METHODS else "contante"
        referrer = (body.get("referrer") or "").strip()
        referrer_pct = min(100.0, max(0.0, float(body.get("referrer_percentage") or 0))) if referrer else 0.0
        requested_discount = max(0.0, float(body.get("discount") or 0))
        notes = body.get("notes") or ""
        items = body.get("items")
        items = items if isinstance(items, list) else []
        if not items:
            return Response({"error": "items are required"}, status=400)

        student_obj = None
        school = None
        commission_pct = 0.0
        if student_id:
            student_obj = Student.objects.filter(pk=student_id).select_related("school").first()
            if student_obj and student_obj.school_id:
                school = student_obj.school
                commission_pct = float(school.shop_commission_percentage or 0)

        order_id = uuid.uuid4()

        with transaction.atomic():
            lines = []
            for item in items:
                qty = int(item.get("qty") or 0)
                product_id = item.get("product_id")
                variant_id = item.get("variant_id")
                if not product_id or not variant_id or qty < 1:
                    return Response({"error": "invalid_item"}, status=400)

                product = ShopProduct.objects.filter(pk=product_id, school__isnull=True).first()
                if product is None:
                    return Response({"error": "Product not found"}, status=404)
                variant = (
                    ShopProductVariant.objects.select_for_update()
                    .filter(pk=variant_id, product=product)
                    .first()
                )
                if variant is None:
                    return Response({"error": "Variant not found"}, status=404)

                variant.stock = max(0, variant.stock - qty)
                variant.sold = variant.sold + qty
                variant.save(update_fields=["stock", "sold"])

                unit_price = float(product.price)
                gross = round(unit_price * qty, 2)
                lines.append({
                    "product": product, "variant": variant, "size": variant.size, "color": variant.color,
                    "qty": qty, "unit_price": unit_price, "gross": gross,
                })

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
                    referrer=referrer, referrer_percentage=referrer_pct,
                    referrer_commission=round(net * referrer_pct / 100, 2),
                    size=line["size"], color=line["color"], payment_method=payment_method,
                    source=ShopSale.Source.MANUAL, notes=notes,
                ))
            ShopSale.objects.bulk_create(sale_rows)

        total = round(sum(float(r.total) for r in sale_rows), 2)
        return Response(
            {"order_id": str(order_id), "sales": ShopSaleSerializer(sale_rows, many=True).data, "total": total},
            status=201,
        )
