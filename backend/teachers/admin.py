from django.apps import apps as django_apps
from django.contrib import admin

from .models import (
    CompensationPlan,
    CompensationPlanRate,
    Teacher,
    TeacherCompensationPayment,
    TeacherSchool,
)


@admin.register(Teacher)
class TeacherAdmin(admin.ModelAdmin):
    """L'insegnante non ha una scuola: ne ha N, via TeacherSchool. Senza la
    colonna qui sotto l'elenco non dice per chi lavora nessuno."""

    list_display = ("name", "email", "phone", "schools", "active", "created_at")
    list_filter = ("active", "school_links__school")
    search_fields = ("name", "first_name", "last_name", "email", "phone")
    ordering = ("name",)

    def get_queryset(self, request):
        return super().get_queryset(request).prefetch_related("school_links__school")

    @admin.display(description="schools")
    def schools(self, obj):
        names = [link.school.name for link in obj.school_links.all() if link.active]
        return ", ".join(names) or "—"


@admin.register(TeacherSchool)
class TeacherSchoolAdmin(admin.ModelAdmin):
    list_display = ("teacher", "school", "compensation_plan", "active")
    list_filter = ("active", "school")
    search_fields = ("teacher__name", "teacher__email", "school__name")
    list_select_related = ("teacher", "school", "compensation_plan")


@admin.register(CompensationPlan)
class CompensationPlanAdmin(admin.ModelAdmin):
    list_display = ("name", "school", "base_fee", "bonus_threshold", "bonus_per_student",
                    "rate_count", "created_at")
    list_filter = ("school",)
    search_fields = ("name", "school__name")
    list_select_related = ("school",)

    @admin.display(description="rates per lesson type")
    def rate_count(self, obj):
        return obj.rates.count()


@admin.register(CompensationPlanRate)
class CompensationPlanRateAdmin(admin.ModelAdmin):
    list_display = ("plan", "lesson_type", "base_fee", "bonus_per_student")
    list_filter = ("plan__school", "lesson_type")
    search_fields = ("plan__name", "lesson_type__code", "lesson_type__name_en")
    list_select_related = ("plan", "lesson_type")


@admin.register(TeacherCompensationPayment)
class TeacherCompensationPaymentAdmin(admin.ModelAdmin):
    list_display = ("month", "teacher", "school", "amount", "status", "paid_at", "payment_method")
    list_filter = ("status", "school", "month", "payment_method")
    search_fields = ("teacher__name", "teacher__email", "school__name", "note")
    ordering = ("-month", "teacher__name")
    list_select_related = ("teacher", "school")


for _model in django_apps.get_app_config("teachers").get_models():
    try:
        admin.site.register(_model)
    except admin.sites.AlreadyRegistered:
        pass
