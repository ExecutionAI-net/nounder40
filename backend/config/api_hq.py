"""HQ API surface — mounted at /api/hq/."""

from django.urls import path
from rest_framework.routers import DefaultRouter

from accounts.hq_views import HQMemberViewSet, HQRoleViewSet, PendingInvitationViewSet
from catalog.image_views import LessonTypeImageUploadView, PackageImageUploadView
from catalog.views import HQPackageViewSet, LessonTypeViewSet
from commerce.report_views import HQReportsDetailedView, HQReportsView, HQTransactionsView
from commerce.shop_admin_views import HQShopImagesView, HQShopSalesView, HQShopVariantsView
from commerce.views import HQDiscountCodeViewSet, ShopProductViewSet
from library.views import HQLibraryContentDetailView, HQLibraryContentView
from notifications.views import (
    HQEmailSettingsView,
    HQEmailTemplateAutoTranslateView,
    HQEmailTemplateImageUploadView,
    HQEmailTemplatesView,
    HQEmailTemplateTestSendView,
)
from schools.views import HQSchoolRoleViewSet, SchoolViewSet
from students.views import HQStudentsListView
from translations.views import (
    HQBrandLogoView,
    HQBrandSettingsView,
    HQDeployView,
    HQHomepageSettingsView,
    HQStudentCreditsVisibilityView,
    HQHomepageRealStatsView,
    HQStudentShopVisibilityView,
    HQTranslationsAutoFillView,
    HQTranslationsView,
)

router = DefaultRouter()
router.register("lesson-types", LessonTypeViewSet, basename="hq-lesson-types")
router.register("schools", SchoolViewSet, basename="hq-schools")
router.register("shop", ShopProductViewSet, basename="hq-shop")
router.register("discount-codes", HQDiscountCodeViewSet, basename="hq-discount-codes")
router.register("team", HQMemberViewSet, basename="hq-team")
router.register("permissions", HQRoleViewSet, basename="hq-permissions")
router.register("school-permissions", HQSchoolRoleViewSet, basename="hq-school-permissions")
router.register("invitations", PendingInvitationViewSet, basename="hq-invitations")
router.register("packages", HQPackageViewSet, basename="hq-packages")

urlpatterns = router.urls + [
    path("transactions/", HQTransactionsView.as_view(), name="hq-transactions"),
    path("reports/", HQReportsView.as_view(), name="hq-reports"),
    path("reports/detailed/", HQReportsDetailedView.as_view(), name="hq-reports-detailed"),
    path("packages/<uuid:pk>/image/", PackageImageUploadView.as_view(), name="hq-package-image"),
    path("lesson-types/<uuid:pk>/image/", LessonTypeImageUploadView.as_view(), name="hq-lesson-type-image"),
    path("homepage-settings/", HQHomepageSettingsView.as_view(), name="hq-homepage-settings"),
    path("homepage-real-stats/", HQHomepageRealStatsView.as_view(), name="hq-homepage-real-stats"),
    path("brand-settings/", HQBrandSettingsView.as_view(), name="hq-brand-settings"),
    path("brand-settings/logo/", HQBrandLogoView.as_view(), name="hq-brand-logo"),
    path("student-shop-visibility/", HQStudentShopVisibilityView.as_view(), name="hq-student-shop-visibility"),
    path("student-credits-visibility/", HQStudentCreditsVisibilityView.as_view(), name="hq-student-credits-visibility"),
    path("translations/", HQTranslationsView.as_view(), name="hq-translations"),
    path("translations/auto-fill/", HQTranslationsAutoFillView.as_view(), name="hq-translations-auto-fill"),
    path("deploy/", HQDeployView.as_view(), name="hq-deploy"),
    path("library/", HQLibraryContentView.as_view(), name="hq-library"),
    path("library/<uuid:pk>/", HQLibraryContentDetailView.as_view(), name="hq-library-detail"),
    path("email-templates/", HQEmailTemplatesView.as_view(), name="hq-email-templates"),
    path("email-templates/image/", HQEmailTemplateImageUploadView.as_view(), name="hq-email-templates-image"),
    path(
        "email-templates/auto-translate/",
        HQEmailTemplateAutoTranslateView.as_view(),
        name="hq-email-templates-auto-translate",
    ),
    path("email-templates/test-send/", HQEmailTemplateTestSendView.as_view(), name="hq-email-templates-test-send"),
    path("email-settings/", HQEmailSettingsView.as_view(), name="hq-email-settings"),
    path("shop/<uuid:pk>/variants/", HQShopVariantsView.as_view(), name="hq-shop-variants"),
    path("shop/<uuid:pk>/images/", HQShopImagesView.as_view(), name="hq-shop-images"),
    # Distinct prefix (not shop/sales/) — DefaultRouter's shop/<pk>/ detail
    # route uses an untyped regex that would otherwise swallow "sales" as pk.
    path("shop-sales/", HQShopSalesView.as_view(), name="hq-shop-sales"),
    path("students/", HQStudentsListView.as_view(), name="hq-students"),
]
