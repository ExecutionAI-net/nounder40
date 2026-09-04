from django.apps import apps as django_apps
from django.contrib import admin

from .models import (
    ManualCreditGrant,
    Student,
    StudentDocument,
    StudentPackage,
    StudentSubscription,
)


@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = ("name", "email", "phone", "school", "city", "country", "created_at")
    list_filter = ("school", "country", "city", "language_preference")
    search_fields = ("name", "first_name", "last_name", "email", "phone", "city", "badge")
    ordering = ("name",)
    date_hierarchy = "created_at"
    list_select_related = ("school",)
    autocomplete_fields = ("user", "school")


@admin.register(StudentPackage)
class StudentPackageAdmin(admin.ModelAdmin):
    """Il portafoglio: quanto resta e fino a quando. `credits_remaining` prima
    di `credits_total` perché è quello che si guarda davvero."""

    list_display = ("student", "school", "package", "credits_remaining", "credits_total",
                    "status", "purchased_at", "expires_at")
    list_filter = ("status", "school", "payment_method")
    search_fields = ("student__name", "student__email", "package__name_en", "package__name_it",
                     "stripe_payment_id", "stripe_subscription_id")
    ordering = ("-purchased_at",)
    date_hierarchy = "purchased_at"
    list_select_related = ("student", "school", "package")
    autocomplete_fields = ("student", "school", "package")


@admin.register(StudentSubscription)
class StudentSubscriptionAdmin(admin.ModelAdmin):
    list_display = ("student", "school", "subscription_catalog", "status",
                    "access_remaining", "started_at", "current_period_end")
    list_filter = ("status", "school")
    search_fields = ("student__name", "student__email", "stripe_subscription_id")
    ordering = ("-started_at",)
    date_hierarchy = "started_at"
    list_select_related = ("student", "school", "subscription_catalog")


@admin.register(StudentDocument)
class StudentDocumentAdmin(admin.ModelAdmin):
    list_display = ("student", "school", "type", "variant", "status",
                    "uploaded_at", "expires_at", "validated_by")
    list_filter = ("status", "school", "type", "type_ref")
    search_fields = ("student__name", "student__email", "variant", "note")
    ordering = ("-uploaded_at",)
    date_hierarchy = "uploaded_at"
    list_select_related = ("student", "school", "validated_by")


@admin.register(ManualCreditGrant)
class ManualCreditGrantAdmin(admin.ModelAdmin):
    """Crediti dati a mano: chi li ha dati e perché è metà dell'informazione."""

    list_display = ("student", "school", "amount", "package_name", "price",
                    "payment_method", "granted_by", "created_at")
    list_filter = ("school", "payment_method")
    search_fields = ("student__name", "student__email", "package_name", "reason", "note")
    ordering = ("-created_at",)
    date_hierarchy = "created_at"
    list_select_related = ("student", "school", "granted_by")


# Eventuali modelli non ancora coperti sopra restano sull'admin di default.
for _model in django_apps.get_app_config("students").get_models():
    try:
        admin.site.register(_model)
    except admin.sites.AlreadyRegistered:
        pass
