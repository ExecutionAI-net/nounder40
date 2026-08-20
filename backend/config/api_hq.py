"""HQ API surface — mounted at /api/hq/."""

from django.urls import path
from rest_framework.routers import DefaultRouter

from accounts.hq_views import HQMemberViewSet, HQRoleViewSet, PendingInvitationViewSet
from catalog.image_views import LessonTypeImageUploadView, PackageImageUploadView
from catalog.views import HQPackageViewSet, LessonTypeViewSet
from commerce.report_views import HQReportsDetailedView, HQReportsView, HQTransactionsView
from commerce.views import ShopProductViewSet
from geography.views import HQCityViewSet, HQCountryViewSet
from library.views import HQLibraryContentDetailView, HQLibraryContentView
from schools.views import SchoolViewSet
from translations.views import (
    HQBrandLogoView,
    HQBrandSettingsView,
    HQDeployView,
    HQHomepageSettingsView,
    HQTranslationsAutoFillView,
    HQTranslationsView,
)

router = DefaultRouter()
router.register("lesson-types", LessonTypeViewSet, basename="hq-lesson-types")
router.register("schools", SchoolViewSet, basename="hq-schools")
router.register("shop", ShopProductViewSet, basename="hq-shop")
router.register("team", HQMemberViewSet, basename="hq-team")
router.register("permissions", HQRoleViewSet, basename="hq-permissions")
router.register("invitations", PendingInvitationViewSet, basename="hq-invitations")
router.register("packages", HQPackageViewSet, basename="hq-packages")
router.register("locations/countries", HQCountryViewSet, basename="hq-locations-countries")
router.register("locations/cities", HQCityViewSet, basename="hq-locations-cities")

urlpatterns = router.urls + [
    path("transactions/", HQTransactionsView.as_view(), name="hq-transactions"),
    path("reports/", HQReportsView.as_view(), name="hq-reports"),
    path("reports/detailed/", HQReportsDetailedView.as_view(), name="hq-reports-detailed"),
    path("packages/<uuid:pk>/image/", PackageImageUploadView.as_view(), name="hq-package-image"),
    path("lesson-types/<uuid:pk>/image/", LessonTypeImageUploadView.as_view(), name="hq-lesson-type-image"),
    path("homepage-settings/", HQHomepageSettingsView.as_view(), name="hq-homepage-settings"),
    path("brand-settings/", HQBrandSettingsView.as_view(), name="hq-brand-settings"),
    path("brand-settings/logo/", HQBrandLogoView.as_view(), name="hq-brand-logo"),
    path("translations/", HQTranslationsView.as_view(), name="hq-translations"),
    path("translations/auto-fill/", HQTranslationsAutoFillView.as_view(), name="hq-translations-auto-fill"),
    path("deploy/", HQDeployView.as_view(), name="hq-deploy"),
    path("library/", HQLibraryContentView.as_view(), name="hq-library"),
    path("library/<uuid:pk>/", HQLibraryContentDetailView.as_view(), name="hq-library-detail"),
]
