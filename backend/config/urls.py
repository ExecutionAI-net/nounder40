from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path, re_path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from bookings.views import BookingCreateView, BookingDetailView, MultipleBookingView
from catalog.ical_views import SchoolICalView, StudentICalView
from catalog.views import PublicUpcomingLessonsView
from commerce.stripe_views import (
    BillingPortalView,
    CheckoutView,
    InvoicesView,
    OnboardStatusView,
    OnboardView,
    RefundView,
    StripeWebhookView,
    VerifySessionView,
)
from geography.views import LocationsView
from schools.views import PublicSchoolsView, SchoolDocumentTypesPublicView
from students.document_views import DocumentDetailView, DocumentFileView, DocumentUploadView
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
    # Documents (private storage — see core/storage.py)
    path("documents/upload/", DocumentUploadView.as_view(), name="documents-upload"),
    path("documents/<uuid:pk>/", DocumentDetailView.as_view(), name="documents-detail"),
    path("documents/<uuid:pk>/file/", DocumentFileView.as_view(), name="documents-file"),
    # Stripe (Phase 6)
    path("stripe/checkout/", CheckoutView.as_view(), name="stripe-checkout"),
    path("stripe/invoices/", InvoicesView.as_view(), name="stripe-invoices"),
    path("stripe/portal/", BillingPortalView.as_view(), name="stripe-portal"),
    path("stripe/verify-session/", VerifySessionView.as_view(), name="stripe-verify-session"),
    path("stripe/onboard/", OnboardView.as_view(), name="stripe-onboard"),
    path("stripe/onboard/status/", OnboardStatusView.as_view(), name="stripe-onboard-status"),
    path("stripe/refund/", RefundView.as_view(), name="stripe-refund"),
    path("webhooks/stripe/", StripeWebhookView.as_view(), name="stripe-webhook"),
    # Public / shared
    path("platform-stats/", PlatformStatsView.as_view(), name="platform-stats"),
    path("translations/", TranslationsView.as_view(), name="translations"),
    path("locations/", LocationsView.as_view(), name="locations"),
    path("schools/public/", PublicSchoolsView.as_view(), name="schools-public"),
    path(
        "lessons/public/upcoming/",
        PublicUpcomingLessonsView.as_view(),
        name="lessons-public-upcoming",
    ),
    path(
        "schools/<uuid:school_id>/document-types/",
        SchoolDocumentTypesPublicView.as_view(),
        name="schools-document-types-public",
    ),
    # iCal feeds (public, token/id is the access key — no auth)
    re_path(
        r"^calendar/student/(?P<token>[0-9a-f-]{36})\.ics$",
        StudentICalView.as_view(),
        name="calendar-student-ics",
    ),
    re_path(r"^calendar/(?P<school_id>[0-9a-f-]{36})\.ics$", SchoolICalView.as_view(), name="calendar-school-ics"),
]

urlpatterns = [
    path("api/health/", health_check, name="health"),
    path("admin/", admin.site.urls),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/", include(api_patterns)),
]

if settings.DEBUG:
    # Only the public tree is ever directly servable — private/ has no URL route
    # at all (see core/storage.py), so a guessed path 404s instead of leaking.
    import os

    urlpatterns += static(
        settings.MEDIA_URL + "public/", document_root=os.path.join(settings.MEDIA_ROOT, "public")
    )
