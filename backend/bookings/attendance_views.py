from rest_framework import status as http_status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import AttendanceStatus, Lesson
from core.viewsets import is_hq
from teachers.models import Teacher

from .attendance_serializers import LessonRosterEntrySerializer, MarkAttendanceItemSerializer
from .models import Attendance, Booking
from .services import BookingError, mark_attendance


def _roster(lesson):
    bookings = (
        Booking.objects.filter(lesson=lesson)
        .exclude(status=Booking.Status.CANCELLED)
        .select_related("student")
        .order_by("booked_at")
    )
    attendance_by_student = {a.student_id: a for a in Attendance.objects.filter(lesson=lesson)}
    rows = []
    for b in bookings:
        att = attendance_by_student.get(b.student_id)
        rows.append(
            {
                "booking_id": b.id,
                "student_id": b.student_id,
                "student_name": b.student.name,
                "access_source": b.access_source,
                "booking_status": b.status,
                "attendance_status": att.status if att else None,
                "marked_at": att.marked_at if att else None,
            }
        )
    return rows


class TeacherAttendanceView(APIView):
    """Teacher's roster + marking for one lesson. GET lists booked students with
    their current attendance; POST bulk-marks [{student_id, status, status_id?}]."""

    permission_classes = [IsAuthenticated]

    def _teacher_lesson(self, request, lesson_id):
        teacher = Teacher.objects.filter(user=request.user).first()
        if teacher is None:
            raise PermissionDenied("No teacher profile for this account.")
        lesson = Lesson.objects.filter(pk=lesson_id, teacher=teacher).first()
        if lesson is None:
            return None
        return lesson

    def get(self, request, lesson_id):
        lesson = self._teacher_lesson(request, lesson_id)
        if lesson is None:
            return Response({"error": "lesson_not_found"}, status=http_status.HTTP_404_NOT_FOUND)
        return Response(LessonRosterEntrySerializer(_roster(lesson), many=True).data)

    def post(self, request, lesson_id):
        lesson = self._teacher_lesson(request, lesson_id)
        if lesson is None:
            return Response({"error": "lesson_not_found"}, status=http_status.HTTP_404_NOT_FOUND)

        teacher = Teacher.objects.filter(user=request.user).first()
        items = request.data if isinstance(request.data, list) else request.data.get("attendance", [])
        results = []
        for raw in items:
            item = MarkAttendanceItemSerializer(data=raw)
            item.is_valid(raise_exception=True)
            data = item.validated_data
            from students.models import Student

            student = Student.objects.filter(pk=data["student_id"]).first()
            status_ref = None
            if data.get("status_id"):
                status_ref = AttendanceStatus.objects.filter(pk=data["status_id"], school=lesson.school).first()
            if student is None:
                results.append({"student_id": str(data["student_id"]), "ok": False, "error": "student_not_found"})
                continue
            try:
                mark_attendance(lesson, student, teacher, status=data["status"], status_ref=status_ref)
                results.append({"student_id": str(data["student_id"]), "ok": True})
            except BookingError as exc:
                results.append({"student_id": str(data["student_id"]), "ok": False, "error": str(exc)})

        return Response({"results": results, "roster": LessonRosterEntrySerializer(_roster(lesson), many=True).data})


class SchoolAttendanceView(APIView):
    """Read-only attendance report for a lesson, school-scoped."""

    permission_classes = [IsAuthenticated]

    def get(self, request, lesson_id):
        lesson = Lesson.objects.filter(pk=lesson_id).first()
        if lesson is None:
            return Response({"error": "lesson_not_found"}, status=http_status.HTTP_404_NOT_FOUND)
        user = request.user
        if not is_hq(user) and lesson.school_id != user.active_school_id:
            raise PermissionDenied("Not your school.")
        return Response(LessonRosterEntrySerializer(_roster(lesson), many=True).data)
