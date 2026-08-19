from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from .health import health_check

admin.site.site_header = "No Under 40 Administration"
admin.site.site_title = "No Under 40 Admin"
admin.site.index_title = "No Under 40 Administration"


# API v1 — modules are wired in as their endpoints land (Phase 2+).
api_v1_patterns = [
    path("", lambda request: JsonResponse({"message": "No Under 40 API", "version": "1.0.0"})),
    # path("accounts/", include("accounts.urls")),
    # path("schools/", include("schools.urls")),
    # ...
]

urlpatterns = [
    path("api/health/", health_check, name="health"),
    path("admin/", admin.site.urls),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/v1/", include((api_v1_patterns, "api-v1"))),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
