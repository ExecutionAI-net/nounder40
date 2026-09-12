from django.utils import timezone
from rest_framework import status as http_status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import AttendanceStatus, Lesson
from core.params import ensure_object_body, parse_uuid
from core.viewsets import is_hq
from teachers.access import can_manage_bookings, can_view_lesson
from teachers.models import Teacher

from .attendance_serializers import LessonRosterEntrySerializer, MarkAttendanceItemSerializer
from .models import Attendance, Booking
from .services import BookingError, _lesson_datetime, mark_attendance, staff_enrol, staff_unenrol


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
                "attendance_status_id": att.status_ref_id if att else None,
                "marked_at": att.marked_at if att else None,
            }
        )
    return rows


def _attendance_payload(lesson):
    """GET shape shared by the teacher and school attendance pages."""
    statuses = AttendanceStatus.objects.filter(school=lesson.school).order_by("sort_order", "created_at")
    roster = LessonRosterEntrySerializer(_roster(lesson), many=True).data
    course_name = (lesson.course.name or None) if lesson.course_id else None
    if not course_name and lesson.lesson_type_id:
        course_name = lesson.lesson_type.name_en or lesson.lesson_type.name_it

    return {
        "lesson": {
            "id": str(lesson.id),
            "date": lesson.date.isoformat(),
            "start_time": lesson.start_time.strftime("%H:%M") if lesson.start_time else None,
            "status": lesson.status,
            "course_name": course_name,
            "room_name": lesson.room.name if lesson.room_id else None,
            # QA R2-M12: the over-capacity badge was only derivable from the
            # enrol POST, so it vanished on reload. Both attendance pages can
            # now derive it from the roster itself, like the school class page
            # already does.
            "current_bookings": lesson.current_bookings or 0,
            "max_capacity": lesson.max_capacity or 0,
        },
        "statuses": [
            {
                "id": str(s.id), "name": s.name, "color": s.color,
                "burns_credit": s.burns_credit, "is_default": s.is_default, "sort_order": s.sort_order,
            }
            for s in statuses
        ],
        "bookings": roster,
        "already_submitted": any(r["attendance_status"] is not None for r in roster),
    }


def _apply_marks(lesson, teacher, items):
    """Bulk-mark attendance rows; returns `(results, applied)`. When `applied`
    is False nothing was written and `results` holds only the rejected rows.
    `status` may be
    omitted when a custom status_id is given — it is derived from the
    status_ref: `burns_credit` is the "Counts as absence" flag a school sets
    on an AttendanceStatus (School Settings → Attendance Statuses), so
    burns_credit=True → no_show, burns_credit=False → present."""
    from students.models import Student

    # QA TCH-R2-03 / R2-M10: un `status_id` sconosciuto (stato cancellato
    # mentre il registro era aperto) o di un'altra scuola arrivava qui come
    # status_ref=None e veniva derivato in PRESENT, sovrascrivendo in silenzio
    # il segno precedente. Ora la riga e' rifiutata: gli id si validano PRIMA
    # di applicare qualsiasi cosa, cosi' un salvataggio del registro con uno
    # stato non valido non lascia mezzo appello scritto.
    prepared, invalid = [], []
    # X-R4-03 / TCH-R4-01: `{"attendance": "x"}` iterated a string, `[1, 2]`
    # called `.get` on an int and a non-UUID status_id reached the ORM raw --
    # three 500s on the register's main write endpoint.
    if not isinstance(items, (list, tuple)) or not all(isinstance(raw, dict) for raw in items):
        raise ValidationError({"attendance": ["Expected a list of objects."]})
    for raw in items:
        raw = dict(raw)
        status_ref = None
        if raw.get("status_id"):
            status_id = parse_uuid(raw["status_id"], "status_id", allow_blank=False)
            status_ref = AttendanceStatus.objects.filter(pk=status_id, school=lesson.school).first()
            if status_ref is None:
                invalid.append({
                    "student_id": str(raw.get("student_id") or ""),
                    "ok": False,
                    "error": "invalid_status_id",
                })
                continue
        prepared.append((raw, status_ref))

    if invalid:
        return invalid, False

    results = []
    for raw, status_ref in prepared:
        if not raw.get("status"):
            raw["status"] = (
                Attendance.Status.NO_SHOW
                if status_ref is not None and status_ref.burns_credit
                else Attendance.Status.PRESENT
            )
        item = MarkAttendanceItemSerializer(data=raw)
        item.is_valid(raise_exception=True)
        data = item.validated_data

        student = Student.objects.filter(pk=data["student_id"]).first()
        if student is None:
            results.append({"student_id": str(data["student_id"]), "ok": False, "error": "student_not_found"})
            continue
        try:
            mark_attendance(lesson, student, teacher, status=data["status"], status_ref=status_ref)
            results.append({"student_id": str(data["student_id"]), "ok": True})
        except BookingError as exc:
            results.append({"student_id": str(data["student_id"]), "ok": False, "error": str(exc)})

    # Presenze registrate → la lezione è svolta ("scheduled" resta solo per
    # le future: marcarla in anticipo la farebbe sparire dal feed prenotazioni)
    from datetime import date as _date

    if any(r["ok"] for r in results) and lesson.status != "cancelled" and lesson.date <= _date.today():
        lesson.status = "completed"
        lesson.save(update_fields=["status"])
    return results, True


def _caller_teacher(request):
    teacher = Teacher.objects.filter(user=request.user).first()
    if teacher is None:
        raise PermissionDenied("No teacher profile for this account.")
    return teacher


class TeacherAttendanceView(APIView):
    """Teacher's roster + marking for one lesson. GET lists booked students with
    their current attendance; POST bulk-marks [{student_id, status, status_id?}].

    Her own lessons, plus a colleague's when the school made her staff
    (TeacherSchool.can_view_all_lessons — teachers/access.py). A lesson she
    may not see is a 404, not a 403: same answer as a lesson that does not
    exist, nothing to enumerate."""

    permission_classes = [IsAuthenticated]

    def _teacher_lesson(self, request, lesson_id):
        teacher = _caller_teacher(request)
        lesson = (
            Lesson.objects.filter(pk=lesson_id)
            .select_related("course", "lesson_type", "room", "school")
            .first()
        )
        if lesson is None or not can_view_lesson(teacher, lesson):
            return None, teacher
        return lesson, teacher

    def get(self, request, lesson_id):
        lesson, teacher = self._teacher_lesson(request, lesson_id)
        if lesson is None:
            return Response({"error": "lesson_not_found"}, status=http_status.HTTP_404_NOT_FOUND)
        payload = _attendance_payload(lesson)
        # What this page may offer on top of marking (teacher/access.py)
        payload["permissions"] = {
            "is_own": lesson.teacher_id == teacher.id,
            "teacher_name": lesson.teacher.name if lesson.teacher_id else "",
            "can_manage_bookings": can_manage_bookings(teacher, lesson),
        }
        return Response(payload)

    def post(self, request, lesson_id):
        lesson, teacher = self._teacher_lesson(request, lesson_id)
        if lesson is None:
            return Response({"error": "lesson_not_found"}, status=http_status.HTTP_404_NOT_FOUND)

        # Same "has this lesson happened" definition as everywhere else the
        # question comes up (bookings.services._lesson_datetime): a lesson
        # hasn't occurred until its actual start datetime has passed, not just
        # "today or earlier" — so marking right after class ends today still
        # works, but pre-marking a lesson later today or on a future date does
        # not (QA #10: a teacher could inflate compensation this way).
        if timezone.now() < _lesson_datetime(lesson):
            return Response({"error": "lesson_not_yet_occurred"}, status=http_status.HTTP_400_BAD_REQUEST)

        # Recorded under whoever marks (Attendance.teacher); compensation and
        # stats keep following Lesson.teacher, so a staff teacher marking a
        # colleague's lesson does not move a cent.
        # A JSON body that is neither a list nor an object (`"hello"`) used to
        # reach `.get` on a str and 500 (QA TCH-R2-06).
        items = request.data if isinstance(request.data, list) else ensure_object_body(request.data).get("attendance", [])
        results, applied = _apply_marks(lesson, teacher, items)
        payload = {"results": results, "roster": LessonRosterEntrySerializer(_roster(lesson), many=True).data}
        if not applied:
            payload["error"] = "invalid_status_id"
            return Response(payload, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(payload)


class TeacherLessonStudentsView(APIView):
    """A staff teacher (TeacherSchool.can_manage_bookings) managing who is on
    a lesson: GET ?q= searches the school's students, POST {student_id} books
    one on her behalf, DELETE ?student_id= frees her seat with the credit
    back. Same engine as the school panel's manual enrolment
    (bookings.services.staff_enrol / staff_unenrol)."""

    permission_classes = [IsAuthenticated]

    def _lesson(self, request, lesson_id):
        teacher = _caller_teacher(request)
        lesson = Lesson.objects.filter(pk=lesson_id).select_related("course", "school").first()
        if lesson is None or not can_view_lesson(teacher, lesson):
            return None
        if not can_manage_bookings(teacher, lesson):
            raise PermissionDenied("This school has not enabled adding or removing students for you.")
        return lesson

    @staticmethod
    def _student_id(raw):
        import uuid

        try:
            return uuid.UUID(str(raw)) if raw else None
        except ValueError:
            return None

    def _roster_response(self, lesson):
        lesson.refresh_from_db(fields=["current_bookings"])
        return Response({
            "ok": True,
            "current_bookings": lesson.current_bookings,
            "roster": LessonRosterEntrySerializer(_roster(lesson), many=True).data,
        })

    def get(self, request, lesson_id):
        from schools.models import SchoolStudent

        lesson = self._lesson(request, lesson_id)
        if lesson is None:
            return Response({"error": "lesson_not_found"}, status=http_status.HTTP_404_NOT_FOUND)
        q = (request.query_params.get("q") or "").strip()
        links = SchoolStudent.objects.filter(school=lesson.school).select_related("student")
        if q:
            links = links.filter(student__name__icontains=q)
        booked = set(
            Booking.objects.filter(lesson=lesson, status__in=["confirmed", "attended"]).values_list("student_id", flat=True)
        )
        # Names only: enough to pick a student at the door, nothing more of
        # hers leaves the school panel.
        return Response([
            {"id": str(link.student_id), "name": link.student.name, "booked": link.student_id in booked}
            for link in links.order_by("student__name")[:20]
        ])

    def post(self, request, lesson_id):
        from schools.models import SchoolStudent

        lesson = self._lesson(request, lesson_id)
        if lesson is None:
            return Response({"error": "lesson_not_found"}, status=http_status.HTTP_404_NOT_FOUND)
        body = ensure_object_body(request.data)
        student_id = self._student_id(body.get("student_id"))
        if student_id is None:
            return Response({"error": "student_id_required"}, status=http_status.HTTP_400_BAD_REQUEST)
        # The picker only offers this school's students, but the id is
        # client-supplied: a student of another school is not enrollable here.
        if not SchoolStudent.objects.filter(school=lesson.school, student_id=student_id).exists():
            return Response({"error": "student_not_found"}, status=http_status.HTTP_404_NOT_FOUND)
        try:
            booking = staff_enrol(lesson, student_id, allow_overbooking=bool(body.get("allow_overbooking")))
        except BookingError as exc:
            # QA R2-M12: over capacity the staff path stops and asks, instead
            # of silently making a 2-seat lesson 3/2. Retry with
            # {"allow_overbooking": true} to go ahead on purpose.
            if str(exc) == "lesson_full":
                return Response({
                    "error": "lesson_full",
                    "current_bookings": lesson.current_bookings or 0,
                    "max_capacity": lesson.max_capacity or 0,
                    "allow_overbooking_required": True,
                }, status=http_status.HTTP_409_CONFLICT)
            return Response({"error": str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
        response = self._roster_response(lesson)
        response.data["overbooked"] = bool(getattr(booking, "overbooked", False))
        if response.data["overbooked"]:
            lesson.refresh_from_db(fields=["current_bookings"])
            response.data["warning"] = {
                "code": "overbooked",
                "current_bookings": lesson.current_bookings or 0,
                "max_capacity": lesson.max_capacity or 0,
            }
        return response

    def delete(self, request, lesson_id):
        lesson = self._lesson(request, lesson_id)
        if lesson is None:
            return Response({"error": "lesson_not_found"}, status=http_status.HTTP_404_NOT_FOUND)
        student_id = self._student_id(
            request.query_params.get("student_id") or ensure_object_body(request.data).get("student_id")
        )
        if student_id is None:
            return Response({"error": "student_id_required"}, status=http_status.HTTP_400_BAD_REQUEST)
        try:
            staff_unenrol(lesson, student_id)
        except BookingError as exc:
            return Response({"error": str(exc)}, status=http_status.HTTP_404_NOT_FOUND)
        return self._roster_response(lesson)


class SchoolAttendanceView(APIView):
    """School-side attendance for one lesson: GET the same roster/statuses
    payload as the teacher page; POST bulk-marks (recorded under the lesson's
    assigned teacher, if any)."""

    permission_classes = [IsAuthenticated]

    def _school_lesson(self, request, lesson_id):
        lesson = (
            Lesson.objects.filter(pk=lesson_id)
            .select_related("course", "lesson_type", "room", "school", "teacher")
            .first()
        )
        if lesson is None:
            return None
        user = request.user
        if not is_hq(user) and lesson.school_id != user.active_school_id:
            raise PermissionDenied("Not your school.")
        return lesson

    def get(self, request, lesson_id):
        lesson = self._school_lesson(request, lesson_id)
        if lesson is None:
            return Response({"error": "lesson_not_found"}, status=http_status.HTTP_404_NOT_FOUND)
        return Response(_attendance_payload(lesson))

    def post(self, request, lesson_id):
        lesson = self._school_lesson(request, lesson_id)
        if lesson is None:
            return Response({"error": "lesson_not_found"}, status=http_status.HTTP_404_NOT_FOUND)
        # A JSON body that is neither a list nor an object (`"hello"`) used to
        # reach `.get` on a str and 500 (QA TCH-R2-06).
        # QA SCH-R2-08 / R2-M5: identica alla vista insegnante — una lezione
        # non e' "svolta" finche' non e' passato il suo orario di inizio.
        # Senza questo il pannello scuola poteva marcare no_show su una
        # lezione fra due settimane e far partire la mail "ci sei mancata".
        if timezone.now() < _lesson_datetime(lesson):
            return Response({"error": "lesson_not_yet_occurred"}, status=http_status.HTTP_400_BAD_REQUEST)

        items = request.data if isinstance(request.data, list) else ensure_object_body(request.data).get("attendance", [])
        results, applied = _apply_marks(lesson, lesson.teacher, items)
        payload = {"results": results, "roster": LessonRosterEntrySerializer(_roster(lesson), many=True).data}
        if not applied:
            payload["error"] = "invalid_status_id"
            return Response(payload, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(payload)
