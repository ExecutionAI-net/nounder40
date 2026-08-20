from django.db.models import Q
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.viewsets import is_hq
from teachers.models import Teacher, TeacherSchool

from .models import LibraryContent
from .serializers import LibraryContentSerializer


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
