from rest_framework.permissions import IsAuthenticated

from core.viewsets import HQOnlyModelViewSet, SchoolScopedModelViewSet

from .models import AttendanceStatus, Course, Lesson, LessonType, Package, SubscriptionCatalog
from .realtime import broadcast_calendar_change
from .serializers import (
    AttendanceStatusSerializer,
    CourseSerializer,
    LessonSerializer,
    LessonTypeSerializer,
    PackageSerializer,
    SubscriptionCatalogSerializer,
)


class LessonTypeViewSet(HQOnlyModelViewSet):
    """HQ Metodo catalog. Readable by any authenticated user, writable by HQ."""

    queryset = LessonType.objects.all()
    serializer_class = LessonTypeSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["active", "level"]


class CourseViewSet(SchoolScopedModelViewSet):
    queryset = Course.objects.all().order_by("sort_order", "created_at")
    serializer_class = CourseSerializer
    filterset_fields = ["active", "teacher", "lesson_type", "room"]


class PackageViewSet(SchoolScopedModelViewSet):
    queryset = Package.objects.all()
    serializer_class = PackageSerializer
    filterset_fields = ["active"]


class SubscriptionCatalogViewSet(SchoolScopedModelViewSet):
    queryset = SubscriptionCatalog.objects.all()
    serializer_class = SubscriptionCatalogSerializer
    filterset_fields = ["active"]


class AttendanceStatusViewSet(SchoolScopedModelViewSet):
    queryset = AttendanceStatus.objects.all().order_by("sort_order")
    serializer_class = AttendanceStatusSerializer


class LessonViewSet(SchoolScopedModelViewSet):
    """Individual lesson instances (spec 7.3: edit one lesson / cancel it).
    Realtime: every write broadcasts to the school's + assigned teacher's
    calendar channel group (Phase 5)."""

    queryset = Lesson.objects.select_related("school", "teacher", "lesson_type", "room").all()
    serializer_class = LessonSerializer
    filterset_fields = ["status", "teacher", "date", "course"]

    def perform_create(self, serializer):
        super().perform_create(serializer)
        broadcast_calendar_change(serializer.instance)

    def perform_update(self, serializer):
        super().perform_update(serializer)
        broadcast_calendar_change(serializer.instance)

    def perform_destroy(self, instance):
        broadcast_calendar_change(instance, deleted=True)
        super().perform_destroy(instance)
