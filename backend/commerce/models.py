from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.utils import timezone

from core.models import UUIDModel, UUIDTimeStampedModel


class Transaction(UUIDTimeStampedModel):
    class Type(models.TextChoices):
        PACKAGE = "package", "Package"
        SUBSCRIPTION = "subscription", "Subscription"
        VIDEO = "video", "Video"
        SHOP = "shop", "Shop"
        MANUAL = "manual", "Manual"

    class Status(models.TextChoices):
        COMPLETED = "completed", "Completed"
        PENDING = "pending", "Pending"
        REFUNDED = "refunded", "Refunded"
        FAILED = "failed", "Failed"

    school = models.ForeignKey("schools.School", on_delete=models.CASCADE, related_name="transactions")
    student = models.ForeignKey("students.Student", on_delete=models.SET_NULL, null=True, blank=True, related_name="transactions")
    type = models.CharField(max_length=20, choices=Type.choices, default=Type.PACKAGE)
    product_id = models.UUIDField(null=True, blank=True)
    product_name = models.CharField(max_length=255, blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    currency = models.CharField(max_length=8, default="eur")
    platform_fee = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    school_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    payment_method = models.CharField(max_length=30, default="stripe")
    stripe_payment_id = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    invoice_url = models.TextField(blank=True)
    referral_school = models.ForeignKey(
        "schools.School", on_delete=models.SET_NULL, null=True, blank=True, related_name="referred_transactions"
    )
    referral_commission = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = "transactions"


class DiscountCode(UUIDTimeStampedModel):
    class Type(models.TextChoices):
        PERCENTAGE = "percentage", "Percentage"
        FIXED = "fixed", "Fixed"

    school = models.ForeignKey("schools.School", on_delete=models.CASCADE, related_name="discount_codes")
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=60)
    type = models.CharField(max_length=20, choices=Type.choices, default=Type.PERCENTAGE)
    value = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    minimum_order = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    valid_for = models.CharField(max_length=20, default="all")
    expires_at = models.DateTimeField(null=True, blank=True)
    active = models.BooleanField(default=True)
    usage_count = models.IntegerField(default=0)

    class Meta:
        db_table = "discount_codes"
        constraints = [
            models.UniqueConstraint(fields=["school", "code"], name="uniq_school_discount_code")
        ]


class ShopProduct(UUIDTimeStampedModel):
    school = models.ForeignKey("schools.School", on_delete=models.CASCADE, null=True, blank=True, related_name="shop_products")
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=30, default="accessories")
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    original_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    shipping_cost = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    images = ArrayField(models.TextField(), default=list, blank=True)
    colors = ArrayField(models.CharField(max_length=60), default=list, blank=True)
    sizes = ArrayField(models.CharField(max_length=60), default=list, blank=True)
    badges = models.JSONField(default=list, blank=True)
    stripe_product_id = models.CharField(max_length=255, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "shop_products"

    def __str__(self):
        return self.name


class ShopProductVariant(UUIDTimeStampedModel):
    product = models.ForeignKey(ShopProduct, on_delete=models.CASCADE, related_name="variants")
    size = models.CharField(max_length=60, blank=True)
    color = models.CharField(max_length=60, blank=True)
    stock = models.IntegerField(default=0)
    sold = models.IntegerField(default=0)

    class Meta:
        db_table = "shop_product_variants"


class ShopOrder(UUIDTimeStampedModel):
    student = models.ForeignKey("students.Student", on_delete=models.SET_NULL, null=True, blank=True, related_name="shop_orders")
    school = models.ForeignKey("schools.School", on_delete=models.SET_NULL, null=True, blank=True, related_name="shop_orders")
    items = models.JSONField(default=list, blank=True)
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    referral_school = models.ForeignKey(
        "schools.School", on_delete=models.SET_NULL, null=True, blank=True, related_name="referred_shop_orders"
    )
    referral_discount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    shipping = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    stripe_payment_id = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, default="pending")

    class Meta:
        db_table = "shop_orders"


class ShopSale(UUIDTimeStampedModel):
    """Sale line — manual (HQ) or online-order line (migrations 046/048/052)."""

    class Source(models.TextChoices):
        MANUAL = "manual", "Manual"
        ONLINE = "online", "Online"

    product = models.ForeignKey(ShopProduct, on_delete=models.CASCADE, related_name="sales")
    variant = models.ForeignKey(ShopProductVariant, on_delete=models.SET_NULL, null=True, blank=True, related_name="sales")
    student = models.ForeignKey("students.Student", on_delete=models.SET_NULL, null=True, blank=True, related_name="shop_sales")
    school = models.ForeignKey("schools.School", on_delete=models.SET_NULL, null=True, blank=True, related_name="shop_sales")
    qty = models.IntegerField()
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    total = models.DecimalField(max_digits=10, decimal_places=2)
    size = models.CharField(max_length=60, blank=True)
    color = models.CharField(max_length=60, blank=True)
    notes = models.TextField(blank=True)
    order_id = models.UUIDField(null=True, blank=True, db_index=True)
    shipping = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.MANUAL)
    discount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    referrer = models.CharField(max_length=255, blank=True)
    referrer_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    referrer_commission = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    commission = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    payment_method = models.CharField(max_length=30, blank=True)

    class Meta:
        db_table = "shop_sales"
