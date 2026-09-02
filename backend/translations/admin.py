from django.apps import apps as django_apps
from django.contrib import admin

# Register every model in this app with the default admin so HQ has CRUD in
# Phase 1. Richer ModelAdmins are layered in as each panel is built.
for _model in django_apps.get_app_config("translations").get_models():
    try:
        admin.site.register(_model)
    except admin.sites.AlreadyRegistered:
        pass
