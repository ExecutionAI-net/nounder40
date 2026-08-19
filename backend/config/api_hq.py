"""HQ API surface — mounted at /api/hq/."""

from rest_framework.routers import DefaultRouter

from catalog.views import LessonTypeViewSet
from commerce.views import ShopProductViewSet
from schools.views import SchoolViewSet

router = DefaultRouter()
router.register("lesson-types", LessonTypeViewSet, basename="hq-lesson-types")
router.register("schools", SchoolViewSet, basename="hq-schools")
router.register("shop", ShopProductViewSet, basename="hq-shop")

urlpatterns = router.urls
