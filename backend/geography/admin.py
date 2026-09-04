from django.apps import apps as django_apps
from django.contrib import admin
from django.db.models import Count

from .models import HQCity, HQCountry


@admin.register(HQCountry)
class HQCountryAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "city_count", "created_at")
    search_fields = ("name", "code")
    ordering = ("name",)

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(_cities=Count("cities"))

    @admin.display(description="cities", ordering="_cities")
    def city_count(self, obj):
        return obj._cities


@admin.register(HQCity)
class HQCityAdmin(admin.ModelAdmin):
    list_display = ("name", "country", "created_at")
    list_filter = ("country",)
    search_fields = ("name", "country__name", "country__code")
    ordering = ("country__name", "name")
    list_select_related = ("country",)


for _model in django_apps.get_app_config("geography").get_models():
    try:
        admin.site.register(_model)
    except admin.sites.AlreadyRegistered:
        pass
