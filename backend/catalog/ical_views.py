from django.http import HttpResponse, HttpResponseNotFound
from django.views import View

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
        p = request.GET
        if p.get("type"):
            qs = qs.filter(lesson_type_id=p["type"])
        if p.get("teacher"):
            qs = qs.filter(teacher_id=p["teacher"])
        if p.get("location"):
            qs = qs.filter(room__location_id=p["location"])

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
