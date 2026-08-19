from rest_framework import serializers

from .models import DiscountCode, ShopProduct, Transaction


class TransactionSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.name", read_only=True, default="")
    school_name = serializers.CharField(source="school.name", read_only=True)

    class Meta:
        model = Transaction
        fields = "__all__"


class DiscountCodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = DiscountCode
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class ShopProductSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShopProduct
        fields = "__all__"
