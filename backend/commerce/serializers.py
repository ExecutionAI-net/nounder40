from rest_framework import serializers

from .models import DiscountCode, ShopProduct, ShopProductVariant, Transaction


class TransactionSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.name", read_only=True, default="")
    school_name = serializers.CharField(source="school.name", read_only=True)
    students = serializers.SerializerMethodField()

    class Meta:
        model = Transaction
        fields = "__all__"

    def get_students(self, obj):
        if not obj.student_id:
            return None
        return {"id": str(obj.student_id), "name": obj.student.name, "email": obj.student.email}


class DiscountCodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = DiscountCode
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class ShopVariantSerializer(serializers.ModelSerializer):
    stock = serializers.SerializerMethodField()

    class Meta:
        model = ShopProductVariant
        fields = ("id", "size", "color", "stock")

    def get_stock(self, obj):
        # spec 18.4 says the shop is unlimited-inventory, but the
        # shop_product_variants table (migrations 046/048/052) does track
        # stock/sold for products that opt into it — expose the remaining
        # count, never negative.
        return max(0, obj.stock - obj.sold)


class ShopProductSerializer(serializers.ModelSerializer):
    shop_product_variants = ShopVariantSerializer(source="variants", many=True, read_only=True)

    class Meta:
        model = ShopProduct
        fields = "__all__"
