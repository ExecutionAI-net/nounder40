from django.conf import settings
from django.db import models

from core.models import UUIDModel, UUIDTimeStampedModel


class Teacher(UUIDTimeStampedModel):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="teacher"
    )
    name = models.CharField(max_length=255)
    email = models.EmailField()
    phone = models.CharField(max_length=40, blank=True)
    address = models.CharField(max_length=255, blank=True)
    bio = models.TextField(blank=True)
    photo_url = models.TextField(blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "teachers"

    def __str__(self):
        return self.name


class CompensationPlan(UUIDTimeStampedModel):
    school = models.ForeignKey("schools.School", on_delete=models.CASCADE, related_name="compensation_plans")
    name = models.CharField(max_length=255)
    base_fee = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    bonus_threshold = models.IntegerField(null=True, blank=True)
    bonus_per_student = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    bonus_max_threshold = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = "compensation_plans"

    def __str__(self):
        return self.name


class CompensationPlanRate(UUIDModel):
    plan = models.ForeignKey(CompensationPlan, on_delete=models.CASCADE, related_name="rates")
    lesson_type = models.ForeignKey("catalog.LessonType", on_delete=models.CASCADE, related_name="+")
    base_fee = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    bonus_per_student = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = "compensation_plan_rates"
        constraints = [
            models.UniqueConstraint(fields=["plan", "lesson_type"], name="uniq_plan_lesson_type_rate")
        ]


class TeacherSchool(models.Model):
    teacher = models.ForeignKey(Teacher, on_delete=models.CASCADE, related_name="school_links")
    school = models.ForeignKey("schools.School", on_delete=models.CASCADE, related_name="teacher_links")
    compensation_plan = models.ForeignKey(
        CompensationPlan, on_delete=models.SET_NULL, null=True, blank=True, related_name="teacher_links"
    )
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "teacher_schools"
        constraints = [
            models.UniqueConstraint(fields=["teacher", "school"], name="uniq_teacher_school")
        ]


class TeacherCompensationPayment(UUIDTimeStampedModel):
    school = models.ForeignKey("schools.School", on_delete=models.CASCADE, related_name="compensation_payments")
    teacher = models.ForeignKey(Teacher, on_delete=models.CASCADE, related_name="compensation_payments")
    month = models.CharField(max_length=7)  # 'YYYY-MM'
    amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    status = models.CharField(max_length=20, default="pending")
    paid_at = models.DateTimeField(null=True, blank=True)
    note = models.TextField(blank=True)

    class Meta:
        db_table = "teacher_compensation_payments"
        constraints = [
            models.UniqueConstraint(fields=["school", "teacher", "month"], name="uniq_teacher_month_payment")
        ]
