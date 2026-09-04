from django.apps import apps as django_apps
from django.contrib import admin

from .models import Attendance, Booking


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    """`access_source` + `credits_deducted` + `credit_refunded` raccontano
    insieme la storia economica della prenotazione: da dove è stata pagata,
    quanto è costata, se l'annullamento ha restituito il credito."""

    list_display = ("booked_at", "student", "lesson", "school", "status",
                    "access_source", "credits_deducted", "credit_refunded", "cancelled_at")
    list_filter = ("status", "access_source", "credit_refunded", "cancellation_type", "school")
    search_fields = ("student__name", "student__email", "school__name", "lesson__course__name")
    ordering = ("-booked_at",)
    date_hierarchy = "booked_at"
    list_select_related = ("student", "lesson", "school")


@admin.register(Attendance)
class AttendanceAdmin(admin.ModelAdmin):
    list_display = ("marked_at", "student", "lesson", "teacher", "status", "status_ref")
    list_filter = ("status", "status_ref", "lesson__school")
    search_fields = ("student__name", "student__email", "teacher__name", "lesson__course__name")
    ordering = ("-marked_at",)
    date_hierarchy = "marked_at"
    list_select_related = ("student", "lesson", "teacher", "status_ref")


for _model in django_apps.get_app_config("bookings").get_models():
    try:
        admin.site.register(_model)
    except admin.sites.AlreadyRegistered:
        pass
