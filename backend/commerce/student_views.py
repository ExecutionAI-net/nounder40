from rest_framework import generics
from rest_framework.permissions import AllowAny

from .models import ShopProduct
from .serializers import ShopProductSerializer


class StudentShopListView(generics.ListAPIView):
    """GET /api/student/shop/ — active products, filterable by ?category=."""

    permission_classes = [AllowAny]
    serializer_class = ShopProductSerializer

    def get_queryset(self):
        qs = ShopProduct.objects.filter(active=True).order_by("name")
        category = self.request.query_params.get("category")
        if category:
            qs = qs.filter(category=category)
        return qs


class StudentShopDetailView(generics.RetrieveAPIView):
    """GET /api/student/shop/{id}/ — single product detail."""

    permission_classes = [AllowAny]
    serializer_class = ShopProductSerializer
    queryset = ShopProduct.objects.filter(active=True)
