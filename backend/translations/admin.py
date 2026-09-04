from django.apps import apps as django_apps
from django.contrib import admin

from .models import PlatformSetting, Translation


def _extract(value, limit=90):
    text = " ".join((value or "").split())
    return f"{text[:limit]}…" if len(text) > limit else (text or "—")


@admin.register(Translation)
class TranslationAdmin(admin.ModelAdmin):
    """Stessa `key` per cinque locale: senza il filtro sulla lingua l'elenco è
    la stessa riga ripetuta cinque volte."""

    list_display = ("key", "locale", "value_extract", "updated_at")
    list_filter = ("locale",)
    search_fields = ("key", "value")
    ordering = ("key", "locale")

    @admin.display(description="value")
    def value_extract(self, obj):
        return _extract(obj.value)


@admin.register(PlatformSetting)
class PlatformSettingAdmin(admin.ModelAdmin):
    list_display = ("key", "value_extract", "updated_at")
    search_fields = ("key", "value")
    ordering = ("key",)

    @admin.display(description="value")
    def value_extract(self, obj):
        return _extract(obj.value)


for _model in django_apps.get_app_config("translations").get_models():
    try:
        admin.site.register(_model)
    except admin.sites.AlreadyRegistered:
        pass
