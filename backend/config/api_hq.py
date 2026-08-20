"""HQ API surface — mounted at /api/hq/."""

from django.urls import path
from rest_framework.routers import DefaultRouter

from accounts.hq_views import HQMemberViewSet, HQRoleViewSet, PendingInvitationViewSet
from catalog.image_views import LessonTypeImageUploadView, PackageImageUploadView
from catalog.views import HQPackageViewSet, LessonTypeViewSet
from commerce.report_views import HQReportsView, HQTransactionsView
from commerce.views import ShopProductViewSet
from schools.views import SchoolViewSet
from translations.views import HQBrandLogoView, HQBrandSettingsView, HQHomepageSettingsView

router = DefaultRouter()
router.register("lesson-types", LessonTypeViewSet, basename="hq-lesson-types")
router.register("schools", SchoolViewSet, basename="hq-schools")
router.register("shop", ShopProductViewSet, basename="hq-shop")
router.register("team", HQMemberViewSet, basename="hq-team")
router.register("permissions", HQRoleViewSet, basename="hq-permissions")
router.register("invitations", PendingInvitationViewSet, basename="hq-invitations")
router.register("packages", HQPackageViewSet, basename="hq-packages")

urlpatterns = router.urls + [
    path("transactions/", HQTransactionsView.as_view(), name="hq-transactions"),
    path("reports/", HQReportsView.as_view(), name="hq-reports"),
    path("packages/<uuid:pk>/image/", PackageImageUploadView.as_view(), name="hq-package-image"),
    path("lesson-types/<uuid:pk>/image/", LessonTypeImageUploadView.as_view(), name="hq-lesson-type-image"),
    path("homepage-settings/", HQHomepageSettingsView.as_view(), name="hq-homepage-settings"),
    path("brand-settings/", HQBrandSettingsView.as_view(), name="hq-brand-settings"),
    path("brand-settings/logo/", HQBrandLogoView.as_view(), name="hq-brand-logo"),
]
