from django.db import models
from django.utils import timezone

from core.models import UUIDModel


class Booking(UUIDModel):
    class AccessSource(models.TextChoices):
        SUBSCRIPTION = "subscription", "Subscription"
        PACKAGE = "package", "Package"
        FREE_LESSON = "free_lesson", "Free lesson"

    class Status(models.TextChoices):
        CONFIRMED = "confirmed", "Confirmed"
        CANCELLED = "cancelled", "Cancelled"
        ATTENDED = "attended", "Attended"
        NO_SHOW = "no_show", "No-show"

    class CancellationType(models.TextChoices):
        WITHIN_POLICY = "within_policy", "Within policy"
        OUTSIDE_POLICY = "outside_policy", "Outside policy"

    student = models.ForeignKey("students.Student", on_delete=models.CASCADE, related_name="bookings")
    lesson = models.ForeignKey("catalog.Lesson", on_delete=models.CASCADE, related_name="bookings")
    school = models.ForeignKey("schools.School", on_delete=models.CASCADE, related_name="bookings")

    access_source = models.CharField(max_length=20, choices=AccessSource.choices, default=AccessSource.PACKAGE)
    student_package = models.ForeignKey(
        "students.StudentPackage", on_delete=models.SET_NULL, null=True, blank=True, related_name="bookings"
    )
    student_subscription = models.ForeignKey(
        "students.StudentSubscription", on_delete=models.SET_NULL, null=True, blank=True, related_name="bookings"
    )
    # Half-credit granularity (e.g. a 1.5-credit lesson) — decimal, not float.
    credits_deducted = models.DecimalField(max_digits=6, decimal_places=1, default=0)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.CONFIRMED)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancellation_type = models.CharField(max_length=20, choices=CancellationType.choices, blank=True)
    credit_refunded = models.BooleanField(default=False)
    booked_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "bookings"
        indexes = [models.Index(fields=["lesson"]), models.Index(fields=["student"])]


class Attendance(UUIDModel):
    class Status(models.TextChoices):
        PRESENT = "present", "Present"
        NO_SHOW = "no_show", "No-show"

    lesson = models.ForeignKey("catalog.Lesson", on_delete=models.CASCADE, related_name="attendance")
    booking = models.ForeignKey(Booking, on_delete=models.SET_NULL, null=True, blank=True, related_name="attendance")
    student = models.ForeignKey("students.Student", on_delete=models.CASCADE, related_name="attendance")
    teacher = models.ForeignKey("teachers.Teacher", on_delete=models.SET_NULL, null=True, blank=True, related_name="attendance")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PRESENT)
    status_ref = models.ForeignKey(
        "catalog.AttendanceStatus", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="attendance", db_column="status_id",
    )
    marked_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "attendance"
        constraints = [
            models.UniqueConstraint(fields=["lesson", "student"], name="uniq_attendance_lesson_student")
        ]
