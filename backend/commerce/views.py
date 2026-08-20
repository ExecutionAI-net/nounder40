from core.viewsets import HQOnlyModelViewSet, SchoolScopedModelViewSet

from .models import DiscountCode, ShopProduct
from .serializers import DiscountCodeSerializer, HQShopProductSerializer


class DiscountCodeViewSet(SchoolScopedModelViewSet):
    queryset = DiscountCode.objects.all()
    serializer_class = DiscountCodeSerializer
    filterset_fields = ["active", "valid_for"]


class ShopProductViewSet(HQOnlyModelViewSet):
    """HQ's global product catalog (school IS NULL) — school-scoped shop
    write access is layered on separately when the school shop panel is
    ported. Uses HQShopProductSerializer (raw stock/sold, write validation)
    rather than the student-facing ShopProductSerializer."""

    queryset = ShopProduct.objects.filter(school__isnull=True)
    serializer_class = HQShopProductSerializer
    filterset_fields = ["active", "category"]
