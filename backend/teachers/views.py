from datetime import date

from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.viewsets import SchoolScopedModelViewSet, is_hq

from .models import CompensationPlan, Teacher, TeacherCompensationPayment, TeacherSchool
from .serializers import (
    CompensationPlanSerializer,
    TeacherCompensationPaymentSerializer,
    TeacherSerializer,
)
from .services import compute_lesson_fee, monthly_compensation


class TeacherRequiredMixin:
    permission_classes = [IsAuthenticated]

    def get_teacher(self):
        teacher = Teacher.objects.filter(user=self.request.user).first()
        if teacher is None:
            raise PermissionDenied("No teacher profile for this account.")
        return teacher


class TeacherProfileView(TeacherRequiredMixin, APIView):
    def get(self, request):
        return Response(TeacherSerializer(self.get_teacher()).data)

    def patch(self, request):
        serializer = TeacherSerializer(self.get_teacher(), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class TeacherLessonsView(TeacherRequiredMixin, APIView):
    """Assigned lessons (the teacher's calendar). Filters: ?from= ?to= ?date=."""

    def get(self, request):
        from catalog.models import Lesson
        from catalog.serializers import LessonBrowseSerializer

        qs = (
            Lesson.objects.filter(teacher=self.get_teacher())
            .select_related("school", "teacher", "lesson_type", "room")
            .order_by("date", "start_time")
        )
        p = request.query_params
        if p.get("date"):
            qs = qs.filter(date=p["date"])
        if p.get("from"):
            qs = qs.filter(date__gte=p["from"])
        if p.get("to"):
            qs = qs.filter(date__lte=p["to"])
        return Response(LessonBrowseSerializer(qs[:1000], many=True).data)


class TeacherStatsView(TeacherRequiredMixin, APIView):
    def get(self, request):
        from bookings.models import Attendance
        from catalog.models import Lesson

        teacher = self.get_teacher()
        past = Lesson.objects.filter(teacher=teacher, date__lt=date.today())
        upcoming = Lesson.objects.filter(teacher=teacher, date__gte=date.today())
        attendance = Attendance.objects.filter(teacher=teacher)
        present = attendance.filter(status="present").count()
        total_marked = attendance.count()
        return Response(
            {
                "lessons_taught": past.count(),
                "lessons_upcoming": upcoming.count(),
                "attendance_marked": total_marked,
                "present": present,
                "no_show": total_marked - present,
                "attendance_rate": round(present / total_marked, 3) if total_marked else None,
            }
        )


class CompensationPlanViewSet(SchoolScopedModelViewSet):
    queryset = CompensationPlan.objects.prefetch_related("rates").all()
    serializer_class = CompensationPlanSerializer

    @action(detail=True, methods=["post"])
    def simulate(self, request, pk=None):
        """Preview earnings for a given lesson scenario: {students, lesson_type_id?}."""
        plan = self.get_object()
        students = int(request.data.get("students", 0))
        lesson_type_id = request.data.get("lesson_type_id")
        fee = compute_lesson_fee(plan, lesson_type_id=lesson_type_id, students_count=students)
        return Response({"plan": plan.name, "students": students, "fee": fee})


class TeacherCompensationPaymentViewSet(SchoolScopedModelViewSet):
    queryset = TeacherCompensationPayment.objects.select_related("teacher").all()
    serializer_class = TeacherCompensationPaymentSerializer
    filterset_fields = ["teacher", "month", "status"]


class SchoolTeacherCompensationView(APIView):
    """GET /api/school/teachers/{id}/compensation/?month=YYYY-MM — monthly report."""

    permission_classes = [IsAuthenticated]

    def get(self, request, teacher_id):
        from .models import Teacher as TeacherModel

        user = request.user
        school_id = request.query_params.get("school") if is_hq(user) else user.active_school_id
        if not school_id:
            return Response({"error": "school is required"}, status=400)
        teacher = TeacherModel.objects.filter(pk=teacher_id).first()
        if teacher is None or not TeacherSchool.objects.filter(teacher=teacher, school_id=school_id).exists():
            return Response({"error": "not_found"}, status=404)
        month = request.query_params.get("month") or date.today().strftime("%Y-%m")
        return Response(monthly_compensation(teacher, teacher.school_links.get(school_id=school_id).school, month))


class TeacherCompensationView(TeacherRequiredMixin, APIView):
    """GET /api/teacher/compensation/?school=&month= — the teacher's own earnings."""

    def get(self, request):
        teacher = self.get_teacher()
        school_id = request.query_params.get("school")
        link = TeacherSchool.objects.filter(teacher=teacher, school_id=school_id).first() if school_id else (
            TeacherSchool.objects.filter(teacher=teacher).first()
        )
        if link is None:
            return Response({"error": "teacher has no school assignment"}, status=400)
        month = request.query_params.get("month") or date.today().strftime("%Y-%m")
        return Response(monthly_compensation(teacher, link.school, month))


class TeacherSchoolAssignmentsView(TeacherRequiredMixin, APIView):
    """GET /api/teacher/schools/ — this teacher's school assignments with
    their compensation plan details (dashboard 'compensation plans' section)."""

    def get(self, request):
        teacher = self.get_teacher()
        links = TeacherSchool.objects.filter(teacher=teacher, active=True).select_related("school", "compensation_plan")
        data = []
        for link in links:
            plan = link.compensation_plan
            data.append({
                "school_id": str(link.school_id),
                "school_name": link.school.name,
                "compensation_plan": (
                    {
                        "name": plan.name, "base_fee": str(plan.base_fee),
                        "bonus_threshold": plan.bonus_threshold, "bonus_per_student": str(plan.bonus_per_student or 0),
                    }
                    if plan else None
                ),
            })
        return Response(data)
