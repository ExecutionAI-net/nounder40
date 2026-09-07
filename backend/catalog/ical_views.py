from django.http import HttpResponse, HttpResponseNotFound, JsonResponse
from django.views import View
from rest_framework.exceptions import ValidationError

from core.params import parse_uuid

from .ical import build_ics
from .models import Lesson


class SchoolICalView(View):
    """GET /api/calendar/<school_id>.ics — public, filterable by ?type= ?teacher= ?location=."""

    def get(self, request, school_id):
        from schools.models import School

        school = School.objects.filter(pk=school_id).first()
        if school is None:
            return HttpResponseNotFound("school not found")

        qs = Lesson.objects.filter(school=school).exclude(status="cancelled").select_related(
            "school", "lesson_type", "room"
        )
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

        body = build_ics(qs.order_by("date", "start_time")[:2000], calendar_name=f"{school.name} — No Under 40")
        return HttpResponse(body, content_type="text/calendar; charset=utf-8")


class StudentICalView(View):
    """GET /api/calendar/student/<token>.ics — private per-student feed of their bookings."""

    def get(self, request, token):
        from bookings.models import Booking
        from students.models import Student

        student = Student.objects.filter(ical_token=token).first()
        if student is None:
            return HttpResponseNotFound("invalid token")

        lesson_ids = Booking.objects.filter(
            student=student, status=Booking.Status.CONFIRMED
        ).values_list("lesson_id", flat=True)
        qs = Lesson.objects.filter(id__in=lesson_ids).select_related("school", "lesson_type", "room")

        body = build_ics(qs.order_by("date", "start_time")[:2000], calendar_name=f"{student.name} — My Bookings")
        return HttpResponse(body, content_type="text/calendar; charset=utf-8")
