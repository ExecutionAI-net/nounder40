from django.db.models import Count
from rest_framework import status
from rest_framework.response import Response

from core.viewsets import HQOnlyModelViewSet, SchoolScopedModelViewSet

from .models import DiscountCode, ShopProduct, ShopReferrer
from .serializers import DiscountCodeSerializer, HQShopProductSerializer, ShopReferrerSerializer


class DiscountCodeViewSet(SchoolScopedModelViewSet):
    """A school's own codes (spec 7.13), spendable on that school's packages."""

    queryset = DiscountCode.objects.filter(school__isnull=False).order_by("-created_at")
    serializer_class = DiscountCodeSerializer
    filterset_fields = ["active", "valid_for"]


class HQDiscountCodeViewSet(HQOnlyModelViewSet):
    """HQ's own codes (school=null), spendable in the HQ shop — separate from
    each school's codes, exactly like the package/shop catalogues."""

    queryset = DiscountCode.objects.filter(school__isnull=True).order_by("-created_at")
    serializer_class = DiscountCodeSerializer
    filterset_fields = ["active", "valid_for"]

    def perform_create(self, serializer):
        serializer.save(school=None)


class ShopProductViewSet(HQOnlyModelViewSet):
    """HQ's global product catalog (school IS NULL) — school-scoped shop
    write access is layered on separately when the school shop panel is
    ported. Uses HQShopProductSerializer (raw stock/sold, write validation)
    rather than the student-facing ShopProductSerializer."""

    queryset = ShopProduct.objects.filter(school__isnull=True)
    serializer_class = HQShopProductSerializer
<<<<<<< HEAD
    filterset_fields = ["active", "category"]


class HQShopReferrerViewSet(HQOnlyModelViewSet):
    """The referrers registry for manual sales (Carlo, 30/10/2026):
    /api/hq/shop-referrers/. Inactive rows are listed too (the sales filter
    needs them); the sale form keeps the active ones. A referrer with sales
    is never deleted — the sales point at it — HQ deactivates it instead."""

    queryset = ShopReferrer.objects.annotate(sales_count=Count("sales"))
    serializer_class = ShopReferrerSerializer
    filterset_fields = ["active"]

    def destroy(self, request, *args, **kwargs):
        self._require_hq()
        if self.get_object().sales.exists():
            return Response({"error": "has_sales"}, status=status.HTTP_409_CONFLICT)
        return super().destroy(request, *args, **kwargs)
=======
    filterset_fields = ["active", "online", "category"]
>>>>>>> feat/shop-product-online-flag
