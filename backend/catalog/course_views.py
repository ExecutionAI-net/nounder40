"""Custom school-side Course/Lesson lifecycle endpoints: the course creation
wizard (multi-schedule lesson generation), cascading course edit
(update_future_lessons + always-on window management), linked-record-aware
course delete (cancel + refund future lessons/bookings), drag-reorder, and
single-class CRUD + manual student enrollment.

These replicate the original Next.js/Supabase route handlers closely
(including *_id-suffixed field naming) rather than going through
CourseViewSet/LessonViewSet's generic CRUD — the frontend components were
built against that exact request/response shape, and the cascade logic
(batched weekday-matching, window management, refund bookkeeping) is too
bespoke to express as generic ModelViewSet actions."""

from datetime import date as date_cls
from datetime import datetime, time, timedelta

from django.db import transaction
from django.db.models import F, Max, Q
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.models import Attendance, Booking
from catalog.services import CreditCostError, credit_cost_decimal as _credit_cost_decimal
from core.params import (
    ensure_object_body,
    parse_date,
    parse_int,
    parse_time,
    parse_uuid,
    parse_uuid_list,
)
from bookings.services import (
    BookingError,
    cancel_bookings_by_school,
    refund_bookings,
    staff_enrol,
    staff_unenrol,
)

from .realtime import broadcast_calendar_change, broadcast_calendar_refresh
from .models import Course, Lesson
from .services import LESSON_FEED_ORDER, cascade_delete_course, date_in_school_closure

BRAND_COLOR = "#6B1F3A"
WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
WEEKDAY_INDEX = {name: i for i, name in enumerate(WEEKDAY_NAMES)}


def _weekday_name(d: date_cls) -> str:
    return WEEKDAY_NAMES[d.weekday()]


def _shift_to_weekday(d: date_cls, weekday: str) -> date_cls:
    """Nearest occurrence of `weekday` on or after `d` (advances, never goes back)."""
    target = WEEKDAY_INDEX.get(weekday)
    if target is None:
        return d
    return d + timedelta(days=(target - d.weekday()) % 7)


def _parse_time(s: str) -> time:
    # X-R3-06: strptime("25:99") is a ValueError, i.e. a 500 from a wizard
    # field any client can send by hand. parse_time answers 400 instead.
    return parse_time(s, "start_time")


def _hhmm(t: time | None) -> str | None:
    return t.strftime("%H:%M") if t else None


def _calc_end_time(start: time, duration_minutes: int) -> time:
    base = datetime.combine(date_cls.today(), start) + timedelta(minutes=duration_minutes)
    return base.time()


def _school_id(request):
    return request.user.active_school_id


def _foreign_school_ref_error(school_id, *, teacher_id=None, room_id=None, compensation_plan_id=None):
    """None-safe ownership check for FK ids a school passes into a course/
    lesson write (teacher_id, room_id, compensation_plan_id): these came
    straight out of request.data with no verification that the referenced
    row actually belongs to school_id, so a school could otherwise create a
    lesson pointing at another school's teacher/room/compensation plan.
    Returns an error string to return as a 400, or None if everything checks out."""
    from schools.models import SchoolRoom
    from teachers.models import CompensationPlan, TeacherSchool

    # X-R3-06: these ids came straight from the body, so teacher_id="x"
    # reached the ORM and raised, instead of failing the ownership check this
    # helper exists for.
    teacher_id = parse_uuid(teacher_id, "teacher_id")
    room_id = parse_uuid(room_id, "room_id")
    compensation_plan_id = parse_uuid(compensation_plan_id, "compensation_plan_id")

    if teacher_id and not TeacherSchool.objects.filter(teacher_id=teacher_id, school_id=school_id).exists():
        return "teacher does not belong to this school"
    if room_id and not SchoolRoom.objects.filter(pk=room_id, location__school_id=school_id).exists():
        return "room does not belong to this school"
    if compensation_plan_id and not CompensationPlan.objects.filter(pk=compensation_plan_id, school_id=school_id).exists():
        return "compensation plan does not belong to this school"
    return None


def _confirmed_bookings(**lesson_filter):
    """Confirmed bookings with everything the cancellation email needs loaded."""
    return Booking.objects.filter(status="confirmed", **lesson_filter).select_related(
        "student__user", "school", "lesson__lesson_type", "lesson__teacher", "lesson__room__location",
        "lesson__course__teacher", "lesson__course__room__location",
    )


# Moved to bookings.services (it also serves the teacher "staff" path now);
# the local name stays for the lesson-cancellation call sites below.
_refund_bookings = refund_bookings


def _lesson_type_names(lesson_type):
    if lesson_type is None:
        return None
    return {
        "name_it": lesson_type.name_it, "name_en": lesson_type.name_en,
        "name_fr": lesson_type.name_fr, "name_es": lesson_type.name_es,
    }


class SchoolLessonsFeedView(APIView):
    """GET /api/school/lessons-feed/?from=&to= — calendar view feed: lessons
    in a date range with nested course/lesson-type/teacher/room names (the
    embed shape CalendarClient.tsx renders directly)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        school_id = _school_id(request)
        if not school_id:
            return Response({"error": "no_active_school"}, status=400)

        qs = (
            Lesson.objects.filter(school_id=school_id)
            # Cancelled lessons stay visible (grey, "Annullata") in the calendar
            # and the lessons list: the school must see what it cancelled.
            .select_related("course", "lesson_type", "teacher", "room__location")
            .order_by(*LESSON_FEED_ORDER)
        )
        from_ = parse_date(request.query_params.get("from"), "from")
        to = parse_date(request.query_params.get("to"), "to")
        if from_:
            qs = qs.filter(date__gte=from_)
        if to:
            qs = qs.filter(date__lte=to)

        data = [
            {
                "id": str(lsn.id), "date": lsn.date.isoformat(), "start_time": _hhmm(lsn.start_time),
                "end_time": _hhmm(lsn.end_time), "max_capacity": lsn.max_capacity,
                "current_bookings": lsn.current_bookings, "status": lsn.status,
                "course_id": str(lsn.course_id) if lsn.course_id else None, "is_online": lsn.is_online,
                # Effective instruction language: lesson override, else course
                "language": lsn.language or (lsn.course.language if lsn.course_id else None),
                "courses": (
                    {
                        "name": lsn.course.name or None, "color": lsn.course.color,
                        "credit_cost": lsn.course.credit_cost,
                        "is_special_event": lsn.course.is_special_event,
                        "sort_order": lsn.course.sort_order,
                    }
                    if lsn.course_id else None
                ),
                "lesson_types": {"name_en": lsn.lesson_type.name_en} if lsn.lesson_type_id else None,
                "teachers": {"name": lsn.teacher.name} if lsn.teacher_id else None,
                "school_rooms": (
                    {"name": lsn.room.name, "school_locations": {"name": lsn.room.location.name}}
                    if lsn.room_id else None
                ),
            }
            for lsn in qs
        ]
        return Response(data)


class SchoolStudentLessonIdsView(APIView):
    """GET /api/school/student-lesson-ids/?student=<Student id> — lesson ids
    a student holds a confirmed/attended booking on, for the calendar's
    student filter."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        school_id = _school_id(request)
        if not school_id:
            return Response({"error": "no_active_school"}, status=400)
        student_id = parse_uuid(request.query_params.get("student"), "student")
        if not student_id:
            return Response({"error": "student required"}, status=400)
        ids = Booking.objects.filter(
            student_id=student_id, school_id=school_id, status__in=["confirmed", "attended"]
        ).values_list("lesson_id", flat=True)
        return Response({"lesson_ids": [str(i) for i in ids]})


_MODES = {"inperson", "online"}


def _overview_filter_q(params):
    """`?teacher=&weekday=&start_time=&location=&room=&mode=` of the Courses
    page (each a comma-separated multi-select) as one Q over upcoming lessons,
    or None when no filter is given. A lesson has to satisfy ALL the filters
    given (the page's rule: one schedule row matches them all)."""
    q = Q()
    teachers = parse_uuid_list(params.get("teacher"), "teacher")
    if teachers:
        # The lesson's own teacher, else the course's default one
        q &= Q(teacher_id__in=teachers) | Q(teacher__isnull=True, course__teacher_id__in=teachers)
    weekdays = [w for w in (params.get("weekday") or "").split(",") if w]
    if weekdays:
        unknown = [w for w in weekdays if w not in WEEKDAY_INDEX]
        if unknown:
            raise ValidationError({"weekday": f"unknown weekday {unknown[0]!r}"})
        q &= Q(date__iso_week_day__in=[WEEKDAY_INDEX[w] + 1 for w in weekdays])
    times = [parse_time(v, "start_time") for v in (params.get("start_time") or "").split(",") if v]
    if times:
        by_time = Q()
        for t in times:
            by_time |= Q(start_time__hour=t.hour, start_time__minute=t.minute)
        q &= by_time
    locations = parse_uuid_list(params.get("location"), "location")
    if locations:
        q &= Q(room__location_id__in=locations)
    rooms = parse_uuid_list(params.get("room"), "room")
    if rooms:
        q &= Q(room_id__in=rooms)
    modes = [m for m in (params.get("mode") or "").split(",") if m]
    if any(m not in _MODES for m in modes):
        raise ValidationError({"mode": "must be inperson and/or online"})
    if len(set(modes)) == 1:  # both modes selected = no restriction
        q &= Q(is_online=(modes[0] == "online"))
    return q if q.children else None


def _upcoming_course_lessons(school_id):
    """Lessons the Courses page summarises into schedules: upcoming, not
    cancelled, of this school's regular (non special-event) courses."""
    return Lesson.objects.filter(
        school_id=school_id, course__isnull=False, course__is_special_event=False, date__gte=date_cls.today()
    ).exclude(status=Lesson.Status.CANCELLED)


class SchoolCoursesFilterOptionsView(APIView):
    """GET /api/school/courses-filter-options/ — what the Courses page's
    filters can offer, straight from the upcoming lessons (distinct values in
    the database), so the page can show its filters before it loads any
    course."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        school_id = _school_id(request)
        if not school_id:
            return Response({"error": "no_active_school"}, status=400)

        lessons = _upcoming_course_lessons(school_id)
        weekdays = {_weekday_name(d) for d in lessons.values_list("date", flat=True).distinct()}
        start_times = sorted({_hhmm(t) for t in lessons.values_list("start_time", flat=True).distinct() if t})
        teachers = {
            (str(tid), name)
            for tid, name in lessons.filter(teacher__isnull=False).values_list("teacher_id", "teacher__name").distinct()
        } | {
            (str(tid), name)
            for tid, name in lessons.filter(teacher__isnull=True, course__teacher__isnull=False)
            .values_list("course__teacher_id", "course__teacher__name").distinct()
        }
        rooms = lessons.filter(room__isnull=False).values_list(
            "room_id", "room__name", "room__location_id", "room__location__name"
        ).distinct()
        room_rows, location_rows = [], {}
        for room_id, room_name, location_id, location_name in rooms:
            room_rows.append({"id": str(room_id), "name": room_name, "location_id": str(location_id) if location_id else None})
            if location_id:
                location_rows[str(location_id)] = location_name
        return Response({
            "weekdays": [d for d in WEEKDAY_NAMES if d in weekdays],
            "start_times": start_times,
            "teachers": [{"id": i, "name": n} for i, n in sorted(teachers, key=lambda t: (t[1] or "").lower())],
            "locations": [{"id": i, "name": n} for i, n in sorted(location_rows.items(), key=lambda t: (t[1] or "").lower())],
            "rooms": sorted(room_rows, key=lambda r: (r["name"] or "").lower()),
        })


class SchoolCoursesOverviewView(APIView):
    """GET /api/school/courses-overview/ — course list with nested lesson
    type/teacher names and a `_schedules` summary (unique weekday+time+
    teacher+room combos derived from upcoming lessons), mirroring the old
    Server Component's aggregation for the Courses list page."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        school_id = _school_id(request)
        if not school_id:
            return Response({"error": "no_active_school"}, status=400)

        today = date_cls.today()
        courses_qs = (
            # Special events have their own page (SPECIAL_EVENTS.md)
            Course.objects.filter(school_id=school_id, is_special_event=False)
            .select_related("lesson_type", "teacher")
            .order_by(F("sort_order").asc(nulls_last=True), "-start_date")
        )
        # Filters (see _overview_filter_q) narrow the list to the courses with
        # at least one matching upcoming lesson. Each course keeps ALL its
        # schedule rows, the matching ones or not: same card as unfiltered.
        lesson_filter = _overview_filter_q(request.query_params)
        if lesson_filter is not None:
            matching = _upcoming_course_lessons(school_id).filter(lesson_filter).values("course_id")
            courses_qs = courses_qs.filter(id__in=matching)
        courses = list(courses_qs)
        course_ids = [c.id for c in courses]

        lessons = (
            list(
                Lesson.objects.filter(course_id__in=course_ids, date__gte=today)
                .exclude(status=Lesson.Status.CANCELLED)
                .select_related("teacher", "room__location")
                .order_by("date")
            )
            if course_ids
            else []
        )

        schedules_by_course: dict[str, list[dict]] = {}
        for lesson in lessons:
            weekday = _weekday_name(lesson.date)
            teacher_id = str(lesson.teacher_id) if lesson.teacher_id else None
            room = lesson.room
            location_name = room.location.name if room else None
            room_name = room.name if room else None
            start_time = _hhmm(lesson.start_time) or ""

            bucket = schedules_by_course.setdefault(str(lesson.course_id), [])
            existing = next(
                (
                    s for s in bucket
                    if s["weekday"] == weekday and s["start_time"] == start_time
                    and s["teacher_id"] == teacher_id and s["location_name"] == location_name
                    and s["room_name"] == room_name
                ),
                None,
            )
            duration = None
            if lesson.start_time and lesson.end_time:
                duration = (
                    lesson.end_time.hour * 60 + lesson.end_time.minute
                    - (lesson.start_time.hour * 60 + lesson.start_time.minute)
                )
            if existing:
                existing["class_count"] += 1
                existing["last_date"] = lesson.date.isoformat()
                if not existing["color"] and lesson.color:
                    existing["color"] = lesson.color
            else:
                bucket.append({
                    "weekday": weekday,
                    "start_time": start_time,
                    "duration_minutes": duration if duration and duration > 0 else 60,
                    "class_count": 1,
                    "first_date": lesson.date.isoformat(),
                    "last_date": lesson.date.isoformat(),
                    "teacher_id": teacher_id,
                    "teacher_name": lesson.teacher.name if lesson.teacher_id else None,
                    "location_name": location_name,
                    "room_name": room_name,
                    "max_capacity": lesson.max_capacity,
                    "is_online": lesson.is_online,
                    "color": lesson.color or None,
                })

        data = [
            {
                "id": str(c.id), "name": c.name, "color": c.color, "frequency": c.frequency,
                "start_time": _hhmm(c.start_time), "duration_minutes": c.duration_minutes,
                "start_date": c.start_date.isoformat() if c.start_date else None,
                "end_date": c.end_date.isoformat() if c.end_date else None,
                "active": c.active, "notes": c.notes,
                "lesson_types": _lesson_type_names(c.lesson_type),
                "teachers": {"name": c.teacher.name} if c.teacher_id else None,
                "_schedules": schedules_by_course.get(str(c.id), []),
            }
            for c in courses
        ]
        return Response(data)


class SchoolCoursesCreateView(APIView):
    """POST /api/school/courses-create/ — course creation wizard: creates the
    Course template row (from the first schedule's values) then generates
    Lesson instances for every schedule (single / weekly / biweekly)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        school_id = _school_id(request)
        if not school_id:
            return Response({"error": "no_active_school"}, status=400)

        data = ensure_object_body(request.data)
        lesson_type_id = parse_uuid(data.get("lesson_type_id"), "lesson_type_id")
        if not lesson_type_id:
            return Response({"error": "Missing required fields"}, status=400)

        teacher_id = parse_uuid(data.get("teacher_id"), "teacher_id")
        schedules = data.get("schedules") or []
        # X-R3-06: schedules="x" indexed the string and then called .get() on
        # a single character -> 500.
        if not isinstance(schedules, list) or not all(isinstance(item, dict) for item in schedules):
            return Response({"error": "schedules must be a list of objects"}, status=400)
        if not schedules or not schedules[0].get("start_date") or not schedules[0].get("start_time"):
            return Response({"error": "At least one schedule with start date and time is required"}, status=400)

        for s in schedules:
            if s.get("end_date") and s.get("start_date") and s["end_date"] < s["start_date"]:
                return Response(
                    {"error": f"End date ({s['end_date']}) is before start date ({s['start_date']})"}, status=400
                )

        default_is_online = bool(data.get("is_online"))
        default_online_link = data.get("online_link") or ""

        # Every schedule can carry its own teacher/room/compensation plan —
        # check all of them (plus the top-level fallback) up front, before
        # creating anything, so a school can't smuggle in another school's
        # resources via any one schedule.
        for tid in {teacher_id, *(s.get("teacher_id") for s in schedules)}:
            err = _foreign_school_ref_error(school_id, teacher_id=tid)
            if err:
                return Response({"error": err}, status=400)
        for rid in {s.get("room_id") for s in schedules}:
            err = _foreign_school_ref_error(school_id, room_id=rid)
            if err:
                return Response({"error": err}, status=400)
        for cid in {s.get("compensation_plan_id") for s in schedules}:
            err = _foreign_school_ref_error(school_id, compensation_plan_id=cid)
            if err:
                return Response({"error": err}, status=400)

        first = schedules[0]

        # Crediti, VIP, preavviso, posti riservati e piano compensi si
        # definiscono sul corso (come insegnante e lingua); i vecchi client
        # li mandavano dentro il primo orario — resta il fallback.
        def course_level(key, default):
            return data.get(key) if data.get(key) is not None else (first.get(key) if first.get(key) is not None else default)

        err = _foreign_school_ref_error(school_id, compensation_plan_id=data.get("compensation_plan_id"))
        if err:
            return Response({"error": err}, status=400)
        try:
            credit_cost = _credit_cost_decimal(course_level("credit_cost", 1))
        except CreditCostError as e:
            return Response({"error": str(e)}, status=400)
        course = Course.objects.create(
            school_id=school_id, lesson_type_id=lesson_type_id,
            teacher_id=first.get("teacher_id") or teacher_id or None,
            room_id=first.get("room_id") or None,
            compensation_plan_id=data.get("compensation_plan_id") or None,
            name=data.get("name") or "",
            description=data.get("description") or "",
            notes=data.get("notes") or "",
            internal_notes=data.get("internal_notes") or "",
            email_info=data.get("email_info") or "",
            is_online=first.get("is_online") if first.get("is_online") is not None else default_is_online,
            online_link=first.get("online_link") or default_online_link,
            frequency=first.get("frequency") or "weekly",
            start_date=parse_date(first["start_date"], "start_date"),
            end_date=parse_date(first.get("end_date"), "end_date"),
            start_time=_parse_time(first["start_time"]),
            duration_minutes=parse_int(first.get("duration_minutes"), "duration_minutes", default=60) or 60,
            max_capacity=parse_int(first.get("max_capacity"), "max_capacity", default=15) or 15,
            reserve_spots=parse_int(course_level("reserve_spots", 0), "reserve_spots", default=0) or 0,
            credit_cost=credit_cost,
            color=first.get("color") or BRAND_COLOR,
            vip_booking_hours_before=parse_int(
                course_level("vip_booking_hours_before", 0), "vip_booking_hours_before", default=0
            ) or 0,
            min_booking_notice_hours=parse_int(
                course_level("min_booking_notice_hours", 2), "min_booking_notice_hours", default=2
            ) or 2,
            waitlist_enabled=bool(first.get("waitlist_enabled")),
            # The wizard's step-1 language was silently dropped before — every
            # course ended up with the model default "it".
            language=data.get("language") or "it",
        )

        lesson_inserts: list[Lesson] = []
        # QA SCH-R2-14 / R2-M7: le date saltate perche' la scuola e' chiusa
        # sparivano senza dire niente (una singola su un giorno di chiusura
        # creava il corso e basta). Ora tornano nella risposta.
        skipped_closures: list[str] = []
        for sched in schedules:
            st_time = _parse_time(sched["start_time"])
            dur = parse_int(sched.get("duration_minutes"), "duration_minutes", default=60) or 60
            end_time = _calc_end_time(st_time, dur)
            base_kwargs = dict(
                course_id=course.id, school_id=school_id,
                teacher_id=sched.get("teacher_id") or teacher_id or None,
                room_id=sched.get("room_id") or None,
                lesson_type_id=lesson_type_id, start_time=st_time, end_time=end_time,
                max_capacity=int(sched.get("max_capacity") or 15), color=sched.get("color") or BRAND_COLOR,
                compensation_plan_id=sched.get("compensation_plan_id") or course.compensation_plan_id or None,
                is_online=sched.get("is_online") if sched.get("is_online") is not None else default_is_online,
                online_link=sched.get("online_link") or default_online_link,
                language=sched.get("language") or "",  # empty = inherit course language
                status=Lesson.Status.SCHEDULED,
            )

            if sched.get("frequency") == "single":
                single_date = date_cls.fromisoformat(sched["start_date"])
                if date_in_school_closure(school_id, single_date):
                    skipped_closures.append(single_date.isoformat())
                else:
                    lesson_inserts.append(Lesson(date=single_date, **base_kwargs))
                continue

            interval = 14 if sched.get("frequency") == "biweekly" else 7
            start_dt = date_cls.fromisoformat(sched["start_date"])
            weekday = sched.get("weekday")
            if weekday and sched.get("frequency") in ("weekly", "biweekly"):
                start_dt = _shift_to_weekday(start_dt, weekday)
            end_dt = date_cls.fromisoformat(sched["end_date"]) if sched.get("end_date") else start_dt + timedelta(days=365)

            current, count = start_dt, 0
            while current <= end_dt and count < 400:
                # QA #8: skip dates the school has marked closed — a weekly
                # recurrence otherwise happily generates a bookable lesson on
                # a day the school itself is shut.
                if date_in_school_closure(school_id, current):
                    skipped_closures.append(current.isoformat())
                else:
                    lesson_inserts.append(Lesson(date=current, **base_kwargs))
                current += timedelta(days=interval)
                count += 1

        if not lesson_inserts:
            course.delete()
            return Response(
                {
                    "error": "No classes could be generated from the given dates — check start/end dates",
                    "skipped_closure_dates": sorted(set(skipped_closures)),
                },
                status=400,
            )

        Lesson.objects.bulk_create(lesson_inserts)
        broadcast_calendar_refresh(course.school_id, {lsn.teacher_id for lsn in lesson_inserts})  # TCH-R4-07
        return Response({
            "id": str(course.id),
            "lessons_created": len(lesson_inserts),
            "skipped_closure_dates": sorted(set(skipped_closures)),
        })


class SchoolCoursesReorderView(APIView):
    """POST /api/school/courses-reorder/ — Body: {ids: string[]} (the new
    order of those courses).

    The full list (every regular course of the school) is numbered 1..n, as
    always. A SUBSET -- the Courses page shows only the filtered courses --
    is put in the new order inside the positions those courses already
    occupy, so the courses that are not in the request keep theirs and no
    position is handed out twice."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        school_id = _school_id(request)
        if not school_id:
            return Response({"error": "no_active_school"}, status=400)
        ids = ensure_object_body(request.data).get("ids")
        if not isinstance(ids, list) or not ids:
            return Response({"error": "ids required"}, status=400)
        # X-R3-06: {"ids": ["x"]} reached filter(pk="x") -> 500.
        ids = list(dict.fromkeys(parse_uuid_list(ids, "ids")))

        by_id = {c.id: c for c in Course.objects.filter(school_id=school_id, pk__in=ids)}
        ordered = [by_id[i] for i in ids if i in by_id]
        regular = set(Course.objects.filter(school_id=school_id, is_special_event=False).values_list("pk", flat=True))
        if regular <= set(by_id):
            slots = list(range(1, len(ordered) + 1))
        else:
            taken = sorted(c.sort_order for c in ordered if c.sort_order is not None)
            top = Course.objects.filter(school_id=school_id).aggregate(m=Max("sort_order"))["m"] or 0
            unplaced = sum(1 for c in ordered if c.sort_order is None)
            slots = taken + list(range(top + 1, top + 1 + unplaced))
        for course, slot in zip(ordered, slots):
            if course.sort_order != slot:
                Course.objects.filter(pk=course.pk).update(sort_order=slot)
        return Response({"ok": True})


class SchoolCourseDetailView(APIView):
    """GET/PUT/DELETE /api/school/courses/<pk>/full/ — course detail (with
    linked lesson/booking counts), cascading edit, and cancel+refund delete."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        school_id = _school_id(request)
        course = (
            Course.objects.filter(pk=pk, school_id=school_id, is_special_event=False)
            .select_related("lesson_type", "teacher").first()
        )
        if not course:
            return Response({"error": "Course not found"}, status=404)

        lesson_ids = list(
            Lesson.objects.filter(course_id=pk).exclude(status=Lesson.Status.CANCELLED).values_list("id", flat=True)
        )
        linked_lessons = len(lesson_ids)
        linked_bookings = Booking.objects.filter(lesson_id__in=lesson_ids, status="confirmed").count()

        return Response({
            "id": str(course.id), "name": course.name, "color": course.color, "frequency": course.frequency,
            "lesson_type_id": str(course.lesson_type_id) if course.lesson_type_id else None,
            "teacher_id": str(course.teacher_id) if course.teacher_id else None,
            "room_id": str(course.room_id) if course.room_id else None,
            "description": course.description, "notes": course.notes,
            "internal_notes": course.internal_notes,
            "email_info": course.email_info,
            "is_online": course.is_online, "online_link": course.online_link,
            "language": course.language,
            "start_time": _hhmm(course.start_time),
            "start_date": course.start_date.isoformat() if course.start_date else None,
            "end_date": course.end_date.isoformat() if course.end_date else None,
            "duration_minutes": course.duration_minutes, "max_capacity": course.max_capacity,
            "reserve_spots": course.reserve_spots, "credit_cost": course.credit_cost,
            "vip_booking_hours_before": course.vip_booking_hours_before,
            "min_booking_notice_hours": course.min_booking_notice_hours,
            "waitlist_enabled": course.waitlist_enabled, "image_url": course.image_url, "active": course.active,
            "compensation_plan_id": str(course.compensation_plan_id) if course.compensation_plan_id else None,
            "lesson_types": _lesson_type_names(course.lesson_type),
            "teachers": {"name": course.teacher.name} if course.teacher_id else None,
            "_linked": {"lessons": linked_lessons, "bookings": linked_bookings},
        })

    @transaction.atomic
    def put(self, request, pk):
        school_id = _school_id(request)
        if not school_id:
            return Response({"error": "no_active_school"}, status=400)
        # Special events have their own endpoints (SPECIAL_EVENTS.md)
        course = Course.objects.filter(pk=pk, school_id=school_id, is_special_event=False).first()
        if not course:
            return Response({"error": "Update failed"}, status=404)

        data = request.data
        lesson_type_id = data.get("lesson_type_id")
        if not lesson_type_id:
            return Response({"error": "missing_fields", "fields": ["lesson_type_id"]}, status=400)

        teacher_id = data.get("teacher_id") or None
        room_id = data.get("room_id") or None
        is_online = bool(data.get("is_online"))
        online_link = data.get("online_link") or ""
        start_time_str = data.get("start_time")
        duration_minutes = int(data.get("duration_minutes") or 60)
        max_capacity = int(data.get("max_capacity") or 15)
        color = data.get("color") or BRAND_COLOR
        update_future_lessons = bool(data.get("update_future_lessons"))
        schedule_list = data.get("schedules") or []

        for tid in {teacher_id, *(s.get("teacher_id") for s in schedule_list if "teacher_id" in s)}:
            err = _foreign_school_ref_error(school_id, teacher_id=tid)
            if err:
                return Response({"error": err}, status=400)
        for rid in {room_id, *(s.get("room_id") for s in schedule_list if "room_id" in s)}:
            err = _foreign_school_ref_error(school_id, room_id=rid)
            if err:
                return Response({"error": err}, status=400)
        for cid in {s.get("compensation_plan_id") for s in schedule_list}:
            err = _foreign_school_ref_error(school_id, compensation_plan_id=cid)
            if err:
                return Response({"error": err}, status=400)

        course.lesson_type_id = lesson_type_id
        course.teacher_id = teacher_id
        course.room_id = room_id
        course.name = data.get("name") or ""
        course.description = data.get("description") or ""
        course.notes = data.get("notes") or ""
        if "internal_notes" in data:
            course.internal_notes = data.get("internal_notes") or ""
        course.email_info = data.get("email_info") or ""
        course.is_online = is_online
        course.online_link = online_link
        if start_time_str:
            course.start_time = _parse_time(start_time_str)
        course.duration_minutes = duration_minutes
        course.max_capacity = max_capacity
        course.reserve_spots = int(data.get("reserve_spots") or 0)
        try:
            course.credit_cost = _credit_cost_decimal(data.get("credit_cost"))
        except CreditCostError as e:
            return Response({"error": str(e)}, status=400)
        course.color = color
        course.vip_booking_hours_before = int(data.get("vip_booking_hours_before") or 0)
        if "compensation_plan_id" in data:
            err = _foreign_school_ref_error(school_id, compensation_plan_id=data.get("compensation_plan_id"))
            if err:
                return Response({"error": err}, status=400)
            course.compensation_plan_id = data.get("compensation_plan_id") or None
        course.min_booking_notice_hours = int(data.get("min_booking_notice_hours") or 2)
        course.waitlist_enabled = bool(data.get("waitlist_enabled"))
        if data.get("language"):
            course.language = data["language"]
        course.save()

        match_list = [s for s in schedule_list if not s.get("is_new")]
        today = date_cls.today()

        def load_future_lessons():
            return list(
                Lesson.objects.filter(course_id=pk, school_id=school_id, date__gte=today)
                .exclude(status=Lesson.Status.CANCELLED)
                .order_by("date")
            )

        def build_lesson(sched, d, st, end_time):
            return Lesson(
                course_id=course.id, school_id=school_id,
                teacher_id=(sched.get("teacher_id") if "teacher_id" in sched else teacher_id) or None,
                room_id=(sched.get("room_id") if "room_id" in sched else room_id) or None,
                lesson_type_id=lesson_type_id, date=d, start_time=st, end_time=end_time,
                max_capacity=sched.get("max_capacity") or max_capacity or 15,
                color=sched.get("color") or color or BRAND_COLOR,
                compensation_plan_id=sched.get("compensation_plan_id") or course.compensation_plan_id or None,
                is_online=sched.get("is_online") if sched.get("is_online") is not None else is_online,
                online_link=(sched.get("online_link") if "online_link" in sched else online_link) or "",
                language=sched.get("language") or "",  # empty = inherit course language
                status=Lesson.Status.SCHEDULED,
            )

        def build_update_dict(sched):
            st_str = sched.get("start_time") or start_time_str
            dur = sched.get("duration_minutes") or duration_minutes
            upd = {
                "lesson_type_id": lesson_type_id,
                "max_capacity": sched.get("max_capacity") or max_capacity or 15,
                "teacher_id": (sched.get("teacher_id") if "teacher_id" in sched else teacher_id) or None,
                "room_id": (sched.get("room_id") if "room_id" in sched else room_id) or None,
                "is_online": sched.get("is_online") if sched.get("is_online") is not None else is_online,
                "online_link": (sched.get("online_link") if "online_link" in sched else online_link) or "",
            }
            if "language" in sched:
                upd["language"] = sched.get("language") or ""
            if "compensation_plan_id" in sched:
                upd["compensation_plan_id"] = sched.get("compensation_plan_id") or course.compensation_plan_id or None
            if st_str:
                st_time = _parse_time(st_str)
                upd["start_time"] = st_time
                upd["end_time"] = _calc_end_time(st_time, dur)
            return upd

        if update_future_lessons:
            future_lessons = load_future_lessons()
            grouped: dict[int, list] = {}
            shifted = []

            for lesson in future_lessons:
                lesson_weekday = _weekday_name(lesson.date)
                lesson_time = _hhmm(lesson.start_time)
                candidates = [
                    (i, s) for i, s in enumerate(match_list)
                    if (s.get("original_weekday") and s.get("original_weekday") == lesson_weekday)
                    or (not s.get("original_weekday") and s.get("weekday") == lesson_weekday)
                ]
                found = next(
                    (
                        (i, s) for i, s in candidates
                        if ((s.get("original_start_time") or s.get("start_time")) or "")[:5] == lesson_time
                    ),
                    None,
                )
                if found is None and len(candidates) == 1:
                    found = candidates[0]
                if found is None:
                    continue
                idx, sched = found
                if sched.get("weekday") and sched.get("weekday") != lesson_weekday:
                    shifted.append((lesson, _shift_to_weekday(lesson.date, sched["weekday"]), sched))
                else:
                    grouped.setdefault(idx, []).append(lesson.id)

            for idx, ids in grouped.items():
                Lesson.objects.filter(id__in=ids).update(**build_update_dict(match_list[idx]))
            for lesson, new_date, sched in shifted:
                Lesson.objects.filter(id=lesson.id).update(date=new_date, **build_update_dict(sched))

        # Window management — ALWAYS runs (new schedules and start/end date
        # changes must persist even when the school chose "update template only")
        fresh_lessons = load_future_lessons()
        occupied = {(lsn.date, _hhmm(lsn.start_time)) for lsn in fresh_lessons}
        # Lessons that fall out of a shortened window and already have bookings:
        # the school must confirm first, then they go through the same path as
        # "cancel lesson and refund" (refund all, email all). Empty ones just go.
        would_cancel_lessons: set = set()
        would_cancel_bookings: list = []
        touched_teachers: set = set()  # TCH-R4-07: teacher groups to refresh at the end
        # QA SCH-R2-14 / R2-M7: anche qui le date di chiusura saltate tornano
        # nella risposta invece di sparire in silenzio.
        skipped_closures: list[str] = []

        for sched in schedule_list:
            st_str = sched.get("start_time") or start_time_str
            if not st_str:
                continue
            st_time = _parse_time(st_str)
            st_hhmm = st_str[:5]
            dur = sched.get("duration_minutes") or duration_minutes or 60
            end_time = _calc_end_time(st_time, dur)

            if sched.get("is_new"):
                start_date_str = sched.get("start_date")
                if not start_date_str:
                    continue
                end_date = date_cls.fromisoformat(sched.get("end_date") or start_date_str)
                start_raw = date_cls.fromisoformat(start_date_str)
                if start_raw < today:
                    start_raw = today
                first_date = _shift_to_weekday(start_raw, sched["weekday"]) if sched.get("weekday") else start_raw

                inserts, cursor = [], first_date
                while cursor <= end_date and len(inserts) < 200:
                    # QA #8: same closure-date skip as course creation.
                    if (cursor, st_hhmm) not in occupied:
                        if date_in_school_closure(school_id, cursor):
                            skipped_closures.append(cursor.isoformat())
                        else:
                            inserts.append(build_lesson(sched, cursor, st_time, end_time))
                    cursor += timedelta(days=7)
                if inserts:
                    Lesson.objects.bulk_create(inserts)
                    touched_teachers.update(lsn.teacher_id for lsn in inserts)
                continue

            weekday = sched.get("weekday") or sched.get("original_weekday")
            if not weekday:
                continue

            orig_time = (sched.get("original_start_time") or st_str)[:5]
            match_times = {st_hhmm, orig_time}
            sched_lessons = sorted(
                (lsn for lsn in fresh_lessons if _weekday_name(lsn.date) == weekday and _hhmm(lsn.start_time) in match_times),
                key=lambda lsn: lsn.date,
            )

            # Colore, piano compensi, online/in presenza e lingua si applicano
            # SEMPRE alle lezioni future dell'orario (metadata-only, non toccano
            # date/prenotazioni)
            if sched_lessons:
                meta = {}
                if "color" in sched:
                    meta["color"] = sched.get("color")
                if "compensation_plan_id" in sched:
                    meta["compensation_plan_id"] = sched.get("compensation_plan_id") or None
                if "is_online" in sched:
                    meta["is_online"] = sched.get("is_online")
                if "online_link" in sched:
                    meta["online_link"] = sched.get("online_link") or ""
                if "language" in sched:
                    meta["language"] = sched.get("language") or ""
                if meta:
                    Lesson.objects.filter(id__in=[lsn.id for lsn in sched_lessons]).update(**meta)

            if not sched.get("start_date") and not sched.get("end_date"):
                continue
            if not sched_lessons and not sched.get("start_date"):
                continue

            window_start_raw = sched.get("start_date") or sched_lessons[0].date.isoformat()
            window_end_raw = sched.get("end_date") or sched_lessons[-1].date.isoformat()
            window_start = date_cls.fromisoformat(window_start_raw)
            if window_start < today:
                window_start = today
            window_start = _shift_to_weekday(window_start, weekday)
            window_end = date_cls.fromisoformat(window_end_raw)

            desired = set()
            cursor = window_start
            while cursor <= window_end and len(desired) < 200:
                desired.add(cursor)
                cursor += timedelta(days=7)

            existing_dates = {lsn.date for lsn in sched_lessons}
            to_cancel = [lsn.id for lsn in sched_lessons if lsn.date not in desired]
            if to_cancel:
                booked = list(_confirmed_bookings(lesson_id__in=to_cancel))
                would_cancel_lessons.update(b.lesson_id for b in booked)
                would_cancel_bookings.extend(booked)
                Lesson.objects.filter(id__in=to_cancel).update(status=Lesson.Status.CANCELLED)

            # QA #8: skip closure dates for brand-new lesson instances only —
            # an existing lesson that predates a closure (`to_cancel` above)
            # is left alone, that's a separate, deliberately-out-of-scope
            # "auto-cancel on closure" operation.
            inserts = []
            for d in sorted(desired):
                if d in existing_dates:
                    continue
                if date_in_school_closure(school_id, d):
                    skipped_closures.append(d.isoformat())
                    continue
                inserts.append(build_lesson(sched, d, st_time, end_time))
            if inserts:
                Lesson.objects.bulk_create(inserts)
                touched_teachers.update(lsn.teacher_id for lsn in inserts)

        if would_cancel_bookings:
            if not bool(data.get("confirm_cancel_bookings")):
                # Nothing is kept: the whole request rolls back and the school
                # sees what the change would do before deciding.
                transaction.set_rollback(True)
                return Response(
                    {"error": "bookings_would_be_cancelled", "lessons": len(would_cancel_lessons), "bookings": len(would_cancel_bookings)},
                    status=409,
                )
            cancel_bookings_by_school(would_cancel_bookings)

        # TCH-R4-07: the wizard rewrites, moves and cancels lessons through
        # queryset updates and bulk_create -- none of which signal the
        # calendar. One refresh per group covers all of it.
        touched_teachers.update(Lesson.objects.filter(course=course).values_list("teacher_id", flat=True))
        broadcast_calendar_refresh(course.school_id, touched_teachers)
        return Response({"id": str(course.id), "skipped_closure_dates": sorted(set(skipped_closures))})

    def delete(self, request, pk):
        school_id = _school_id(request)
        if not school_id:
            return Response({"error": "no_active_school"}, status=400)

        # Special events have their own endpoints (SPECIAL_EVENTS.md)
        course = Course.objects.filter(pk=pk, school_id=school_id, is_special_event=False).first()
        if not course:
            return Response({"error": "Course not found"}, status=404)

        # See cascade_delete_course for the ghost-lesson policy (QA #7): past
        # lessons untouched, bookingless future lessons hard-deleted, booked
        # future lessons refunded+cancelled rather than deleted.
        result = cascade_delete_course(course)

        deleted, _ = Course.objects.filter(pk=pk, school_id=school_id, is_special_event=False).delete()
        return Response({
            "deleted": bool(deleted),
            "classes_cancelled": result["lessons_cancelled"] + result["lessons_deleted"],
        })


class SchoolClassCreateView(APIView):
    """POST /api/school/classes/ — create one or more lessons under an
    existing course (single date, or a weekly/biweekly recurrence)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        school_id = _school_id(request)
        if not school_id:
            return Response({"error": "no_active_school"}, status=400)

        data = ensure_object_body(request.data)  # X-R4-03: a list body was a 500
        course_id = data.get("course_id")
        date_str = data.get("date")
        start_time_str = data.get("start_time")
        duration = data.get("duration_minutes")
        if not course_id or not date_str or not start_time_str or not duration:
            return Response({"error": "course_id, date, start_time, duration_minutes are required"}, status=400)

        course = Course.objects.filter(pk=course_id, school_id=school_id).first()
        if not course:
            return Response({"error": "Course not found"}, status=404)

        err = _foreign_school_ref_error(
            school_id,
            teacher_id=data.get("teacher_id"),
            room_id=data.get("room_id"),
            compensation_plan_id=data.get("compensation_plan_id"),
        )
        if err:
            return Response({"error": err}, status=400)

        st_time = _parse_time(start_time_str)
        end_time = _calc_end_time(st_time, int(duration))
        is_online = data.get("is_online") if data.get("is_online") is not None else course.is_online
        online_link = data.get("online_link") if data.get("online_link") is not None else course.online_link

        base_kwargs = dict(
            course_id=course.id, school_id=school_id,
            teacher_id=data.get("teacher_id") or course.teacher_id or None,
            room_id=data.get("room_id") or course.room_id or None,
            lesson_type_id=course.lesson_type_id,
            # QA R2-H7: unlike teacher_id/room_id right above, this had no
            # course fallback -- the "Add lesson" form's compensation-plan
            # select defaults to "Like the course" (sends nothing at all, by
            # design, same as it does for teacher/room), so a class added
            # this way got compensation_plan_id=None outright instead of
            # inheriting the course's plan. The teacher's fee for that lesson
            # then computed as 0 with no visible cause. The wizard's and the
            # edit-schedule's own lesson-creation paths already fall back to
            # course.compensation_plan_id (lines below, ~396/591) -- this is
            # the one lesson-creation path that didn't.
            compensation_plan_id=data.get("compensation_plan_id") or course.compensation_plan_id or None,
            notes=data.get("notes") or "",
            internal_notes=data.get("internal_notes") or "",
            email_info=data.get("email_info") or "",  # empty = inherit course email_info
            is_online=is_online, online_link=online_link or "",
            language=data.get("language") or "",  # empty = inherit course language
            start_time=st_time, end_time=end_time,
            max_capacity=int(data.get("max_capacity") or course.max_capacity or 15),
            status=Lesson.Status.SCHEDULED,
        )

        frequency = data.get("frequency") or "single"
        lessons: list[Lesson] = []
        skipped_closures: list[str] = []
        if frequency == "single":
            single_date = date_cls.fromisoformat(date_str)
            # QA SCH-R2-14 / R2-M7: prima la data chiusa veniva scartata e la
            # risposta era `{"created": 0}` 200 — la scuola credeva di aver
            # creato la lezione. Una singola su un giorno di chiusura ora e'
            # un errore esplicito con la data.
            if date_in_school_closure(school_id, single_date):
                return Response(
                    {"error": "school_closed", "date": single_date.isoformat()}, status=400
                )
            lessons.append(Lesson(date=single_date, **base_kwargs))
        else:
            interval = 14 if frequency == "biweekly" else 7
            start_dt = date_cls.fromisoformat(date_str)
            end_date_str = data.get("end_date")
            end_dt = date_cls.fromisoformat(end_date_str) if end_date_str else start_dt + timedelta(days=365)
            current = start_dt
            while current <= end_dt and len(lessons) < 200:
                # QA #8: skip closure dates here too, same as course creation.
                # QA R2-M7: e le date saltate tornano nella risposta.
                if date_in_school_closure(school_id, current):
                    skipped_closures.append(current.isoformat())
                else:
                    lessons.append(Lesson(date=current, **base_kwargs))
                current += timedelta(days=interval)

        Lesson.objects.bulk_create(lessons)
        broadcast_calendar_refresh(school_id, {lsn.teacher_id for lsn in lessons})  # TCH-R4-07
        return Response({"created": len(lessons), "skipped_closure_dates": sorted(set(skipped_closures))})


class SchoolClassDetailView(APIView):
    """GET/PATCH/DELETE /api/school/classes/<pk>/ — single lesson detail (with
    enrolled students), field edit, and cancel+refund."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        school_id = _school_id(request)
        lesson = (
            Lesson.objects.filter(pk=pk, school_id=school_id)
            .select_related("course", "teacher", "room__location")
            .first()
        )
        if not lesson:
            return Response({"error": "Class not found"}, status=404)

        bookings = (
            Booking.objects.filter(lesson_id=pk, status__in=["confirmed", "attended", "no_show"])
            .select_related("student")
        )
        enrollments = [
            {
                "id": str(b.id), "student_id": str(b.student_id), "access_source": b.access_source,
                "status": b.status, "booked_at": b.booked_at,
                "student": {"name": b.student.name, "email": b.student.email} if b.student_id else None,
            }
            for b in bookings
        ]

        return Response({
            "id": str(lesson.id), "date": lesson.date.isoformat(),
            "start_time": _hhmm(lesson.start_time), "end_time": _hhmm(lesson.end_time),
            "max_capacity": lesson.max_capacity, "current_bookings": lesson.current_bookings,
            "status": lesson.status, "course_id": str(lesson.course_id) if lesson.course_id else None,
            "compensation_plan_id": str(lesson.compensation_plan_id) if lesson.compensation_plan_id else None,
            "notes": lesson.notes, "is_online": lesson.is_online, "online_link": lesson.online_link,
            "internal_notes": lesson.internal_notes,
            "language": lesson.language,
            "email_info": lesson.email_info,
            "courses": (
                {
                    "id": str(lesson.course_id), "name": lesson.course.name,
                    # Special event: edited from /school/events, not here
                    "is_special_event": lesson.course.is_special_event,
                    "color": lesson.course.color, "language": lesson.course.language,
                    "email_info": lesson.course.email_info,
                    "internal_notes": lesson.course.internal_notes,
                    # Il costo crediti vive sul corso: qui e' in sola lettura,
                    # la pagina della lezione lo mostra e rimanda al corso.
                    "credit_cost": str(lesson.course.credit_cost),
                }
                if lesson.course_id else None
            ),
            "teachers": {"id": str(lesson.teacher_id), "name": lesson.teacher.name} if lesson.teacher_id else None,
            "school_rooms": (
                {
                    "id": str(lesson.room_id), "name": lesson.room.name,
                    "school_locations": {"id": str(lesson.room.location_id), "name": lesson.room.location.name},
                }
                if lesson.room_id else None
            ),
            "enrollments": enrollments,
        })

    def patch(self, request, pk):
        school_id = _school_id(request)
        lesson = Lesson.objects.filter(pk=pk, school_id=school_id).select_related("course").first()
        if not lesson:
            return Response({"error": "Class not found"}, status=404)
        if lesson.course_id and lesson.course.is_special_event:
            # The lesson mirrors the event (catalog/events.py): a change here
            # would be overwritten by the next event edit and would skip the
            # HQ "modified" flag and the students' "event updated" email.
            return Response({"error": "special_event_use_events_page", "event_id": str(lesson.course_id)}, status=409)

        data = ensure_object_body(request.data)
        err = _foreign_school_ref_error(
            school_id,
            teacher_id=data.get("teacher_id") if "teacher_id" in data else None,
            room_id=data.get("room_id") if "room_id" in data else None,
            compensation_plan_id=data.get("compensation_plan_id") if "compensation_plan_id" in data else None,
        )
        if err:
            return Response({"error": err}, status=400)

        fields = []
        if "teacher_id" in data:
            lesson.teacher_id = parse_uuid(data.get("teacher_id"), "teacher_id")
            fields.append("teacher")
        if "room_id" in data:
            lesson.room_id = parse_uuid(data.get("room_id"), "room_id")
            fields.append("room")
        if "date" in data:
            new_date = parse_date(data["date"], "date")
            # QA SCH-R2-14 / R2-M7: spostare una lezione su un giorno di
            # chiusura riusciva (200) e produceva una lezione che nessuno puo'
            # prenotare (bookings.services -> `school_closed`).
            if new_date != lesson.date and date_in_school_closure(school_id, new_date):
                return Response({"error": "school_closed", "date": new_date.isoformat()}, status=400)
            lesson.date = new_date
            fields.append("date")
        if "max_capacity" in data:
            # SCH-R4-08b: 0 was accepted (a room's capacity is not).
            lesson.max_capacity = parse_int(data["max_capacity"], "max_capacity", default=1, min_value=1) or 1
            fields.append("max_capacity")
        if "status" in data:
            lesson.status = data["status"]
            fields.append("status")
        if "compensation_plan_id" in data:
            lesson.compensation_plan_id = parse_uuid(data.get("compensation_plan_id"), "compensation_plan_id")
            fields.append("compensation_plan")
        if "notes" in data:
            lesson.notes = data.get("notes") or ""
            fields.append("notes")
        if "internal_notes" in data:
            lesson.internal_notes = data.get("internal_notes") or ""
            fields.append("internal_notes")
        if "is_online" in data:
            lesson.is_online = bool(data["is_online"])
            fields.append("is_online")
        if "online_link" in data:
            lesson.online_link = data.get("online_link") or ""
            fields.append("online_link")
        if "language" in data:
            lesson.language = data.get("language") or ""
            fields.append("language")
        if "email_info" in data:
            lesson.email_info = data.get("email_info") or ""  # empty = inherit course email_info
            fields.append("email_info")
        if data.get("start_time"):
            lesson.start_time = _parse_time(data["start_time"])
            fields.append("start_time")
            if data.get("duration_minutes"):
                lesson.end_time = _calc_end_time(lesson.start_time, int(data["duration_minutes"]))
                fields.append("end_time")

        lesson.save(update_fields=fields or None)
        broadcast_calendar_change(lesson)  # TCH-R4-07
        return Response({"class": {"id": str(lesson.id)}})

    def delete(self, request, pk):
        school_id = _school_id(request)
        lesson = Lesson.objects.filter(pk=pk, school_id=school_id).select_related("course").first()
        if not lesson:
            return Response({"error": "Class not found"}, status=404)
        if lesson.course_id and lesson.course.is_special_event:
            # Cancelling the event's one lesson IS cancelling the event
            from .events import EventError, cancel_event

            try:
                result = cancel_event(lesson.course)
            except EventError as exc:
                return Response({"error": str(exc)}, status=400)
            return Response({"cancelled": True, "refunded": result["bookings_cancelled"]})

        bookings = list(_confirmed_bookings(lesson_id=pk))
        cancel_bookings_by_school(bookings)
        lesson.status = Lesson.Status.CANCELLED
        lesson.save(update_fields=["status"])
        broadcast_calendar_change(lesson)  # TCH-R4-07
        return Response({"cancelled": True, "refunded": len(bookings)})


# Booking rows that are not "cancelled": a confirmed seat (credit still out),
# or attendance already taken (credit burnt, register written). Neither may
# vanish with the lesson.
_LIVE_BOOKING_STATUSES = (Booking.Status.CONFIRMED, Booking.Status.ATTENDED, Booking.Status.NO_SHOW)


def _purge_refusal(lesson) -> str | None:
    """Why this lesson may NOT be deleted for good (None = go ahead).

    Only a cancelled lesson is purgeable: cancelling is what refunds the
    students (SchoolClassDetailView.delete), and the cascade takes the
    cancelled booking rows with it. Two things are never purged:
    - a confirmed booking (a `status` flipped to "cancelled" through PATCH
      skips the refund): cancel it properly first;
    - attendance history (attended / no-show bookings, Attendance rows): the
      credit was burnt and the register written -- deleting the lesson would
      erase both (code review, 13/09/2026)."""
    if lesson.status != Lesson.Status.CANCELLED:
        return "not_cancelled"
    if Booking.objects.filter(lesson=lesson, status=Booking.Status.CONFIRMED).exists():
        return "has_confirmed_bookings"
    if (
        Booking.objects.filter(lesson=lesson, status__in=_LIVE_BOOKING_STATUSES).exists()
        or Attendance.objects.filter(lesson=lesson).exists()
    ):
        return "has_attendance_history"
    return None


class SchoolClassPurgeView(APIView):
    """DELETE /api/school/classes/<pk>/purge/ -- delete a CANCELLED lesson for
    good. Cancelled lessons stay on every calendar on purpose (the school
    must see what it cancelled), but they pile up: Carlo (13/09/2026) wants
    a second step that removes them from every view -- school, teacher and
    student -- once the credits are back. `Booking.lesson` is CASCADE, so the
    cancelled booking rows go too; the refund itself happened at cancellation.
    """

    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        school_id = _school_id(request)
        lesson = Lesson.objects.filter(pk=pk, school_id=school_id).first()
        if not lesson:
            return Response({"error": "Class not found"}, status=404)
        reason = _purge_refusal(lesson)
        if reason:
            return Response(
                {"error": reason, "hint": f"Cancel it first: DELETE /api/school/classes/{pk}/"}, status=409
            )
        broadcast_calendar_change(lesson, deleted=True)  # payload needs the row: before delete()
        lesson.delete()
        return Response({"deleted": 1})


class SchoolCancelledLessonsPurgeView(APIView):
    """POST /api/school/classes/purge-cancelled/ {from, to, course_id?} --
    the same, for every cancelled lesson of the school in a date range (the
    calendar's / lessons list's "delete the cancelled ones" button). Lessons
    that still hold a confirmed booking are skipped, same rule as above."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        school_id = _school_id(request)
        if not school_id:
            return Response({"error": "no_active_school"}, status=400)
        body = ensure_object_body(request.data)
        from_ = parse_date(body.get("from"), "from")
        to = parse_date(body.get("to"), "to")
        if not from_ or not to:
            return Response({"error": "from and to are required"}, status=400)
        course_id = parse_uuid(body.get("course_id"), "course_id")

        # Same rule as _purge_refusal(): a confirmed seat or attendance
        # history keeps the lesson.
        qs = (
            Lesson.objects.filter(
                school_id=school_id, status=Lesson.Status.CANCELLED, date__gte=from_, date__lte=to
            )
            .exclude(bookings__status__in=_LIVE_BOOKING_STATUSES)
            .exclude(attendance__isnull=False)
        )
        if course_id:
            qs = qs.filter(course_id=course_id)
        rows = list(qs.values_list("id", "teacher_id"))
        if not rows:
            return Response({"deleted": 0})
        ids = [lesson_id for lesson_id, _ in rows]
        teacher_ids = {teacher_id for _, teacher_id in rows if teacher_id}
        deleted = Lesson.objects.filter(id__in=ids).delete()[1].get("catalog.Lesson", 0)
        broadcast_calendar_refresh(school_id, teacher_ids)
        return Response({"deleted": deleted})


class SchoolClassStudentsView(APIView):
    """POST/DELETE /api/school/classes/<pk>/students/ — school manually
    enrolls/removes a student on a class (books/cancels on their behalf),
    using the same subscription-then-package deduction priority and
    within-policy refund as a normal student booking. The engine is
    bookings.services.staff_enrol / staff_unenrol, shared with the teacher
    "staff" path; the responses here are unchanged."""

    permission_classes = [IsAuthenticated]

    _ENROL_ERRORS = {
        "lesson_cancelled": "Class is cancelled",
        "already_booked": "Student already booked",
        "no_valid_access": "Student has no valid credits or subscription",
        "lesson_full": "Class is full",
    }

    def post(self, request, pk):
        school_id = _school_id(request)
        body = ensure_object_body(request.data)
        student_id = parse_uuid(body.get("student_id"), "student_id")
        if not student_id:
            return Response({"error": "student_id required"}, status=400)

        lesson = Lesson.objects.filter(pk=pk, school_id=school_id).select_related("course").first()
        if not lesson:
            return Response({"error": "Class not found"}, status=404)
        try:
            booking = staff_enrol(lesson, student_id, allow_overbooking=bool(body.get("allow_overbooking")), actor=request.user)
        except BookingError as exc:
            # QA R2-M12: the desk is allowed to overbook, but it has to say so.
            # 409 (not 400) — nothing about the request is malformed, the seat
            # limit is simply already reached; retry with allow_overbooking.
            if str(exc) == "lesson_full":
                return Response({
                    "error": "lesson_full",
                    "message": self._ENROL_ERRORS["lesson_full"],
                    "current_bookings": lesson.current_bookings or 0,
                    "max_capacity": lesson.max_capacity or 0,
                    "allow_overbooking_required": True,
                }, status=409)
            return Response({"error": self._ENROL_ERRORS.get(str(exc), str(exc))}, status=400)
        payload = {"booking": {"id": str(booking.id)}, "overbooked": bool(getattr(booking, "overbooked", False))}
        if payload["overbooked"]:
            lesson.refresh_from_db(fields=["current_bookings"])
            payload["warning"] = {
                "code": "overbooked",
                "current_bookings": lesson.current_bookings or 0,
                "max_capacity": lesson.max_capacity or 0,
            }
        return Response(payload)

    def delete(self, request, pk):
        school_id = _school_id(request)
        student_id = parse_uuid(request.query_params.get("student_id"), "student_id")
        if not student_id:
            return Response({"error": "student_id required"}, status=400)

        lesson = Lesson.objects.filter(pk=pk, school_id=school_id).first()
        if not lesson:
            return Response({"error": "Booking not found"}, status=404)
        try:
            staff_unenrol(lesson, student_id)
        except BookingError:
            return Response({"error": "Booking not found"}, status=404)
        return Response({"removed": True})
