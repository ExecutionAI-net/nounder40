from core.viewsets import HQOnlyModelViewSet, SchoolScopedModelViewSet

from .models import DiscountCode, ShopProduct
from .serializers import DiscountCodeSerializer, ShopProductSerializer


class DiscountCodeViewSet(SchoolScopedModelViewSet):
    queryset = DiscountCode.objects.all()
    serializer_class = DiscountCodeSerializer
    filterset_fields = ["active", "valid_for"]


class ShopProductViewSet(HQOnlyModelViewSet):
    """HQ + school products; read for all authenticated, write for HQ (school
    write scoping is layered on when the school shop panel is ported)."""

    queryset = ShopProduct.objects.all()
    serializer_class = ShopProductSerializer
    filterset_fields = ["active", "category"]
