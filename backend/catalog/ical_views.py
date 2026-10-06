from django.http import HttpResponse, HttpResponseNotFound, JsonResponse
from django.views import View
from rest_framework.exceptions import ValidationError

from core.params import parse_uuid

from .ical import build_ics, lesson_event
from .models import Lesson

# Everything lesson_event() reads, so a 2000-row feed stays a handful of queries.
_EVENT_RELATED = (
    "school", "lesson_type", "teacher", "room__location",
    "course", "course__teacher", "course__room__location",
)


def _ics_response(body: bytes, *, filename: str | None = None) -> HttpResponse:
    response = HttpResponse(body, content_type="text/calendar; charset=utf-8")
    if filename:
        # inline, not attachment: iOS Safari shows the native "Add to
        # Calendar" preview for an inline text/calendar response, while
        # `attachment` sends it to the download manager first. Desktop
        # browsers download either way and keep the filename.
        response["Content-Disposition"] = f'inline; filename="{filename}"'
    return response


class SchoolICalView(View):
    """GET /api/calendar/<school_id>.ics — public, filterable by ?type= ?teacher= ?location=."""

    def get(self, request, school_id):
        from schools.models import School

        school = School.objects.filter(pk=school_id).first()
        if school is None:
            return HttpResponseNotFound("school not found")

        qs = Lesson.objects.filter(school=school).exclude(status="cancelled").select_related(*_EVENT_RELATED)
        # Plain Django View: DRF's exception handler never runs here, so the
        # ValidationError the parser raises is turned into the same 400 JSON
        # body by hand. Without this a `?type=x` from anyone (this feed is
        # public) was an unhandled 500 (QA X-R2-04).
        p = request.GET
        try:
            lesson_type_id = parse_uuid(p.get("type"), "type")
            teacher_id = parse_uuid(p.get("teacher"), "teacher")
            location_id = parse_uuid(p.get("location"), "location")
        except ValidationError as exc:
            return JsonResponse(exc.detail, status=400)
        if lesson_type_id:
            qs = qs.filter(lesson_type_id=lesson_type_id)
        if teacher_id:
            qs = qs.filter(teacher_id=teacher_id)
        if location_id:
            qs = qs.filter(room__location_id=location_id)

        locale = school.language or "en"
        # Newest first so the cap drops the oldest lessons, not the upcoming ones.
        events = [lesson_event(lesson, locale=locale) for lesson in qs.order_by("-date", "-start_time")[:2000]]
        return _ics_response(build_ics(events, calendar_name=f"{school.name} — No Under 40"))


class StudentICalView(View):
    """GET /api/calendar/student/<token>.ics — private per-student feed of her bookings."""

    def get(self, request, token):
        from bookings.models import Booking
        from students.models import Student

        student = Student.objects.filter(ical_token=token).first()
        if student is None:
            return HttpResponseNotFound("invalid token")

        lesson_ids = Booking.objects.filter(
            student=student, status=Booking.Status.CONFIRMED
        ).values_list("lesson_id", flat=True)
        qs = Lesson.objects.filter(id__in=lesson_ids).select_related(*_EVENT_RELATED)

        locale = student.language_preference or "en"
        events = [lesson_event(lesson, locale=locale) for lesson in qs.order_by("-date", "-start_time")[:2000]]
        return _ics_response(build_ics(events, calendar_name=f"{student.name} — My Bookings"))


class StudentBookingICalView(View):
    """GET /api/calendar/student/<token>/<booking_id>.ics — one booking as a
    single-event file: the "Apple / Outlook" link of the confirmation and
    reminder emails. The token is the student's own feed token, so a link
    forwarded to someone else still only opens that student's bookings. A
    cancelled booking is a 404 on purpose: the email says the calendar does
    not follow a cancellation, and serving the event again would add it back."""

    def get(self, request, token, booking_id):
        from bookings.models import Booking
        from bookings.services import booking_calendar_event
        from students.models import Student

        student = Student.objects.filter(ical_token=token).first()
        if student is None:
            return HttpResponseNotFound("invalid token")
        booking = (
            Booking.objects.filter(pk=booking_id, student=student, status=Booking.Status.CONFIRMED)
            .select_related("student__user", "school", *(f"lesson__{rel}" for rel in _EVENT_RELATED))
            .first()
        )
        if booking is None:
            return HttpResponseNotFound("booking not found")

        locale = student.language_preference or "en"
        event = booking_calendar_event(booking, locale)
        body = build_ics([event], calendar_name=f"{student.name} — No Under 40")
        return _ics_response(body, filename=f"lesson-{booking.lesson.date.isoformat()}.ics")
