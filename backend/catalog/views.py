from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

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

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        data = dict(self.get_serializer(instance).data)
        data["courses"] = instance.courses.count()
        data["lessons"] = instance.lessons.count()
        return Response(data)

    def destroy(self, request, *args, **kwargs):
        self._require_hq()
        instance = self.get_object()
        courses = instance.courses.count()
        lessons = instance.lessons.count()
        if courses > 0 or lessons > 0:
            return Response({"error": "in_use", "courses": courses, "lessons": lessons}, status=400)
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=["post"])
    def reorder(self, request):
        """POST /api/hq/lesson-types/reorder/ — Body: {ids: string[]} (full order)."""
        self._require_hq()
        ids = request.data.get("ids")
        if not isinstance(ids, list) or not ids:
            return Response({"error": "ids required"}, status=400)
        for i, type_id in enumerate(ids):
            LessonType.objects.filter(pk=type_id).update(sort_order=i + 1)
        return Response({"ok": True})


class CourseViewSet(SchoolScopedModelViewSet):
    queryset = Course.objects.all().order_by("sort_order", "created_at")
    serializer_class = CourseSerializer
    filterset_fields = ["active", "teacher", "lesson_type", "room"]


class PackageViewSet(SchoolScopedModelViewSet):
    queryset = Package.objects.all()
    serializer_class = PackageSerializer
    filterset_fields = ["active"]


class HQPackageViewSet(HQOnlyModelViewSet):
    """HQ's own platform-wide package catalog (school=null), separate from
    each school's own packages (PackageViewSet)."""

    queryset = Package.objects.filter(school__isnull=True).order_by("-created_at")
    serializer_class = PackageSerializer


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
