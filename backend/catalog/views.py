from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
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


class PackageAutoTranslateMixin:
    """POST …/packages/<pk>/auto-translate/ — fill the missing name/description
    locales from the first filled one, via Anthropic (same helper as the HQ
    email templates). One package, four languages — no per-language duplicates."""

    _PKG_LOCALES = ("it", "en", "fr", "es")

    @action(detail=True, methods=["post"], url_path="auto-translate")
    def auto_translate(self, request, pk=None):
        from django.conf import settings as dj_settings

        from notifications.views import _translate_email_text

        if not dj_settings.ANTHROPIC_API_KEY:
            return Response({"error": "ANTHROPIC_API_KEY not configured"}, status=500)
        pkg = self.get_object()

        def name_filled(loc):
            return bool((getattr(pkg, f"name_{loc}") or "").strip())

        requested = request.data.get("source")
        source = (
            requested
            if requested in self._PKG_LOCALES and name_filled(requested)
            else next((loc for loc in self._PKG_LOCALES if name_filled(loc)), None)
        )
        if source is None:
            return Response({"error": "no_filled_language"}, status=400)

        src_name = getattr(pkg, f"name_{source}")
        src_desc = (getattr(pkg, f"description_{source}") or "").strip()
        updates = []
        for loc in self._PKG_LOCALES:
            if loc == source:
                continue
            if not name_filled(loc):
                setattr(pkg, f"name_{loc}", _translate_email_text(src_name, source, loc))
                updates.append(f"name_{loc}")
            if src_desc and not (getattr(pkg, f"description_{loc}") or "").strip():
                setattr(pkg, f"description_{loc}", _translate_email_text(src_desc, source, loc))
                updates.append(f"description_{loc}")
        if updates:
            pkg.save(update_fields=updates)
        return Response(PackageSerializer(pkg).data)


class PackageDeleteGuardMixin:
    """DELETE only for never-purchased packages: once bought, the student
    history references it, so the package must be deactivated instead."""

    def perform_destroy(self, instance):
        if instance.purchases.exists():
            raise ValidationError("Package has purchases; deactivate it instead.")
        super().perform_destroy(instance)


class PackageViewSet(PackageDeleteGuardMixin, PackageAutoTranslateMixin, SchoolScopedModelViewSet):
    queryset = Package.objects.all()
    serializer_class = PackageSerializer
    filterset_fields = ["active"]


class HQPackageViewSet(PackageDeleteGuardMixin, PackageAutoTranslateMixin, HQOnlyModelViewSet):
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
