"""HQ API surface — mounted at /api/hq/."""

from rest_framework.routers import DefaultRouter

from accounts.hq_views import HQMemberViewSet, HQRoleViewSet, PendingInvitationViewSet
from catalog.views import LessonTypeViewSet
from commerce.views import ShopProductViewSet
from schools.views import SchoolViewSet

router = DefaultRouter()
router.register("lesson-types", LessonTypeViewSet, basename="hq-lesson-types")
router.register("schools", SchoolViewSet, basename="hq-schools")
router.register("shop", ShopProductViewSet, basename="hq-shop")
router.register("team", HQMemberViewSet, basename="hq-team")
router.register("permissions", HQRoleViewSet, basename="hq-permissions")
router.register("invitations", PendingInvitationViewSet, basename="hq-invitations")

urlpatterns = router.urls
