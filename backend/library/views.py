from django.db.models import Q
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from accounts.permissions import IsHQ
from core.params import parse_uuid
from core.storage import private_accel_response
from core.viewsets import is_hq
from teachers.models import Teacher, TeacherSchool

from .models import LibraryContent, Tutorial
from .serializers import LibraryContentSerializer, TutorialSerializer
from .tutorial_files import delete_tutorial_pdf, store_tutorial_pdf


class TeacherLibraryView(APIView):
    """GET /api/teacher/library/?type=&level=&language= — Metodo Library
    content visible to this teacher: HQ-wide content (no school restriction),
    content restricted to one of their schools, or content their schools
    uploaded themselves (spec 17.2)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        teacher = Teacher.objects.filter(user=request.user).first()
        if teacher is None:
            return Response({"error": "no_teacher_profile"}, status=403)

        school_ids = list(TeacherSchool.objects.filter(teacher=teacher, active=True).values_list("school_id", flat=True))

        qs = (
            LibraryContent.objects.filter(active=True)
            .filter(
                Q(restricted_to_school_ids__isnull=True)
                | Q(restricted_to_school_ids__overlap=school_ids)
                | Q(school_id__in=school_ids)
            )
            .select_related("lesson_type")
            .order_by("-created_at")
        )
        p = request.query_params
        # ?school= (multi-school teacher): only what that one school can see.
        # A school she does not teach at yields nothing, like /teacher/lessons/
        # and /teacher/stats/ (QA TCH-R5-01: it used to ignore the filter).
        school_id = parse_uuid(p.get("school"), "school")
        if school_id and school_id not in school_ids:
            return Response([])
        if school_id:
            qs = qs.filter(
                Q(restricted_to_school_ids__isnull=True)
                | Q(restricted_to_school_ids__contains=[school_id])
                | Q(school_id=school_id)
            )
        if p.get("type"):
            qs = qs.filter(type=p["type"])
        if p.get("level"):
            qs = qs.filter(level=p["level"])
        if p.get("language"):
            qs = qs.filter(language=p["language"])

        return Response(LibraryContentSerializer(qs, many=True).data)


class HQLibraryContentView(APIView):
    """GET (list) / POST (create) /api/hq/library/ — HQ's Metodo Library
    (global content, school IS NULL). Distinct from TeacherLibraryView above
    (read-only, filtered to what a teacher's own schools can see)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        qs = LibraryContent.objects.filter(school__isnull=True).select_related("lesson_type").order_by("-created_at")
        p = request.query_params
        if p.get("type") and p["type"] != "all":
            qs = qs.filter(type=p["type"])
        if p.get("level") and p["level"] != "all":
            qs = qs.filter(level=p["level"])
        if p.get("language") and p["language"] != "all":
            qs = qs.filter(language=p["language"])
        return Response(LibraryContentSerializer(qs, many=True).data)

    def post(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        body = request.data
        title = (body.get("title") or "").strip()
        content_type = body.get("type")
        if not title or not content_type:
            return Response({"error": "title and type are required"}, status=400)

        obj = LibraryContent.objects.create(
            title_en=title, title_it=title, title_fr=title, title_es=title,
            type=content_type,
            level=body.get("level") or "all",
            language=body.get("language") or "en",
            description=body.get("description") or "",
            file_url=body.get("file_url") or "",
            thumbnail_url=body.get("thumbnail_url") or "",
            duration_seconds=body.get("duration_seconds") or None,
            visible_to_students=bool(body.get("visible_to_students")),
            student_access=body.get("student_access") or "included",
            price=body.get("price") or None,
            school=None,
        )
        return Response(LibraryContentSerializer(obj).data, status=201)


class HQLibraryContentDetailView(APIView):
    """PATCH/DELETE /api/hq/library/<uuid:pk>/ — scoped to HQ's global
    content (school IS NULL), same as the list/create view above."""

    permission_classes = [IsAuthenticated]

    def _get_object(self, pk):
        return LibraryContent.objects.filter(pk=pk, school__isnull=True).first()

    def patch(self, request, pk):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        obj = self._get_object(pk)
        if obj is None:
            return Response({"error": "not_found"}, status=404)

        body = request.data
        title = body.get("title")
        if title:
            obj.title_en = obj.title_it = obj.title_fr = obj.title_es = title
        for field in ("type", "level", "language", "description", "file_url", "thumbnail_url", "student_access"):
            if field in body:
                setattr(obj, field, body[field] or "")
        if "duration_seconds" in body:
            obj.duration_seconds = body["duration_seconds"] or None
        if "price" in body:
            obj.price = body["price"] or None
        if "visible_to_students" in body:
            obj.visible_to_students = bool(body["visible_to_students"])
        if "active" in body:
            obj.active = bool(body["active"])
        obj.save()
        return Response(LibraryContentSerializer(obj).data)

    def delete(self, request, pk):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        obj = self._get_object(pk)
        if obj is None:
            return Response({"error": "not_found"}, status=404)
        obj.delete()
        return Response({"success": True})


# ---------------------------------------------------------------------------
# Tutorials — HQ writes, everyone reads (library/models.py, Tutorial).
# ---------------------------------------------------------------------------


def _csv(value):
    """`?language=it,en` → ["it", "en"]; empty / missing → []."""
    return [v.strip() for v in (value or "").split(",") if v.strip()]


def _publishable_tutorials():
    # A PDF tutorial without its file is still being set up by HQ: nothing
    # to show the student yet.
    return Tutorial.objects.filter(active=True).filter(
        Q(type=Tutorial.Type.VIDEO) | (Q(type=Tutorial.Type.PDF) & ~Q(file_path=""))
    )


def _apply_tutorial_filters(qs, params):
    # Stored values are lower-case (validate_language); accept "IT" too.
    languages = [v.lower() for v in _csv(params.get("language"))]
    if languages:
        qs = qs.filter(language__in=languages)
    types = [v.lower() for v in _csv(params.get("type"))]
    if types:
        qs = qs.filter(type__in=types)
    topics = _csv(params.get("topic"))
    if topics:
        qs = qs.filter(topic__in=topics)
    q = (params.get("q") or "").strip()
    if q:
        qs = qs.filter(Q(title__icontains=q) | Q(description__icontains=q) | Q(topic__icontains=q))
    return qs


class HQTutorialViewSet(ModelViewSet):
    """/api/hq/tutorials/ — full CRUD plus `<pk>/file/` (POST multipart
    `file` to attach the PDF, DELETE to drop it). Section guard maps the
    segment to the `library` permission (core/section_guard.py): whoever
    curates the Metodo Library curates the tutorials."""

    permission_classes = [IsAuthenticated, IsHQ]
    serializer_class = TutorialSerializer
    queryset = Tutorial.objects.all()

    def get_queryset(self):
        qs = _apply_tutorial_filters(Tutorial.objects.all(), self.request.query_params)
        active = self.request.query_params.get("active")
        if active in ("true", "false"):
            qs = qs.filter(active=(active == "true"))
        return qs

    def perform_update(self, serializer):
        tutorial = serializer.save()
        # Switched to a video: the PDF is dead weight, and would otherwise
        # keep the row "publishable" as a PDF if HQ switched back by mistake.
        if tutorial.type != Tutorial.Type.PDF and tutorial.file_path:
            delete_tutorial_pdf(tutorial)

    def perform_destroy(self, instance):
        delete_tutorial_pdf(instance, save=False)
        instance.delete()

    @action(detail=True, methods=["post", "delete"], url_path="file")
    def file(self, request, pk=None):
        tutorial = self.get_object()
        if request.method == "DELETE":
            delete_tutorial_pdf(tutorial)
            return Response(TutorialSerializer(tutorial).data)
        upload = request.FILES.get("file")
        if not upload:
            return Response({"error": "file required"}, status=400)
        if tutorial.type != Tutorial.Type.PDF:
            return Response({"error": "not_a_pdf_tutorial"}, status=400)
        store_tutorial_pdf(tutorial, upload)
        return Response(TutorialSerializer(tutorial).data)


class PublicTutorialsView(APIView):
    """GET /api/tutorials/?language=it,en&type=video,pdf&topic=A,B&q= —
    active tutorials, no login (the student sidebar entry is public).
    Filters take CSV lists; the student page also filters client-side."""

    permission_classes = [AllowAny]

    def get(self, request):
        qs = _apply_tutorial_filters(_publishable_tutorials(), request.query_params)
        return Response(TutorialSerializer(qs, many=True).data)


class PublicTutorialFileView(APIView):
    """GET /api/tutorials/<pk>/file/ — streams the PDF via X-Accel-Redirect.

    The file sits in the private tree only because the public one cannot
    serve a PDF (see Tutorial's docstring); the "permission" here is simply
    that the tutorial is published. Opened by plain navigation from the
    page, so no token rides along and none is needed."""

    permission_classes = [AllowAny]

    def get(self, request, pk):
        tutorial = _publishable_tutorials().filter(pk=pk, type=Tutorial.Type.PDF).first()
        if tutorial is None:
            return Response({"error": "not_found"}, status=404)
        return private_accel_response(tutorial.file_path, filename=tutorial.file_name or "tutorial.pdf")
