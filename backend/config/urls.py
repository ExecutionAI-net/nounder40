from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from bookings.views import BookingCreateView, BookingDetailView, MultipleBookingView
from geography.views import LocationsView
from schools.views import PublicSchoolsView
from translations.views import PlatformStatsView, TranslationsView

from .health import health_check

admin.site.site_header = "No Under 40 Administration"
admin.site.site_title = "No Under 40 Admin"
admin.site.index_title = "No Under 40 Administration"


# App API — served under /api/* to mirror the paths the frontend already calls
# (so nginx routes /api → Django and Phase 7 fetch URLs stay unchanged). Modules
# are wired in as their endpoints land (Phase 3+).
api_patterns = [
    path("", lambda request: JsonResponse({"message": "No Under 40 API", "version": "1.0.0"})),
    path("auth/", include("accounts.urls")),
    path("hq/", include("config.api_hq")),
    path("school/", include("config.api_school")),
    path("student/", include("config.api_student")),
    path("teacher/", include("config.api_teacher")),
    path("chat/", include("config.api_chat")),
    # Booking engine
    path("bookings/", BookingCreateView.as_view(), name="booking-create"),
    path("bookings/multiple/", MultipleBookingView.as_view(), name="booking-multiple"),
    path("bookings/<uuid:pk>/", BookingDetailView.as_view(), name="booking-detail"),
    # Public / shared
    path("platform-stats/", PlatformStatsView.as_view(), name="platform-stats"),
    path("translations/", TranslationsView.as_view(), name="translations"),
    path("locations/", LocationsView.as_view(), name="locations"),
    path("schools/public/", PublicSchoolsView.as_view(), name="schools-public"),
]

urlpatterns = [
    path("api/health/", health_check, name="health"),
    path("admin/", admin.site.urls),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/", include(api_patterns)),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
