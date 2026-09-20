"""Special events API (SPECIAL_EVENTS.md).

School side, /api/school/events/ (section "events" of the school matrix):
    GET    /                 the school's events, newest first
    POST   /                 create (draft, or straight to HQ with submit=true)
    GET    /<id>/            one event with its lesson and seat counts
    PATCH  /<id>/            edit (live at once after approval, see events.py)
    DELETE /<id>/            cancel (seats cancelled, students emailed); a
                             draft/rejected event with no lesson is deleted
    POST   /<id>/submit/     draft / rejected / suspended -> pending

HQ side, /api/hq/events/ (HQRole key "events"):
    GET    /?status=pending|modified|approved|rejected|suspended|cancelled|all
    GET    /<id>/
    POST   /<id>/approve/    pending or suspended -> approved (lesson created)
    POST   /<id>/reject/     pending -> rejected, {note}
    POST   /<id>/suspend/    approved -> suspended, {note}
    POST   /<id>/reviewed/   clears the "modified after approval" flag
"""

from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.params import ensure_object_body
from core.section_guard import hq_has_permission
from core.viewsets import is_hq

from . import events
from .course_views import _foreign_school_ref_error
from .models import Course

EventStatus = Course.EventStatus


def _school_id(request):
    return request.user.active_school_id


def _event_or_404(request, pk):
    school_id = _school_id(request)
    if not school_id:
        return None, Response({"error": "no_active_school"}, status=400)
    course = (
        Course.objects.filter(pk=pk, school_id=school_id, is_special_event=True)
        .select_related("school", "teacher", "room__location", "event_reviewed_by")
        .first()
    )
    if course is None:
        return None, Response({"error": "not_found"}, status=404)
    return course, None


def _refs_error(school_id, data):
    return _foreign_school_ref_error(
        school_id,
        teacher_id=data.get("teacher_id") if "teacher_id" in data else None,
        room_id=data.get("room_id") if "room_id" in data else None,
        compensation_plan_id=data.get("compensation_plan_id") if "compensation_plan_id" in data else None,
    )


class SchoolEventListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        school_id = _school_id(request)
        if not school_id:
            return Response({"error": "no_active_school"}, status=400)
        qs = (
            Course.objects.filter(school_id=school_id, is_special_event=True)
            .select_related("school", "teacher", "room__location", "event_reviewed_by")
            .order_by("-start_date", "-created_at")
        )
        return Response([events.event_payload(c) for c in qs])

    def post(self, request):
        school_id = _school_id(request)
        if not school_id:
            return Response({"error": "no_active_school"}, status=400)
        data = ensure_object_body(request.data)
        err = _refs_error(school_id, data)
        if err:
            return Response({"error": err}, status=400)
        try:
            course = events.create_event(school_id, data, submit=bool(data.get("submit")))
        except events.EventError as exc:
            return Response({"error": str(exc)}, status=400)
        course = Course.objects.select_related("school", "teacher", "room__location").get(pk=course.pk)
        return Response(events.event_payload(course), status=201)


class SchoolEventDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        course, err = _event_or_404(request, pk)
        if err:
            return err
        return Response(events.event_payload(course))

    def patch(self, request, pk):
        course, err = _event_or_404(request, pk)
        if err:
            return err
        data = ensure_object_body(request.data)
        ref_err = _refs_error(course.school_id, data)
        if ref_err:
            return Response({"error": ref_err}, status=400)
        try:
            events.update_event(course, data)
        except events.EventError as exc:
            return Response({"error": str(exc)}, status=400)
        course = Course.objects.select_related("school", "teacher", "room__location", "event_reviewed_by").get(pk=pk)
        return Response(events.event_payload(course))

    def delete(self, request, pk):
        course, err = _event_or_404(request, pk)
        if err:
            return err
        if events.event_lesson(course) is None:
            # Never published: nothing to cancel, nobody to tell.
            events.sync_event_ticket(course, None)
            course.delete()
            return Response({"deleted": True})
        try:
            result = events.cancel_event(course)
        except events.EventError as exc:
            return Response({"error": str(exc)}, status=400)
        return Response(result)


class SchoolEventSubmitView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        course, err = _event_or_404(request, pk)
        if err:
            return err
        try:
            events.submit_event(course)
        except events.EventError as exc:
            return Response({"error": str(exc)}, status=400)
        return Response(events.event_payload(course))


# --------------------------------------------------------------------------
# HQ
# --------------------------------------------------------------------------


def _require_hq_events(request):
    """HQSectionGuardMiddleware already maps /api/hq/events/ to the "events"
    key; this is the belt to that braces for a direct call from a non-HQ
    token, which the middleware leaves to the view."""
    if not is_hq(request.user) or not hq_has_permission(request.user, "events"):
        raise PermissionDenied("HQ only.")


def _hq_event_or_404(pk):
    return (
        Course.objects.filter(pk=pk, is_special_event=True)
        .select_related("school", "teacher", "room__location", "event_reviewed_by")
        .first()
    )


class HQEventListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _require_hq_events(request)
        status_filter = (request.query_params.get("status") or "pending").lower()
        qs = Course.objects.filter(is_special_event=True).select_related(
            "school", "teacher", "room__location", "event_reviewed_by"
        )
        if status_filter == "modified":
            qs = qs.filter(event_status=EventStatus.APPROVED, event_changed_at__isnull=False)
        elif status_filter == "all":
            qs = qs.exclude(event_status="")
        elif status_filter in EventStatus.values:
            qs = qs.filter(event_status=status_filter)
        else:
            return Response({"error": "invalid_status"}, status=400)
        qs = qs.order_by(
            *(["event_submitted_at"] if status_filter == "pending" else ["-event_changed_at", "-created_at"])
        )
        counts = {
            "pending": Course.objects.filter(is_special_event=True, event_status=EventStatus.PENDING).count(),
            "modified": Course.objects.filter(
                is_special_event=True, event_status=EventStatus.APPROVED, event_changed_at__isnull=False
            ).count(),
        }
        return Response({"results": [events.event_payload(c, with_school=True) for c in qs], "counts": counts})


class HQEventDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        _require_hq_events(request)
        course = _hq_event_or_404(pk)
        if course is None:
            return Response({"error": "not_found"}, status=404)
        return Response(events.event_payload(course, with_school=True))


class HQEventDecisionView(APIView):
    """POST /api/hq/events/<pk>/<decision>/ — approve, reject, suspend, reviewed."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk, decision):
        _require_hq_events(request)
        course = _hq_event_or_404(pk)
        if course is None:
            return Response({"error": "not_found"}, status=404)
        data = ensure_object_body(request.data)
        note = (data.get("note") or "").strip()[:2000]
        try:
            if decision == "approve":
                events.approve_event(course, reviewer=request.user)
            elif decision == "reject":
                events.reject_event(course, reviewer=request.user, note=note)
            elif decision == "suspend":
                events.suspend_event(course, reviewer=request.user, note=note)
            elif decision == "reviewed":
                events.mark_event_reviewed(course, reviewer=request.user)
            else:
                return Response({"error": "unknown_decision"}, status=404)
        except events.EventError as exc:
            return Response({"error": str(exc)}, status=400)
        course = _hq_event_or_404(pk)
        return Response(events.event_payload(course, with_school=True))
