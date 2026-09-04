from django.apps import apps as django_apps
from django.contrib import admin

from .models import EmailSetting, EmailTemplate, Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    """Il filtro su `read_at` è quello che serve davvero: separa le notifiche
    ancora da leggere da quelle già viste."""

    list_display = ("created_at", "user", "user_role", "type", "title", "read_at")
    list_filter = ("user_role", "type", "read_at")
    search_fields = ("title", "body", "user__email")
    ordering = ("-created_at",)
    date_hierarchy = "created_at"
    list_select_related = ("user",)


@admin.register(EmailTemplate)
class EmailTemplateAdmin(admin.ModelAdmin):
    """`school` vuoto = template di default della piattaforma."""

    list_display = ("key", "locale", "school", "subject", "updated_at")
    list_filter = ("locale", "school")
    search_fields = ("key", "subject", "body_html")
    ordering = ("key", "locale")
    list_select_related = ("school",)


@admin.register(EmailSetting)
class EmailSettingAdmin(admin.ModelAdmin):
    list_display = ("key", "value", "updated_at")
    search_fields = ("key", "value")
    ordering = ("key",)


for _model in django_apps.get_app_config("notifications").get_models():
    try:
        admin.site.register(_model)
    except admin.sites.AlreadyRegistered:
        pass
