from datetime import date

from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Teacher
from .serializers import TeacherSerializer


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
