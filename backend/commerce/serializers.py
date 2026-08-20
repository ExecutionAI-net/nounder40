import re

from rest_framework import serializers

from .models import DiscountCode, ShopProduct, ShopProductVariant, ShopSale, Transaction


class TransactionSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.name", read_only=True, default="")
    school_name = serializers.CharField(source="school.name", read_only=True)
    students = serializers.SerializerMethodField()
    schools = serializers.SerializerMethodField()

    class Meta:
        model = Transaction
        fields = "__all__"

    def get_students(self, obj):
        if not obj.student_id:
            return None
        return {"id": str(obj.student_id), "name": obj.student.name, "email": obj.student.email}

    def get_schools(self, obj):
        if not obj.school_id:
            return None
        return {"id": str(obj.school_id), "name": obj.school.name, "city": obj.school.city}


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


# ── HQ management (raw stock/sold, write validation) ─────────────────────
# Distinct from ShopVariantSerializer/ShopProductSerializer above, which expose
# net-remaining stock for student-facing browsing (commerce/student_views.py).

_RICH_TEXT_TAGS = {"b", "strong", "i", "em", "u", "br", "p"}
_SCRIPT_STYLE_RE = re.compile(r"<\s*(script|style)[^>]*>.*?<\s*/\s*\1\s*>", re.IGNORECASE | re.DOTALL)
_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_TAG_RE = re.compile(r"<(/?)([a-zA-Z0-9-]+)(?:\s[^>]*)?/?>")
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_MAX_BADGES = 4


def sanitize_rich_text(html: str) -> str:
    """Allowlist for HQ-written product descriptions: bold/italic/underline/
    paragraphs/line-breaks only, no attributes — mirrors frontend's
    lib/sanitize.ts (also re-applied client-side on render, so this is
    defense-in-depth, not the only sanitization pass)."""
    html = _SCRIPT_STYLE_RE.sub("", html)
    html = _COMMENT_RE.sub("", html)

    def repl(m):
        slash, tag = m.group(1), m.group(2).lower()
        if tag not in _RICH_TEXT_TAGS:
            return ""
        return "<br>" if tag == "br" else f"<{slash}{tag}>"

    return _TAG_RE.sub(repl, html).strip()


def normalize_badges(items) -> list[dict]:
    if not isinstance(items, list):
        return []
    result = []
    for b in items:
        if not isinstance(b, dict):
            continue
        label = str(b.get("label") or "").strip()[:24]
        if not label:
            continue
        color = str(b.get("color") or "").strip()
        result.append({"label": label, "color": color.upper() if _HEX_COLOR_RE.match(color) else "#3D3D3D"})
    return result[:_MAX_BADGES]


class HQShopVariantSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShopProductVariant
        fields = ("id", "size", "color", "stock", "sold")


class HQShopProductSerializer(serializers.ModelSerializer):
    shop_product_variants = HQShopVariantSerializer(source="variants", many=True, read_only=True)

    class Meta:
        model = ShopProduct
        fields = "__all__"

    def validate_description(self, value):
        return sanitize_rich_text(value) if value else value

    def validate_badges(self, value):
        return normalize_badges(value)

    def validate(self, attrs):
        if "original_price" in attrs:
            price = attrs.get("price", self.instance.price if self.instance else None)
            original_price = attrs["original_price"]
            if original_price is not None and price is not None and original_price <= price:
                attrs["original_price"] = None
        return attrs


class ShopSaleSerializer(serializers.ModelSerializer):
    shop_products = serializers.SerializerMethodField()
    students = serializers.SerializerMethodField()
    schools = serializers.SerializerMethodField()

    class Meta:
        model = ShopSale
        fields = "__all__"

    def get_shop_products(self, obj):
        return {"name": obj.product.name} if obj.product_id else None

    def get_students(self, obj):
        return {"name": obj.student.name} if obj.student_id else None

    def get_schools(self, obj):
        return {"name": obj.school.name} if obj.school_id else None
