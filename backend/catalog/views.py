from datetime import timedelta

from django.utils import timezone
from rest_framework import generics
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.viewsets import CourseCostContextMixin, HQOnlyModelViewSet, SchoolScopedModelViewSet

from .models import AttendanceStatus, Course, Lesson, LessonType, Package, SubscriptionCatalog
from .realtime import broadcast_calendar_change
from .serializers import (
    AttendanceStatusSerializer,
    CourseSerializer,
    LessonSerializer,
    LessonTypeSerializer,
    PackageSerializer,
    PublicUpcomingLessonSerializer,
    SubscriptionCatalogSerializer,
)


class LessonTypeViewSet(HQOnlyModelViewSet):
    """HQ Metodo catalog. Readable by any authenticated user, writable by HQ:
    scuole e insegnanti lo leggono dalla rotta /api/school/lesson-types/ (stessa
    viewset, due punti di aggancio), quindi qui le letture restano aperte."""

    hq_reads_only = False
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

    def perform_destroy(self, instance):
        # QA #7: this generic DELETE used to just call Model.delete(), which
        # (Lesson.course is SET_NULL) left every future Lesson the course had
        # generated behind — orphaned, still "scheduled", still bookable,
        # nowhere to find them. course_views.SchoolCourseDetailView.delete
        # (the school panel's actual course-delete button, at .../full/)
        # already refunded+cancelled linked bookings before deleting; both
        # endpoints now share that policy via cascade_delete_course so
        # neither one leaves ghost lessons behind.
        from .services import cascade_delete_course

        cascade_delete_course(instance)
        super().perform_destroy(instance)


class PackageAutoTranslateMixin:
    """POST …/packages/<pk>/auto-translate/ — fill the missing name/description
    locales from the first filled one, via Anthropic (same helper as the HQ
    email templates). One package, four languages — no per-language duplicates."""

    _PKG_LOCALES = ("it", "en", "fr", "es")

    @action(detail=True, methods=["post"], url_path="auto-translate")
    def auto_translate(self, request, pk=None):
        from django.conf import settings as dj_settings

        from notifications.views import _EmailTranslateAPIError, _translate_email_text

        # QA X-R2-07: this used to answer 500 for a missing key, and to check
        # the key before resolving the package. Ownership first (a foreign
        # package must 404 either way), then 503 — the translation provider
        # being unconfigured/unreachable is an upstream availability issue.
        pkg = self.get_object()
        if not dj_settings.ANTHROPIC_API_KEY:
            return Response({"error": "ANTHROPIC_API_KEY not configured"}, status=503)

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
        try:
            for loc in self._PKG_LOCALES:
                if loc == source:
                    continue
                if not name_filled(loc):
                    setattr(pkg, f"name_{loc}", _translate_email_text(src_name, source, loc))
                    updates.append(f"name_{loc}")
                if src_desc and not (getattr(pkg, f"description_{loc}") or "").strip():
                    setattr(pkg, f"description_{loc}", _translate_email_text(src_desc, source, loc))
                    updates.append(f"description_{loc}")
        except _EmailTranslateAPIError as exc:
            # Anthropic unreachable / erroring: nothing is saved and the
            # client is told it is an upstream outage, not a bad request.
            return Response({"error": "translation_provider_unavailable", "detail": str(exc)}, status=503)
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


class PackageReorderMixin:
    """POST .../packages/reorder/ — Body: {ids: string[]} nell'ordine voluto.

    Riordina SOLO le righe che il chiamante gia' vede (get_queryset e' gia'
    filtrato per scuola attiva, o su school=null per HQ): un id di un'altra
    scuola infilato nella lista semplicemente non trova nulla da aggiornare.
    Stessa forma del riordino di corsi e tipi di lezione."""

    @action(detail=False, methods=["post"])
    def reorder(self, request):
        ids = request.data.get("ids")
        if not isinstance(ids, list) or not ids:
            return Response({"error": "ids required"}, status=400)
        visible = self.filter_queryset(self.get_queryset())
        for i, package_id in enumerate(ids):
            visible.filter(pk=package_id).update(sort_order=i + 1)
        return Response({"ok": True})


class PackageViewSet(
    PackageDeleteGuardMixin, PackageAutoTranslateMixin, PackageReorderMixin,
    CourseCostContextMixin, SchoolScopedModelViewSet
):
    queryset = Package.objects.all()
    serializer_class = PackageSerializer
    filterset_fields = ["active"]


class HQPackageViewSet(
    PackageDeleteGuardMixin, PackageAutoTranslateMixin, PackageReorderMixin,
    CourseCostContextMixin, HQOnlyModelViewSet
):
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

    def destroy(self, request, *args, **kwargs):
        """SCH-R3-09: PR #112 keeps at MOST one default (the serializer unsets
        the others on create/update). The delete side has to keep at LEAST
        one: deleting the default left the school with none, and the register
        then pre-selects nothing — every roster row has to be picked by hand,
        with no way back through the UI other than editing another status.

        The next status in the school's own order is promoted, so the mark
        that becomes default is the one the register already lists first
        rather than whatever happens to sort first in a later query. The last
        status of a school is simply deleted: there is nothing to promote, and
        blocking it would trap a school that wants to start over.
        """
        instance = self.get_object()
        was_default, school_id = instance.is_default, instance.school_id
        response = super().destroy(request, *args, **kwargs)
        if was_default:
            heir = (
                AttendanceStatus.objects.filter(school_id=school_id)
                .order_by("sort_order", "created_at")
                .first()
            )
            if heir is not None and not heir.is_default:
                heir.is_default = True
                heir.save(update_fields=["is_default"])
        return response


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


class PublicUpcomingLessonsView(generics.ListAPIView):
    """GET /api/lessons/public/upcoming/ — the landing page's "at the barre"
    board. Public: anyone browsing the site sees what is running in the network
    over the next few days, which is the whole point of the section.

    Only scheduled lessons at active schools that have not started yet (in
    the school's own timezone) — a board advertising yesterday's class, or
    this morning's, is worse than no board. `days` (1-14,
    default 2) sets the window, `city` narrows it, `limit` (1-24, default 6)
    caps the list.
    """

    permission_classes = [AllowAny]
    authentication_classes = []
    serializer_class = PublicUpcomingLessonSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["locale"] = self.request.query_params.get("locale", "en")
        return context

    def _int_param(self, name, default, low, high):
        try:
            value = int(self.request.query_params.get(name, default))
        except (TypeError, ValueError):
            return default
        return max(low, min(high, value))

    def get_queryset(self):
        today = timezone.localdate()
        days = self._int_param("days", 2, 1, 14)
        limit = self._int_param("limit", 6, 1, 24)

        from bookings.services import upcoming_lessons_q

        qs = (
            Lesson.objects.filter(
                status=Lesson.Status.SCHEDULED,
                school__active=True,
                date__lte=today + timedelta(days=days - 1),
            )
            .filter(upcoming_lessons_q())
            .select_related("school", "lesson_type")
            .order_by("date", "start_time")
        )
        city = self.request.query_params.get("city")
        if city:
            qs = qs.filter(school__city__iexact=city)
        return qs[:limit]
