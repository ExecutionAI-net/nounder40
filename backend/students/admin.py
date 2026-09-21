from django.apps import apps as django_apps
from django.contrib import admin

from .models import (
    ManualCreditGrant,
    Student,
    StudentDocument,
    StudentPackage,
    StudentPackageExtension,
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

    def get_readonly_fields(self, request, obj=None):
        # Once the extensions ledger explains the expiry (students/extensions.py),
        # a date typed here would be overwritten by the next recompute with no
        # row saying why: the school's "extend validity" is the way to move it.
        ro = list(super().get_readonly_fields(request, obj))
        if obj is not None and obj.extensions.exists():
            ro.append("expires_at")
        return ro


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

    list_display = ("student", "school", "kind", "amount", "package_name", "price",
                    "payment_method", "granted_by", "created_at")
    list_filter = ("school", "kind", "payment_method")
    readonly_fields = ("kind", "reverses")
    search_fields = ("student__name", "student__email", "package_name", "reason", "note")
    ordering = ("-created_at",)
    date_hierarchy = "created_at"
    list_select_related = ("student", "school", "granted_by")

    def has_delete_permission(self, request, obj=None):
        # A deduction or its reversal is ledger history (students/credit_movements.py):
        # deleting the reversal would re-arm the deduction for a second one,
        # deleting the deduction would orphan the reversal.
        if obj is not None and obj.kind != ManualCreditGrant.Kind.GRANT:
            return False
        return super().has_delete_permission(request, obj)


@admin.register(StudentPackageExtension)
class StudentPackageExtensionAdmin(admin.ModelAdmin):
    """Every move of a package's expiry after purchase (students/extensions.py).
    History: edited or deleted here it would leave `expires_at` unexplained."""

    list_display = ("student_package", "school", "kind", "days", "period_start", "period_end",
                    "expires_before", "expires_after", "created_by", "created_at", "revoked_at")
    list_filter = ("school", "kind")
    search_fields = ("student_package__student__name", "student_package__student__email", "note")
    ordering = ("-created_at",)
    date_hierarchy = "created_at"
    list_select_related = ("student_package__student", "school", "created_by")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


# Eventuali modelli non ancora coperti sopra restano sull'admin di default.
for _model in django_apps.get_app_config("students").get_models():
    try:
        admin.site.register(_model)
    except admin.sites.AlreadyRegistered:
        pass
