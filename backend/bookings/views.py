from datetime import date

from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import Lesson
from students.models import Student

from .models import Booking
from .serializers import BookingSerializer
from .services import BookingError, book_lesson, cancel_booking


def _student(request):
    student = Student.objects.filter(user=request.user).first()
    if student is None:
        raise PermissionDenied("No student profile for this account.")
    return student


class BookingCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        student = _student(request)
        lesson_id = request.data.get("lesson") or request.data.get("lesson_id")
        lesson = Lesson.objects.filter(pk=lesson_id).first()
        if lesson is None:
            return Response({"error": "lesson_not_found"}, status=status.HTTP_404_NOT_FOUND)
        try:
            booking = book_lesson(student, lesson)
        except BookingError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(BookingSerializer(booking).data, status=status.HTTP_201_CREATED)


class MultipleBookingView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        student = _student(request)
        lesson_ids = request.data.get("lessons") or []
        results = []
        for lid in lesson_ids:
            lesson = Lesson.objects.filter(pk=lid).first()
            if lesson is None:
                results.append({"lesson": lid, "ok": False, "error": "lesson_not_found"})
                continue
            try:
                booking = book_lesson(student, lesson)
                results.append({"lesson": lid, "ok": True, "booking": str(booking.id)})
            except BookingError as exc:
                results.append({"lesson": lid, "ok": False, "error": str(exc)})
        return Response({"results": results})


class BookingDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        student = _student(request)
        booking = Booking.objects.filter(pk=pk, student=student).first()
        if booking is None:
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)
        try:
            booking = cancel_booking(booking)
        except BookingError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(BookingSerializer(booking).data)


class StudentBookingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        student = _student(request)
        tab = request.query_params.get("status", "upcoming")
        qs = Booking.objects.filter(student=student).select_related(
            "lesson", "lesson__school", "lesson__teacher", "lesson__lesson_type", "lesson__room"
        )
        today = date.today()
        if tab == "upcoming":
            qs = qs.filter(status=Booking.Status.CONFIRMED, lesson__date__gte=today)
        elif tab == "past":
            qs = qs.filter(lesson__date__lt=today).exclude(status=Booking.Status.CANCELLED) | qs.filter(
                status__in=[Booking.Status.ATTENDED, Booking.Status.NO_SHOW]
            )
        elif tab == "cancelled":
            qs = qs.filter(status=Booking.Status.CANCELLED)
        qs = qs.order_by("lesson__date", "lesson__start_time")
        return Response(BookingSerializer(qs, many=True).data)
