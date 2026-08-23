from datetime import timedelta

from django.db import models

from core.models import UUIDModel, UUIDTimeStampedModel


class LessonType(UUIDTimeStampedModel):
    """HQ Metodo catalog — the only lesson types schools may use."""

    code = models.CharField(max_length=60, unique=True)
    name_it = models.CharField(max_length=255, blank=True)
    name_en = models.CharField(max_length=255, blank=True)
    name_fr = models.CharField(max_length=255, blank=True)
    name_es = models.CharField(max_length=255, blank=True)
    level = models.CharField(max_length=60, blank=True)
    description_it = models.TextField(blank=True)
    description_en = models.TextField(blank=True)
    description_fr = models.TextField(blank=True)
    description_es = models.TextField(blank=True)
    image_url = models.TextField(blank=True)
    image_url_it = models.TextField(blank=True)
    image_url_en = models.TextField(blank=True)
    image_url_fr = models.TextField(blank=True)
    image_url_es = models.TextField(blank=True)
    video_url_it = models.TextField(blank=True)
    video_url_en = models.TextField(blank=True)
    video_url_fr = models.TextField(blank=True)
    video_url_es = models.TextField(blank=True)
    sort_order = models.IntegerField(null=True, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "lesson_types"
        ordering = ["sort_order", "code"]

    def __str__(self):
        return self.name_en or self.code


class Course(UUIDTimeStampedModel):
    school = models.ForeignKey("schools.School", on_delete=models.CASCADE, related_name="courses")
    lesson_type = models.ForeignKey(LessonType, on_delete=models.SET_NULL, null=True, blank=True, related_name="courses")
    teacher = models.ForeignKey("teachers.Teacher", on_delete=models.SET_NULL, null=True, blank=True, related_name="courses")
    room = models.ForeignKey("schools.SchoolRoom", on_delete=models.SET_NULL, null=True, blank=True, related_name="courses")

    name = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    frequency = models.CharField(max_length=20, default="weekly")
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    start_time = models.TimeField(null=True, blank=True)
    duration_minutes = models.IntegerField(default=60)
    max_capacity = models.IntegerField(default=10)
    reserve_spots = models.IntegerField(default=0)
    credit_cost = models.DecimalField(max_digits=5, decimal_places=1, default=1)  # half-credit steps allowed
    color = models.CharField(max_length=20, default="#6B1F3A")
    vip_booking_hours_before = models.IntegerField(default=0)
    min_booking_notice_hours = models.IntegerField(default=2)
    waitlist_enabled = models.BooleanField(default=False)
    is_online = models.BooleanField(default=False)
    # Instruction language of the course (Supabase migration 025) — serializers
    # and the student lessons ?language= filter depend on it.
    language = models.CharField(max_length=8, default="it")
    online_link = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    image_url = models.TextField(blank=True)
    sort_order = models.IntegerField(null=True, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "courses"
        ordering = ["sort_order", "created_at"]

    def __str__(self):
        return self.name or f"Course {self.id}"


class Lesson(UUIDTimeStampedModel):
    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        CANCELLED = "cancelled", "Cancelled"
        COMPLETED = "completed", "Completed"

    course = models.ForeignKey(Course, on_delete=models.SET_NULL, null=True, blank=True, related_name="lessons")
    school = models.ForeignKey("schools.School", on_delete=models.CASCADE, related_name="lessons")
    teacher = models.ForeignKey("teachers.Teacher", on_delete=models.SET_NULL, null=True, blank=True, related_name="lessons")
    room = models.ForeignKey("schools.SchoolRoom", on_delete=models.SET_NULL, null=True, blank=True, related_name="lessons")
    lesson_type = models.ForeignKey(LessonType, on_delete=models.SET_NULL, null=True, blank=True, related_name="lessons")
    compensation_plan = models.ForeignKey(
        "teachers.CompensationPlan", on_delete=models.SET_NULL, null=True, blank=True, related_name="lessons"
    )

    date = models.DateField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    max_capacity = models.IntegerField(default=10)
    current_bookings = models.IntegerField(default=0)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SCHEDULED)
    color = models.CharField(max_length=20, blank=True)
    is_online = models.BooleanField(default=False)
    online_link = models.TextField(blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        db_table = "lessons"
        indexes = [models.Index(fields=["school", "date"])]

    def __str__(self):
        return f"Lesson {self.date} {self.start_time}"


class Package(UUIDTimeStampedModel):
    # null = HQ-owned platform-wide package (spec 6.9-adjacent: HQ manages its
    # own catalog separately from each school's packages, which always set this).
    school = models.ForeignKey(
        "schools.School", on_delete=models.CASCADE, null=True, blank=True, related_name="packages"
    )
    name_it = models.CharField(max_length=255, blank=True)
    name_en = models.CharField(max_length=255, blank=True)
    name_fr = models.CharField(max_length=255, blank=True)
    name_es = models.CharField(max_length=255, blank=True)
    description_it = models.TextField(blank=True)
    description_en = models.TextField(blank=True)
    description_fr = models.TextField(blank=True)
    description_es = models.TextField(blank=True)
    credits = models.DecimalField(max_digits=6, decimal_places=1, default=10)  # half-credit steps allowed
    # Validity period: `validity_days` holds N units of `validity_unit`
    # (column name is historical — with unit "months" it holds N months).
    # Months are calendar-aware: bought Sep 15 with 3 months → valid through
    # Dec 14 (see validity_delta), because months are 28-31 days long.
    validity_days = models.IntegerField(default=90)

    class ValidityUnit(models.TextChoices):
        DAYS = "days", "Days"
        MONTHS = "months", "Months"

    validity_unit = models.CharField(max_length=10, choices=ValidityUnit.choices, default=ValidityUnit.DAYS)
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    # Legacy single-value restriction ("all" or one lesson-type id). Superseded
    # by allowed_lesson_types; kept until the old clients stop writing it.
    lesson_type_restriction = models.CharField(max_length=60, default="all")
    # Single-engine consolidation (PACKAGE_TO_SUBSCRIPTION.md): a package —
    # recurring ones are displayed as "subscriptions" — restricts bookings on
    # two dimensions plus an optional weekly cap.
    # Lesson-type ids this package may book; empty list = all types.
    allowed_lesson_types = models.JSONField(default=list, blank=True)

    class ModeFilter(models.TextChoices):
        ALL = "all", "All"
        ONLINE = "online", "Online only"
        IN_PERSON = "in_person", "In person only"

    mode_filter = models.CharField(max_length=10, choices=ModeFilter.choices, default=ModeFilter.ALL)
    # Display-only: storefront shows "Unlimited" instead of the credit number
    # (the real limit stays the expiry date + weekly cap).
    is_unlimited = models.BooleanField(default=False)
    # Max bookings per calendar week (Mon-Sun, by lesson date); null = no cap.
    weekly_booking_cap = models.IntegerField(null=True, blank=True)
    stripe_product_id = models.CharField(max_length=255, blank=True)
    stripe_price_id = models.CharField(max_length=255, blank=True)
    color = models.CharField(max_length=20, default="#6B1F3A")
    is_popular = models.BooleanField(default=False)
    is_vip = models.BooleanField(default=False)
    is_recurring = models.BooleanField(default=False)
    recurring_interval = models.CharField(max_length=20, blank=True)
    credits_rollover = models.BooleanField(default=False)
    language = models.CharField(max_length=8, default="it")
    image_url = models.TextField(blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "packages"

    def __str__(self):
        return self.name_en or self.name_it or f"Package {self.id}"

    def validity_delta(self):
        """Calendar-aware validity: N real months (Sep 15 + 3 → Dec 15, so the
        last covered day is Dec 14) or N exact days."""
        from dateutil.relativedelta import relativedelta

        if self.validity_unit == self.ValidityUnit.MONTHS:
            return relativedelta(months=self.validity_days)
        return timedelta(days=self.validity_days)


class SubscriptionCatalog(UUIDTimeStampedModel):
    class PeriodUnit(models.TextChoices):
        DAYS = "days", "Days"
        WEEKS = "weeks", "Weeks"
        MONTHS = "months", "Months"
        YEARS = "years", "Years"

    school = models.ForeignKey("schools.School", on_delete=models.CASCADE, related_name="subscriptions")
    name_it = models.CharField(max_length=255, blank=True)
    name_en = models.CharField(max_length=255, blank=True)
    name_fr = models.CharField(max_length=255, blank=True)
    name_es = models.CharField(max_length=255, blank=True)
    description_it = models.TextField(blank=True)
    description_en = models.TextField(blank=True)
    period_value = models.IntegerField(default=1)
    period_unit = models.CharField(max_length=10, choices=PeriodUnit.choices, default=PeriodUnit.MONTHS)
    access_count = models.IntegerField(null=True, blank=True)  # null = unlimited
    lesson_type_restriction = models.CharField(max_length=60, default="all")
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    auto_renewal = models.BooleanField(default=True)
    is_vip = models.BooleanField(default=False)
    is_popular = models.BooleanField(default=False)
    priority_booking_hours = models.IntegerField(default=0)
    freeze_days_allowed = models.IntegerField(default=0)
    stripe_product_id = models.CharField(max_length=255, blank=True)
    stripe_price_id = models.CharField(max_length=255, blank=True)
    color = models.CharField(max_length=20, default="#6B1F3A")
    language = models.CharField(max_length=8, default="it")
    image_url = models.TextField(blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "subscriptions_catalog"

    def __str__(self):
        return self.name_en or self.name_it or f"Subscription {self.id}"


class AttendanceStatus(UUIDTimeStampedModel):
    """School-defined attendance outcomes (migration 039)."""

    school = models.ForeignKey("schools.School", on_delete=models.CASCADE, related_name="attendance_statuses")
    name = models.CharField(max_length=120)
    color = models.CharField(max_length=20, blank=True)
    burns_credit = models.BooleanField(default=False)
    is_default = models.BooleanField(default=False)
    sort_order = models.IntegerField(default=0)

    class Meta:
        db_table = "attendance_statuses"
        ordering = ["sort_order"]

    def __str__(self):
        return self.name
