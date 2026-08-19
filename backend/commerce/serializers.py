from rest_framework import serializers

from .models import DiscountCode, ShopProduct


class DiscountCodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = DiscountCode
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class ShopProductSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShopProduct
        fields = "__all__"
