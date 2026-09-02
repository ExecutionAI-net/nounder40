from core.viewsets import HQOnlyModelViewSet, SchoolScopedModelViewSet

from .models import DiscountCode, ShopProduct
from .serializers import DiscountCodeSerializer, HQShopProductSerializer


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
    filterset_fields = ["active", "category"]
