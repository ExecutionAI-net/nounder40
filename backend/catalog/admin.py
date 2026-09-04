from django.apps import apps as django_apps
from django.contrib import admin

from .models import (
    AttendanceStatus,
    Course,
    Lesson,
    LessonType,
    Package,
    SubscriptionCatalog,
)


@admin.register(LessonType)
class LessonTypeAdmin(admin.ModelAdmin):
    list_display = ("code", "name_en", "name_it", "level", "sort_order", "active")
    list_filter = ("active", "level")
    search_fields = ("code", "name_en", "name_it", "name_fr", "name_es")


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):
    list_display = ("name", "school", "lesson_type", "teacher", "start_date", "end_date",
                    "start_time", "max_capacity", "credit_cost", "is_online", "active")
    list_filter = ("active", "school", "lesson_type", "is_online", "frequency", "language")
    search_fields = ("name", "description", "school__name", "teacher__name", "lesson_type__code")
    date_hierarchy = "start_date"
    list_select_related = ("school", "lesson_type", "teacher")


@admin.register(Lesson)
class LessonAdmin(admin.ModelAdmin):
    """`current_bookings` accanto a `max_capacity`: da soli non dicono nulla,
    insieme dicono se la lezione è piena."""

    list_display = ("date", "start_time", "end_time", "school", "course", "teacher",
                    "status", "current_bookings", "max_capacity", "is_online")
    list_filter = ("status", "school", "is_online", "lesson_type", "date")
    search_fields = ("course__name", "school__name", "teacher__name", "notes")
    ordering = ("-date", "-start_time")
    date_hierarchy = "date"
    list_select_related = ("school", "course", "teacher")


@admin.register(Package)
class PackageAdmin(admin.ModelAdmin):
    """`school` vuoto = pacchetto di HQ, valido su tutta la rete."""

    list_display = ("name_en", "school", "credits", "price", "validity_days", "validity_unit",
                    "is_recurring", "is_vip", "sort_order", "active")
    list_filter = ("active", "school", "is_recurring", "is_vip", "is_popular", "is_drop_in",
                   "is_unlimited", "mode_filter")
    search_fields = ("name_en", "name_it", "name_fr", "name_es",
                     "stripe_product_id", "stripe_price_id")


@admin.register(SubscriptionCatalog)
class SubscriptionCatalogAdmin(admin.ModelAdmin):
    list_display = ("name_en", "school", "price", "period_value", "period_unit",
                    "access_count", "auto_renewal", "active")
    list_filter = ("active", "school", "period_unit", "auto_renewal", "is_vip")
    search_fields = ("name_en", "name_it", "stripe_product_id", "stripe_price_id")
    list_select_related = ("school",)


@admin.register(AttendanceStatus)
class AttendanceStatusAdmin(admin.ModelAdmin):
    """`burns_credit` è la colonna che conta: decide se la presenza consuma
    credito (vedi la regola d'insieme in CLAUDE.md §4.5)."""

    list_display = ("name", "school", "burns_credit", "is_default", "sort_order")
    list_filter = ("school", "burns_credit", "is_default")
    search_fields = ("name", "school__name")
    list_select_related = ("school",)


for _model in django_apps.get_app_config("catalog").get_models():
    try:
        admin.site.register(_model)
    except admin.sites.AlreadyRegistered:
        pass
