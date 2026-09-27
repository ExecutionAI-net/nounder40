from datetime import date

from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import Lesson
from core.params import ensure_object_body, parse_uuid, parse_uuid_list
from students.models import Student

from .models import Booking
from .serializers import BookingSerializer
from .services import BookingError, add_spot_alert, book_lesson, cancel_booking, remove_spot_alert, upcoming_lessons_q


def _student(request):
    student = Student.objects.filter(user=request.user).first()
    if student is None:
        raise PermissionDenied("No student profile for this account.")
    return student


class BookingCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        student = _student(request)
        # X-R3-06: a non-UUID lesson id reached the ORM raw -- 500 instead of
        # the 404 the caller gets for an id that simply doesn't exist.
        body = ensure_object_body(request.data)
        lesson_id = parse_uuid(body.get("lesson") or body.get("lesson_id"), "lesson")
        lesson = Lesson.objects.filter(pk=lesson_id).first()
        if lesson is None:
            return Response({"error": "lesson_not_found"}, status=status.HTTP_404_NOT_FOUND)
        try:
            booking = book_lesson(student, lesson)
        except BookingError as exc:
            body = {"error": str(exc)}
            if exc.documents:
                body["documents"] = exc.documents
            return Response(body, status=status.HTTP_400_BAD_REQUEST)
        return Response(BookingSerializer(booking).data, status=status.HTTP_201_CREATED)


class MultipleBookingView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        student = _student(request)
        raw_ids = ensure_object_body(request.data).get("lessons") or []
        if not isinstance(raw_ids, (list, tuple)):
            # `{"lesson_ids": "x"}` used to iterate the string one character
            # at a time and answer 200 with an empty result list (X-R3-16).
            raise ValidationError({"lessons": ["Expected a list of lesson ids."]})
        if not raw_ids:
            # The other half of the same report: `{"lesson_ids": "x"}` (the
            # wrong key) reaches here as an empty list and still answered 200
            # with `{"results": []}` — "everything worked" for a request that
            # booked nothing and named nothing.
            raise ValidationError({"lessons": ["This field is required."]})
        lesson_ids = parse_uuid_list(raw_ids, "lessons")
        results = []
        for lid in lesson_ids:
            lesson = Lesson.objects.filter(pk=lid).first()
            if lesson is None:
                results.append({"lesson": str(lid), "ok": False, "error": "lesson_not_found"})
                continue
            try:
                booking = book_lesson(student, lesson)
                results.append({"lesson": str(lid), "ok": True, "booking": str(booking.id)})
            except BookingError as exc:
                results.append({"lesson": str(lid), "ok": False, "error": str(exc)})
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
            "lesson", "lesson__school", "lesson__teacher", "lesson__lesson_type", "lesson__room",
            # is_event / is_event_ticket / event_price (special events) read these
            "lesson__course", "lesson__course__event_package", "student_package__package",
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


class LessonSpotAlertView(APIView):
    """POST /api/student/lessons/<id>/spot-alert/ — "notify me if a spot frees
    up" on a full lesson (WAITLIST_ALERTS_AND_VIP.md §2.1); 400 with the
    reason when the lesson is not full, not bookable, or its course has no
    waitlist. DELETE — forget it (204 either way)."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        student = _student(request)
        lesson = Lesson.objects.filter(pk=pk).select_related("course", "school").first()
        if lesson is None:
            return Response({"error": "lesson_not_found"}, status=status.HTTP_404_NOT_FOUND)
        try:
            add_spot_alert(student, lesson)
        except BookingError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"lesson": str(lesson.id)}, status=status.HTTP_201_CREATED)

    def delete(self, request, pk):
        remove_spot_alert(_student(request), pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


class StudentSpotAlertsView(APIView):
    """GET /api/student/spot-alerts/ — {"lessons": [id, ...]} the student asked
    to be told about, upcoming ones only (the booking page marks them)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        student = _student(request)
        ids = (
            Lesson.objects.filter(spot_alerts__student=student, status="scheduled")
            .filter(upcoming_lessons_q())
            .values_list("id", flat=True)
        )
        return Response({"lessons": [str(i) for i in ids]})
