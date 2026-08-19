from decimal import Decimal

import stripe
from django.conf import settings
from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import DiscountCode, ShopOrder, ShopProduct, ShopProductVariant
from .serializers import ShopProductSerializer


class StudentShopListView(generics.ListAPIView):
    """GET /api/student/shop/ — active products, filterable by ?category=."""

    permission_classes = [AllowAny]
    serializer_class = ShopProductSerializer

    def get_queryset(self):
        qs = ShopProduct.objects.filter(active=True).prefetch_related("variants").order_by("name")
        category = self.request.query_params.get("category")
        if category:
            qs = qs.filter(category=category)
        return qs


class StudentShopDetailView(generics.RetrieveAPIView):
    """GET /api/student/shop/{id}/ — single product detail."""

    permission_classes = [AllowAny]
    serializer_class = ShopProductSerializer
    queryset = ShopProduct.objects.filter(active=True).prefetch_related("variants")


class StudentShopCheckoutView(APIView):
    """POST /api/student/shop/checkout/ — {items: [{product_id, size?, color?,
    qty}], discount_code?, referral_school_id?}. Creates a pending ShopOrder
    and a Stripe Checkout session. All items in one cart must share a single
    school (or all be platform-wide HQ products, product.school=null) —
    Stripe Checkout only supports one Connect transfer destination per
    session, so a mixed-school cart is rejected with a clear error asking
    the student to check out per school."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from schools.models import School
        from students.models import Student

        student = Student.objects.filter(user=request.user).first()
        if student is None:
            return Response({"error": "no_student_profile"}, status=400)

        items_in = request.data.get("items") or []
        if not items_in:
            return Response({"error": "empty_cart"}, status=400)

        line_items = []
        order_items = []
        subtotal = Decimal("0")
        shipping = Decimal("0")
        school_ids: set[str | None] = set()

        for it in items_in:
            product = ShopProduct.objects.filter(pk=it.get("product_id"), active=True).first()
            if product is None:
                return Response({"error": "product_not_found"}, status=404)
            qty = int(it.get("qty") or 1)
            if qty < 1:
                return Response({"error": "invalid_quantity"}, status=400)

            size, color = it.get("size"), it.get("color")
            variant = ShopProductVariant.objects.filter(product=product, size=size or "", color=color or "").first()
            if variant is not None and (variant.stock - variant.sold) < qty:
                return Response({"error": "no_stock", "product": product.name}, status=400)

            school_ids.add(str(product.school_id) if product.school_id else None)
            line_price = product.price * qty
            subtotal += line_price
            shipping = max(shipping, product.shipping_cost)
            order_items.append({
                "product_id": str(product.id), "name": product.name, "price": str(product.price),
                "qty": qty, "size": size, "color": color,
            })
            line_items.append({
                "price_data": {
                    "currency": "eur", "product_data": {"name": product.name},
                    "unit_amount": int(product.price * 100),
                },
                "quantity": qty,
            })

        if len(school_ids) > 1:
            return Response({"error": "mixed_school_cart"}, status=400)

        school = None
        target_school_id = next(iter(school_ids))
        if target_school_id:
            school = School.objects.filter(pk=target_school_id).first()
            if school is None or not (school.stripe_onboarding_complete and school.stripe_account_id):
                return Response({"error": "school_not_connected"}, status=400)

        discount_amount = Decimal("0")
        code = request.data.get("discount_code")
        if code:
            dc = DiscountCode.objects.filter(school=school, code=code, active=True).first()
            if dc is None:
                return Response({"error": "invalid_discount_code"}, status=400)
            discount_amount = (subtotal * Decimal(dc.value) / 100) if dc.type == "percentage" else Decimal(dc.value)
            discount_amount = min(discount_amount, subtotal)

        referral_school = None
        referral_discount = Decimal("0")
        referral_id = request.data.get("referral_school_id")
        if referral_id:
            referral_school = School.objects.filter(pk=referral_id, active=True).first()
            if referral_school is not None:
                referral_discount = subtotal * Decimal("0.03")

        total_discount = discount_amount + referral_discount
        total = max(Decimal("0"), subtotal - total_discount + shipping)

        if shipping > 0:
            line_items.append({
                "price_data": {
                    "currency": "eur", "product_data": {"name": "Shipping"}, "unit_amount": int(shipping * 100),
                },
                "quantity": 1,
            })

        order = ShopOrder.objects.create(
            student=student, school=school, items=order_items, subtotal=subtotal,
            discount_amount=total_discount, referral_school=referral_school,
            referral_discount=referral_discount, shipping=shipping, total=total, status="pending",
        )

        metadata = {"kind": "shop_order", "order_id": str(order.id), "student_id": str(student.id)}
        session_kwargs = dict(
            mode="payment",
            success_url=f"{settings.FRONTEND_URL}/student/shop?payment=success",
            cancel_url=f"{settings.FRONTEND_URL}/student/shop?payment=cancelled",
            customer_email=student.email or student.user.email,
            metadata=metadata,
        )
        if total_discount > 0:
            coupon = stripe.Coupon.create(amount_off=int(total_discount * 100), currency="eur", duration="once")
            session_kwargs["discounts"] = [{"coupon": coupon.id}]
        if school is not None:
            amount_cents = int(total * 100)
            session_kwargs["payment_intent_data"] = {
                "application_fee_amount": int(round(amount_cents * float(school.platform_fee_percentage) / 100)),
                "transfer_data": {"destination": school.stripe_account_id},
                "metadata": metadata,
            }

        try:
            session = stripe.checkout.Session.create(line_items=line_items, **session_kwargs)
        except Exception as exc:
            return Response({"error": "stripe_error", "detail": str(exc)}, status=502)

        order.stripe_payment_id = session.id
        order.save(update_fields=["stripe_payment_id"])
        return Response({"url": session.url, "order_id": str(order.id)}, status=status.HTTP_201_CREATED)
