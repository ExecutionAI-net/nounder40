from django.db.models import Q
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

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
