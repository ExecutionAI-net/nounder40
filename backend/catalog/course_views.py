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
from django.db.models import F
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.models import Booking
from bookings.services import notify_lesson_cancelled_by_school
from students.models import StudentPackage, StudentSubscription

from .models import Course, Lesson

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
    return datetime.strptime(s[:5], "%H:%M").time()


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


def _refund_bookings(bookings):
    for b in bookings:
        if b.access_source == Booking.AccessSource.PACKAGE and b.student_package_id and b.credits_deducted > 0:
            StudentPackage.objects.filter(pk=b.student_package_id).update(
                credits_remaining=F("credits_remaining") + b.credits_deducted
            )
        elif b.access_source == Booking.AccessSource.SUBSCRIPTION and b.student_subscription_id:
            StudentSubscription.objects.filter(pk=b.student_subscription_id, access_remaining__isnull=False).update(
                access_remaining=F("access_remaining") + 1
            )


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
            .order_by("date", "start_time")
        )
        from_ = request.query_params.get("from")
        to = request.query_params.get("to")
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
                    {"name": lsn.course.name or None, "color": lsn.course.color, "credit_cost": lsn.course.credit_cost}
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
        student_id = request.query_params.get("student")
        if not student_id:
            return Response({"error": "student required"}, status=400)
        ids = Booking.objects.filter(
            student_id=student_id, school_id=school_id, status__in=["confirmed", "attended"]
        ).values_list("lesson_id", flat=True)
        return Response({"lesson_ids": [str(i) for i in ids]})


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
        courses = list(
            Course.objects.filter(school_id=school_id)
            .select_related("lesson_type", "teacher")
            .order_by(F("sort_order").asc(nulls_last=True), "-start_date")
        )
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

        data = request.data
        lesson_type_id = data.get("lesson_type_id")
        if not lesson_type_id:
            return Response({"error": "Missing required fields"}, status=400)

        teacher_id = data.get("teacher_id") or None
        schedules = data.get("schedules") or []
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
        course = Course.objects.create(
            school_id=school_id, lesson_type_id=lesson_type_id,
            teacher_id=first.get("teacher_id") or teacher_id or None,
            room_id=first.get("room_id") or None,
            name=data.get("name") or "",
            description=data.get("description") or "",
            notes=data.get("notes") or "",
            is_online=first.get("is_online") if first.get("is_online") is not None else default_is_online,
            online_link=first.get("online_link") or default_online_link,
            frequency=first.get("frequency") or "weekly",
            start_date=date_cls.fromisoformat(first["start_date"]),
            end_date=date_cls.fromisoformat(first["end_date"]) if first.get("end_date") else None,
            start_time=_parse_time(first["start_time"]),
            duration_minutes=int(first.get("duration_minutes") or 60),
            max_capacity=int(first.get("max_capacity") or 15),
            reserve_spots=int(first.get("reserve_spots") or 0),
            credit_cost=int(first.get("credit_cost") or 1),
            color=first.get("color") or BRAND_COLOR,
            vip_booking_hours_before=int(first.get("vip_booking_hours_before") or 0),
            min_booking_notice_hours=int(first.get("min_booking_notice_hours") or 2),
            waitlist_enabled=bool(first.get("waitlist_enabled")),
            # The wizard's step-1 language was silently dropped before — every
            # course ended up with the model default "it".
            language=data.get("language") or "it",
        )

        lesson_inserts: list[Lesson] = []
        for sched in schedules:
            st_time = _parse_time(sched["start_time"])
            dur = int(sched.get("duration_minutes") or 60)
            end_time = _calc_end_time(st_time, dur)
            base_kwargs = dict(
                course_id=course.id, school_id=school_id,
                teacher_id=sched.get("teacher_id") or teacher_id or None,
                room_id=sched.get("room_id") or None,
                lesson_type_id=lesson_type_id, start_time=st_time, end_time=end_time,
                max_capacity=int(sched.get("max_capacity") or 15), color=sched.get("color") or BRAND_COLOR,
                compensation_plan_id=sched.get("compensation_plan_id") or None,
                is_online=sched.get("is_online") if sched.get("is_online") is not None else default_is_online,
                online_link=sched.get("online_link") or default_online_link,
                language=sched.get("language") or "",  # empty = inherit course language
                status=Lesson.Status.SCHEDULED,
            )

            if sched.get("frequency") == "single":
                lesson_inserts.append(Lesson(date=date_cls.fromisoformat(sched["start_date"]), **base_kwargs))
                continue

            interval = 14 if sched.get("frequency") == "biweekly" else 7
            start_dt = date_cls.fromisoformat(sched["start_date"])
            weekday = sched.get("weekday")
            if weekday and sched.get("frequency") in ("weekly", "biweekly"):
                start_dt = _shift_to_weekday(start_dt, weekday)
            end_dt = date_cls.fromisoformat(sched["end_date"]) if sched.get("end_date") else start_dt + timedelta(days=365)

            current, count = start_dt, 0
            while current <= end_dt and count < 400:
                lesson_inserts.append(Lesson(date=current, **base_kwargs))
                current += timedelta(days=interval)
                count += 1

        if not lesson_inserts:
            course.delete()
            return Response(
                {"error": "No classes could be generated from the given dates — check start/end dates"}, status=400
            )

        Lesson.objects.bulk_create(lesson_inserts)
        return Response({"id": str(course.id), "lessons_created": len(lesson_inserts)})


class SchoolCoursesReorderView(APIView):
    """POST /api/school/courses-reorder/ — Body: {ids: string[]} (full order).
    Sets sort_order = position in the list."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        school_id = _school_id(request)
        if not school_id:
            return Response({"error": "no_active_school"}, status=400)
        ids = request.data.get("ids")
        if not isinstance(ids, list) or not ids:
            return Response({"error": "ids required"}, status=400)
        for i, course_id in enumerate(ids):
            Course.objects.filter(pk=course_id, school_id=school_id).update(sort_order=i + 1)
        return Response({"ok": True})


class SchoolCourseDetailView(APIView):
    """GET/PUT/DELETE /api/school/courses/<pk>/full/ — course detail (with
    linked lesson/booking counts), cascading edit, and cancel+refund delete."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        school_id = _school_id(request)
        course = Course.objects.filter(pk=pk, school_id=school_id).select_related("lesson_type", "teacher").first()
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
            "lesson_types": _lesson_type_names(course.lesson_type),
            "teachers": {"name": course.teacher.name} if course.teacher_id else None,
            "_linked": {"lessons": linked_lessons, "bookings": linked_bookings},
        })

    @transaction.atomic
    def put(self, request, pk):
        school_id = _school_id(request)
        if not school_id:
            return Response({"error": "no_active_school"}, status=400)
        course = Course.objects.filter(pk=pk, school_id=school_id).first()
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
        course.is_online = is_online
        course.online_link = online_link
        if start_time_str:
            course.start_time = _parse_time(start_time_str)
        course.duration_minutes = duration_minutes
        course.max_capacity = max_capacity
        course.reserve_spots = int(data.get("reserve_spots") or 0)
        course.credit_cost = int(data.get("credit_cost") or 1)
        course.color = color
        course.vip_booking_hours_before = int(data.get("vip_booking_hours_before") or 0)
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
                compensation_plan_id=sched.get("compensation_plan_id") or None,
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
                    if (cursor, st_hhmm) not in occupied:
                        inserts.append(build_lesson(sched, cursor, st_time, end_time))
                    cursor += timedelta(days=7)
                if inserts:
                    Lesson.objects.bulk_create(inserts)
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

            inserts = [build_lesson(sched, d, st_time, end_time) for d in desired if d not in existing_dates]
            if inserts:
                Lesson.objects.bulk_create(inserts)

        if would_cancel_bookings:
            if not bool(data.get("confirm_cancel_bookings")):
                # Nothing is kept: the whole request rolls back and the school
                # sees what the change would do before deciding.
                transaction.set_rollback(True)
                return Response(
                    {"error": "bookings_would_be_cancelled", "lessons": len(would_cancel_lessons), "bookings": len(would_cancel_bookings)},
                    status=409,
                )
            _refund_bookings(would_cancel_bookings)
            Booking.objects.filter(id__in=[b.id for b in would_cancel_bookings]).update(
                status=Booking.Status.CANCELLED, cancelled_at=timezone.now(),
                cancellation_type=Booking.CancellationType.WITHIN_POLICY, credit_refunded=True,
            )
            notify_lesson_cancelled_by_school(would_cancel_bookings)

        return Response({"id": str(course.id)})

    def delete(self, request, pk):
        school_id = _school_id(request)
        if not school_id:
            return Response({"error": "no_active_school"}, status=400)

        # Deleting the course nulls Lesson.course, which would lose the
        # inherited language on booking/credit history — stamp it first.
        course = Course.objects.filter(pk=pk, school_id=school_id).first()
        if course and course.language:
            Lesson.objects.filter(course_id=pk, language="").update(language=course.language)

        today = date_cls.today()
        lesson_ids = list(
            Lesson.objects.filter(course_id=pk, school_id=school_id, date__gte=today)
            .exclude(status=Lesson.Status.CANCELLED)
            .values_list("id", flat=True)
        )

        bookings = list(_confirmed_bookings(lesson_id__in=lesson_ids))
        _refund_bookings(bookings)
        booking_ids = [b.id for b in bookings]
        if booking_ids:
            Booking.objects.filter(id__in=booking_ids).update(
                status=Booking.Status.CANCELLED, cancelled_at=timezone.now(),
                cancellation_type=Booking.CancellationType.WITHIN_POLICY, credit_refunded=True,
            )
        if lesson_ids:
            Lesson.objects.filter(id__in=lesson_ids).update(status=Lesson.Status.CANCELLED)
        notify_lesson_cancelled_by_school(bookings)

        deleted, _ = Course.objects.filter(pk=pk, school_id=school_id).delete()
        return Response({"deleted": bool(deleted), "classes_cancelled": len(lesson_ids)})


class SchoolClassCreateView(APIView):
    """POST /api/school/classes/ — create one or more lessons under an
    existing course (single date, or a weekly/biweekly recurrence)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        school_id = _school_id(request)
        if not school_id:
            return Response({"error": "no_active_school"}, status=400)

        data = request.data
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
            compensation_plan_id=data.get("compensation_plan_id") or None,
            notes=data.get("notes") or "",
            is_online=is_online, online_link=online_link or "",
            language=data.get("language") or "",  # empty = inherit course language
            start_time=st_time, end_time=end_time,
            max_capacity=int(data.get("max_capacity") or course.max_capacity or 15),
            status=Lesson.Status.SCHEDULED,
        )

        frequency = data.get("frequency") or "single"
        lessons: list[Lesson] = []
        if frequency == "single":
            lessons.append(Lesson(date=date_cls.fromisoformat(date_str), **base_kwargs))
        else:
            interval = 14 if frequency == "biweekly" else 7
            start_dt = date_cls.fromisoformat(date_str)
            end_date_str = data.get("end_date")
            end_dt = date_cls.fromisoformat(end_date_str) if end_date_str else start_dt + timedelta(days=365)
            current = start_dt
            while current <= end_dt and len(lessons) < 200:
                lessons.append(Lesson(date=current, **base_kwargs))
                current += timedelta(days=interval)

        Lesson.objects.bulk_create(lessons)
        return Response({"created": len(lessons)})


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
            "language": lesson.language,
            "courses": (
                {
                    "id": str(lesson.course_id), "name": lesson.course.name,
                    "color": lesson.course.color, "language": lesson.course.language,
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
        lesson = Lesson.objects.filter(pk=pk, school_id=school_id).first()
        if not lesson:
            return Response({"error": "Class not found"}, status=404)

        data = request.data
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
            lesson.teacher_id = data.get("teacher_id") or None
            fields.append("teacher")
        if "room_id" in data:
            lesson.room_id = data.get("room_id") or None
            fields.append("room")
        if "date" in data:
            lesson.date = date_cls.fromisoformat(data["date"])
            fields.append("date")
        if "max_capacity" in data:
            lesson.max_capacity = int(data["max_capacity"])
            fields.append("max_capacity")
        if "status" in data:
            lesson.status = data["status"]
            fields.append("status")
        if "compensation_plan_id" in data:
            lesson.compensation_plan_id = data.get("compensation_plan_id") or None
            fields.append("compensation_plan")
        if "notes" in data:
            lesson.notes = data.get("notes") or ""
            fields.append("notes")
        if "is_online" in data:
            lesson.is_online = bool(data["is_online"])
            fields.append("is_online")
        if "online_link" in data:
            lesson.online_link = data.get("online_link") or ""
            fields.append("online_link")
        if "language" in data:
            lesson.language = data.get("language") or ""
            fields.append("language")
        if data.get("start_time"):
            lesson.start_time = _parse_time(data["start_time"])
            fields.append("start_time")
            if data.get("duration_minutes"):
                lesson.end_time = _calc_end_time(lesson.start_time, int(data["duration_minutes"]))
                fields.append("end_time")

        lesson.save(update_fields=fields or None)
        return Response({"class": {"id": str(lesson.id)}})

    def delete(self, request, pk):
        school_id = _school_id(request)
        lesson = Lesson.objects.filter(pk=pk, school_id=school_id).first()
        if not lesson:
            return Response({"error": "Class not found"}, status=404)

        bookings = list(_confirmed_bookings(lesson_id=pk))
        _refund_bookings(bookings)
        booking_ids = [b.id for b in bookings]
        if booking_ids:
            Booking.objects.filter(id__in=booking_ids).update(
                status=Booking.Status.CANCELLED, cancelled_at=timezone.now(),
                cancellation_type=Booking.CancellationType.WITHIN_POLICY, credit_refunded=True,
            )
        lesson.status = Lesson.Status.CANCELLED
        lesson.save(update_fields=["status"])
        notify_lesson_cancelled_by_school(bookings)
        return Response({"cancelled": True, "refunded": len(booking_ids)})


class SchoolClassStudentsView(APIView):
    """POST/DELETE /api/school/classes/<pk>/students/ — school manually
    enrolls/removes a student on a class (books/cancels on their behalf),
    using the same subscription-then-package deduction priority and
    within-policy refund as a normal student booking."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        school_id = _school_id(request)
        student_id = request.data.get("student_id")
        if not student_id:
            return Response({"error": "student_id required"}, status=400)

        lesson = Lesson.objects.filter(pk=pk, school_id=school_id).select_related("course").first()
        if not lesson:
            return Response({"error": "Class not found"}, status=404)
        if lesson.status == Lesson.Status.CANCELLED:
            return Response({"error": "Class is cancelled"}, status=400)
        if Booking.objects.filter(lesson_id=pk, student_id=student_id, status__in=["confirmed", "attended"]).exists():
            return Response({"error": "Student already booked"}, status=400)

        credit_cost = lesson.course.credit_cost if lesson.course_id else 1
        access_source = Booking.AccessSource.PACKAGE
        student_package_id = None
        student_subscription_id = None
        credits_deducted = 0

        sub = StudentSubscription.objects.filter(student_id=student_id, school_id=school_id, status="active").first()
        if sub and (sub.access_total is None or (sub.access_remaining or 0) > 0):
            access_source = Booking.AccessSource.SUBSCRIPTION
            student_subscription_id = sub.id
            if sub.access_total is not None:
                StudentSubscription.objects.filter(pk=sub.id).update(access_remaining=F("access_remaining") - 1)
        else:
            pkg = (
                StudentPackage.objects.filter(
                    student_id=student_id, school_id=school_id, status="active", credits_remaining__gte=credit_cost
                )
                .order_by("expires_at")
                .first()
            )
            if not pkg:
                return Response({"error": "Student has no valid credits or subscription"}, status=400)
            student_package_id = pkg.id
            credits_deducted = credit_cost
            StudentPackage.objects.filter(pk=pkg.id).update(credits_remaining=F("credits_remaining") - credit_cost)

        booking = Booking.objects.create(
            student_id=student_id, lesson_id=pk, school_id=school_id, access_source=access_source,
            student_package_id=student_package_id, student_subscription_id=student_subscription_id,
            credits_deducted=credits_deducted, status=Booking.Status.CONFIRMED, booked_at=timezone.now(),
        )
        Lesson.objects.filter(pk=pk).update(current_bookings=F("current_bookings") + 1)
        return Response({"booking": {"id": str(booking.id)}})

    def delete(self, request, pk):
        school_id = _school_id(request)
        student_id = request.query_params.get("student_id")
        if not student_id:
            return Response({"error": "student_id required"}, status=400)

        booking = Booking.objects.filter(
            lesson_id=pk, student_id=student_id, school_id=school_id, status="confirmed"
        ).first()
        if not booking:
            return Response({"error": "Booking not found"}, status=404)

        _refund_bookings([booking])
        booking.status = Booking.Status.CANCELLED
        booking.cancelled_at = timezone.now()
        booking.cancellation_type = Booking.CancellationType.WITHIN_POLICY
        booking.credit_refunded = True
        booking.save(update_fields=["status", "cancelled_at", "cancellation_type", "credit_refunded"])

        lesson = Lesson.objects.filter(pk=pk, school_id=school_id).first()
        if lesson:
            Lesson.objects.filter(pk=pk).update(current_bookings=max(0, (lesson.current_bookings or 1) - 1))
        return Response({"removed": True})
