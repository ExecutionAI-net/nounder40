from django.apps import apps as django_apps
from django.contrib import admin

from .models import (
    DiscountCode,
    ShopOrder,
    ShopProduct,
    ShopProductVariant,
    ShopSale,
    Transaction,
)


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    """`platform_fee` e `school_amount` accanto ad `amount`: è la divisione
    dell'incasso fra HQ e scuola, la ragione per cui questa tabella esiste."""

    list_display = ("created_at", "school", "student", "type", "product_name",
                    "amount", "currency", "platform_fee", "school_amount",
                    "status", "payment_method")
    list_filter = ("status", "type", "school", "payment_method", "currency")
    search_fields = ("product_name", "student__name", "student__email",
                     "school__name", "stripe_payment_id")
    ordering = ("-created_at",)
    date_hierarchy = "created_at"
    list_select_related = ("school", "student")


@admin.register(DiscountCode)
class DiscountCodeAdmin(admin.ModelAdmin):
    """`school` vuoto = codice di HQ, valido su tutta la rete."""

    list_display = ("code", "name", "school", "type", "value", "valid_for",
                    "usage_count", "max_uses", "expires_at", "active")
    list_filter = ("active", "type", "valid_for", "school")
    search_fields = ("code", "name", "school__name")
    ordering = ("-created_at",)
    list_select_related = ("school",)


@admin.register(ShopProduct)
class ShopProductAdmin(admin.ModelAdmin):
    list_display = ("name", "school", "category", "price", "original_price",
                    "shipping_cost", "active", "created_at")
    list_filter = ("active", "category", "school")
    search_fields = ("name", "description", "stripe_product_id")
    list_select_related = ("school",)


@admin.register(ShopProductVariant)
class ShopProductVariantAdmin(admin.ModelAdmin):
    list_display = ("product", "size", "color", "stock", "sold")
    list_filter = ("product__school", "size", "color")
    search_fields = ("product__name",)
    list_select_related = ("product",)


@admin.register(ShopOrder)
class ShopOrderAdmin(admin.ModelAdmin):
    list_display = ("created_at", "student", "school", "subtotal", "discount_amount",
                    "shipping", "total", "status")
    list_filter = ("status", "school")
    search_fields = ("student__name", "student__email", "school__name", "stripe_payment_id")
    ordering = ("-created_at",)
    date_hierarchy = "created_at"
    list_select_related = ("student", "school")


@admin.register(ShopSale)
class ShopSaleAdmin(admin.ModelAdmin):
    list_display = ("created_at", "product", "student", "school", "qty", "unit_price",
                    "total", "source", "payment_method", "referrer", "referrer_commission")
    list_filter = ("source", "school", "payment_method")
    search_fields = ("product__name", "student__name", "student__email", "referrer", "notes")
    ordering = ("-created_at",)
    date_hierarchy = "created_at"
    list_select_related = ("product", "student", "school", "variant")


for _model in django_apps.get_app_config("commerce").get_models():
    try:
        admin.site.register(_model)
    except admin.sites.AlreadyRegistered:
        pass
