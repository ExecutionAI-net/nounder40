"""
URL configuration for core project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path

from legacy_db.views import health, whoami
from legacy_db.translations import translations
from legacy_db.quick_replies import quick_replies
from legacy_db.locations import (
    locations_list, countries_create, countries_delete, cities_create, cities_delete,
)
from legacy_db.library import teacher_library_list, hq_library_list, hq_library_detail
from legacy_db.platform_settings import platform_settings
from legacy_db.rooms import rooms_list, rooms_detail

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/health', health),
    path('api/whoami', whoami),
    path('api/translations', translations),
    path('api/chat/quick-replies', quick_replies),
    path('api/locations', locations_list),
    path('api/hq/locations/countries', countries_create),
    path('api/hq/locations/countries/<uuid:id>', countries_delete),
    path('api/hq/locations/cities', cities_create),
    path('api/hq/locations/cities/<uuid:id>', cities_delete),
    path('api/teacher/library', teacher_library_list),
    path('api/hq/library', hq_library_list),
    path('api/hq/library/<uuid:id>', hq_library_detail),
    path('api/platform-settings', platform_settings),
    path('api/school/rooms', rooms_list),
    path('api/school/rooms/<uuid:id>', rooms_detail),
]
