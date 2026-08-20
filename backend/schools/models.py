import uuid

from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.utils import timezone

from core.models import UUIDModel, UUIDTimeStampedModel


class School(UUIDTimeStampedModel):
    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=255, unique=True)
    email = models.EmailField()
    phone = models.CharField(max_length=40, blank=True)

    address = models.CharField(max_length=255, blank=True)
    address_line2 = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=120, blank=True)
    province = models.CharField(max_length=120, blank=True)
    country = models.CharField(max_length=120, blank=True)
    website = models.CharField(max_length=255, blank=True)
    vat_number = models.CharField(max_length=60, blank=True)
    logo_url = models.TextField(blank=True)

    active = models.BooleanField(default=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="owned_schools"
    )

    # Billing / Stripe Connect
    platform_fee_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=10)
    shop_commission_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    stripe_account_id = models.CharField(max_length=255, blank=True)
    stripe_onboarding_complete = models.BooleanField(default=False)
    grace_period_days = models.IntegerField(default=7)
    free_trial_ends_at = models.DateTimeField(null=True, blank=True)

    # Booking / policy config
    cancellation_policy_hours = models.IntegerField(default=24)
    min_booking_notice_hours = models.IntegerField(default=2)
    free_first_lesson = models.BooleanField(default=False)
    show_teacher_to_students = models.BooleanField(default=True)
    block_booking_on_documents = models.BooleanField(default=False)

    ical_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    language = models.CharField(max_length=8, default="it")

    class Meta:
        db_table = "schools"

    def __str__(self):
        return self.name


class SchoolLocation(UUIDTimeStampedModel):
    school = models.ForeignKey(School, on_delete=models.CASCADE, related_name="locations")
    name = models.CharField(max_length=255)
    address = models.CharField(max_length=255, blank=True)
    google_maps_url = models.TextField(blank=True)
    phone = models.CharField(max_length=40, blank=True)

    class Meta:
        db_table = "school_locations"

    def __str__(self):
        return self.name


class SchoolRoom(UUIDTimeStampedModel):
    location = models.ForeignKey(SchoolLocation, on_delete=models.CASCADE, related_name="rooms")
    name = models.CharField(max_length=255)
    capacity = models.IntegerField(default=10)
    cost = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    class Meta:
        db_table = "school_rooms"

    def __str__(self):
        return self.name


class SchoolMembership(models.Model):
    """A school-role user can belong to several schools (migration 034)."""

    profile = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="school_memberships"
    )
    school = models.ForeignKey(School, on_delete=models.CASCADE, related_name="memberships")
    sub_role = models.CharField(max_length=40, default="admin")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "school_memberships"
        constraints = [
            models.UniqueConstraint(fields=["profile", "school"], name="uniq_school_membership")
        ]


class SchoolStudent(UUIDModel):
    """Enrollment link between a student and a school (per-school wallets)."""

    school = models.ForeignKey(School, on_delete=models.CASCADE, related_name="student_links")
    student = models.ForeignKey("students.Student", on_delete=models.CASCADE, related_name="school_links")
    free_lesson_used = models.BooleanField(default=False)
    enrolled_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "school_students"
        constraints = [
            models.UniqueConstraint(fields=["school", "student"], name="uniq_school_student")
        ]


class SchoolClosure(UUIDModel):
    class Kind(models.TextChoices):
        FULL_DAY = "full_day", "Full day"
        PARTIAL = "partial", "Partial"

    school = models.ForeignKey(School, on_delete=models.CASCADE, related_name="closures")
    date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    type = models.CharField(max_length=20, choices=Kind.choices, default=Kind.FULL_DAY)
    from_time = models.TimeField(null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        db_table = "school_closures"
        constraints = [
            models.UniqueConstraint(fields=["school", "date"], name="uniq_school_closure_date")
        ]


class SchoolDocumentType(UUIDTimeStampedModel):
    """School-defined required document types (migration 060)."""

    school = models.ForeignKey(School, on_delete=models.CASCADE, related_name="document_types")
    code = models.CharField(max_length=60)
    name = models.CharField(max_length=255)
    variants = ArrayField(models.CharField(max_length=120), default=list, blank=True)
    has_expiry = models.BooleanField(default=True)
    required = models.BooleanField(default=False)
    sort_order = models.IntegerField(default=0)
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "school_document_types"
        constraints = [
            models.UniqueConstraint(fields=["school", "code"], name="uniq_school_doctype_code")
        ]

    def __str__(self):
        return self.name
