import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import UUIDModel, UUIDTimeStampedModel


class Student(UUIDTimeStampedModel):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="student")
    # Private token for the personal iCal feed (GET /api/calendar/student/<token>.ics),
    # same pattern as School.ical_token. Not in the original migrations — added
    # here because the feature (and its API route) requires it.
    ical_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    name = models.CharField(max_length=255, blank=True)
    # Nome e cognome separati (per Carlo); name resta il display composto
    first_name = models.CharField(max_length=120, blank=True)
    last_name = models.CharField(max_length=120, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=40, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    address = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=120, blank=True)
    country = models.CharField(max_length=120, blank=True)
    language_preference = models.CharField(max_length=8, default="en")
    badge = models.CharField(max_length=60, blank=True)
    # Default/last active school (migration 021); per-school wallets live on SchoolStudent.
    school = models.ForeignKey(
        "schools.School", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        db_table = "students"

    def save(self, *args, **kwargs):
        # first/last presenti → name è sempre la loro composizione; se il
        # save è parziale (update_fields) il nome ricomposto va incluso
        composed = f"{self.first_name} {self.last_name}".strip()
        if composed:
            self.name = composed
            if kwargs.get("update_fields") is not None:
                kwargs["update_fields"] = list(set(kwargs["update_fields"]) | {"name"})
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name or self.email


class StudentPackage(UUIDTimeStampedModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        EXPIRED = "expired", "Expired"
        EXHAUSTED = "exhausted", "Exhausted"

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="packages")
    school = models.ForeignKey("schools.School", on_delete=models.CASCADE, related_name="student_packages")
    package = models.ForeignKey("catalog.Package", on_delete=models.SET_NULL, null=True, blank=True, related_name="purchases")
    credits_total = models.DecimalField(max_digits=6, decimal_places=1, default=0)
    credits_remaining = models.DecimalField(max_digits=6, decimal_places=1, default=0)
    purchased_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(null=True, blank=True)
    payment_method = models.CharField(max_length=30, default="stripe")
    stripe_payment_id = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    # Buy-ahead: validity window opens here instead of at purchase (null =
    # active immediately). The booking engine checks the window against the
    # LESSON's date, so a package for next month can be bought — and next
    # month's lessons booked — before the current one expires.
    starts_at = models.DateTimeField(null=True, blank=True)
    # Recurring package fields (migration 028)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    next_renewal_at = models.DateTimeField(null=True, blank=True)
    stripe_customer_id = models.CharField(max_length=255, blank=True)
    stripe_subscription_id = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "student_packages"


class StudentSubscription(UUIDTimeStampedModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        GRACE_PERIOD = "grace_period", "Grace period"
        SUSPENDED = "suspended", "Suspended"
        CANCELLED = "cancelled", "Cancelled"

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="subscriptions")
    school = models.ForeignKey("schools.School", on_delete=models.CASCADE, related_name="student_subscriptions")
    subscription_catalog = models.ForeignKey(
        "catalog.SubscriptionCatalog", on_delete=models.SET_NULL, null=True, blank=True, related_name="subscribers"
    )
    access_total = models.IntegerField(null=True, blank=True)
    access_remaining = models.IntegerField(null=True, blank=True)
    started_at = models.DateTimeField(default=timezone.now)
    current_period_end = models.DateTimeField(null=True, blank=True)
    grace_period_ends_at = models.DateTimeField(null=True, blank=True)
    stripe_subscription_id = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)

    class Meta:
        db_table = "student_subscriptions"


class StudentDocument(UUIDModel):
    class Status(models.TextChoices):
        VALID = "valid", "Valid"
        EXPIRING = "expiring", "Expiring"
        EXPIRED = "expired", "Expired"

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="documents")
    school = models.ForeignKey("schools.School", on_delete=models.CASCADE, related_name="student_documents")
    type = models.CharField(max_length=60, default="medical_cert")
    type_ref = models.ForeignKey(
        "schools.SchoolDocumentType", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="documents", db_column="type_id",
    )
    variant = models.CharField(max_length=120, blank=True)
    file_url = models.TextField(blank=True)
    # Private-bucket attachments: [{path,name,mime,size}] (migration 060)
    files = models.JSONField(default=list, blank=True)
    note = models.TextField(blank=True)
    uploaded_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.VALID)
    validated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    validated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "student_documents"


class ManualCreditGrant(UUIDTimeStampedModel):
    """Cash/manual credit assignment log (migration 039)."""

    school = models.ForeignKey("schools.School", on_delete=models.CASCADE, related_name="credit_grants")
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="credit_grants")
    package = models.ForeignKey(StudentPackage, on_delete=models.SET_NULL, null=True, blank=True, related_name="grants")
    package_name = models.CharField(max_length=255, blank=True)
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    amount = models.DecimalField(max_digits=6, decimal_places=1)
    reason = models.TextField(blank=True)
    note = models.TextField(blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    payment_method = models.CharField(max_length=30, blank=True)

    class Meta:
        db_table = "manual_credit_grants"
