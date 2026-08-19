"""School API surface — mounted at /api/school/. All resources are tenant-scoped
to the caller's active school by SchoolScopedModelViewSet."""

from rest_framework.routers import DefaultRouter

from catalog.views import (
    AttendanceStatusViewSet,
    CourseViewSet,
    PackageViewSet,
    SubscriptionCatalogViewSet,
)
from chat.views import QuickReplyTemplateViewSet
from commerce.views import DiscountCodeViewSet
from schools.views import (
    SchoolClosureViewSet,
    SchoolDocumentTypeViewSet,
    SchoolLocationViewSet,
    SchoolRoomViewSet,
)

router = DefaultRouter()
router.register("courses", CourseViewSet, basename="school-courses")
router.register("packages", PackageViewSet, basename="school-packages")
router.register("subscriptions", SubscriptionCatalogViewSet, basename="school-subscriptions")
router.register("attendance-statuses", AttendanceStatusViewSet, basename="school-attendance-statuses")
router.register("locations", SchoolLocationViewSet, basename="school-locations")
router.register("rooms", SchoolRoomViewSet, basename="school-rooms")
router.register("closures", SchoolClosureViewSet, basename="school-closures")
router.register("document-types", SchoolDocumentTypeViewSet, basename="school-document-types")
router.register("discount-codes", DiscountCodeViewSet, basename="school-discount-codes")
router.register("quick-replies", QuickReplyTemplateViewSet, basename="school-quick-replies")

urlpatterns = router.urls
