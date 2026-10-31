"""Compensation calculation — base fee + per-student bonus above a threshold,
optionally overridden per lesson type (spec section 7.6)."""

from calendar import monthrange
from datetime import date

from django.db.models import Count
from django.utils import timezone

from bookings.services import _lesson_datetime

from .models import CompensationPlanRate


_LOOKUP = object()  # compute_lesson_fee: "find the rate yourself"


def compute_lesson_fee(plan, *, lesson_type_id, students_count, rate=_LOOKUP) -> float:
    """`rate`: the plan's CompensationPlanRate for this lesson type, or None
    for none, when the caller already has them (the Reports page indexes
    them once for its 500 rows); left out, it is looked up here."""
    if rate is _LOOKUP:
        rate = None
        if lesson_type_id:
            rate = CompensationPlanRate.objects.filter(plan=plan, lesson_type_id=lesson_type_id).first()

    base_fee = rate.base_fee if rate else plan.base_fee
    bonus_per_student = (
        rate.bonus_per_student if rate and rate.bonus_per_student is not None else plan.bonus_per_student
    )
    fee = float(base_fee)

    if plan.bonus_threshold is not None and bonus_per_student and students_count > plan.bonus_threshold:
        extra_students = students_count - plan.bonus_threshold
        if plan.bonus_max_threshold is not None:
            extra_students = min(extra_students, float(plan.bonus_max_threshold))
        fee += extra_students * float(bonus_per_student)

    return round(fee, 2)


def period_compensation(teacher, school, start: date, end: date):
    """Sums compute_lesson_fee() over every lesson the teacher held at this
    school from `start` to `end` (both included), using their assigned plan
    (falls back to no fee if unassigned). monthly_compensation is the
    one-month case; the Reports page's Teachers tab asks for any period.

    "Held" means scheduled, not cancelled, and already started. It does NOT
    mean attendance was marked, and it does not mean anyone showed up: a past
    lesson with an empty roster still pays its base fee.

    TCH-R2-12 / TCH-R3-04 raised that twice as a possible bug. It is the
    policy, not an oversight:
      - the plan's own copy says so in five languages -- "base fee per class
        plus optional per-student bonuses" (school.compensation.subtitle),
        "Base X € per lesson · bonus Y € per student above Z"
        (teacher.dashboard.tooltipBaseFee). The head count moves the bonus;
        the base fee is for holding the class.
      - the two exclusions below are deliberate and were each a fix (a
        cancelled lesson, QA #10; one that has not started yet, QA C3). A
        school that does not want to pay for a class nobody booked cancels
        it, and the fee goes with it.
      - it could not be keyed off attendance anyway: a lesson with no
        bookings has an empty roster, so it can never be marked and never
        reaches status "completed" -- and a real, taught class would lose its
        fee whenever the teacher forgot to mark it.

    (The word "completed" used to appear here and matched nothing in the
    query, which is most of why the question keeps coming back.)

    A set of concurrent lessons the school pinned (catalog
    .ConcurrentLessonGroup) is one unit of work: one fee, the lead lesson's
    plan on everyone present across the set -- see compensation_rows."""
    rows, link_plan = compensation_rows(teacher, school, start, end)
    plan_names = sorted({row["plan_name"] for row in rows if row["plan_name"]})
    return {
        "plan": ", ".join(plan_names) if plan_names else (link_plan.name if link_plan else None),
        "total": round(sum(row["fee"] for row in rows), 2),
        "breakdown": rows,
    }


def concurrent_key(lesson) -> str:
    """Same day, same start time, same teacher: the key Reports writes on a
    lesson row as `concurrent_key` and ConcurrentLessonGroup pins."""
    from catalog.models import ConcurrentLessonGroup

    return ConcurrentLessonGroup.key_for(lesson.date, lesson.start_time, lesson.teacher_id)


def frozen_group_keys(school_id, teacher_id=None, start=None, end=None) -> set:
    """The keys of the sets this school pinned, optionally one teacher's
    within `start`..`end`. A pin whose set has fallen below two lessons (one
    deleted or moved) is dropped on the way: there is nothing left to merge,
    and a lesson created later in that slot must not inherit a choice the
    school made about other lessons."""
    from catalog.models import ConcurrentLessonGroup, Lesson

    qs = ConcurrentLessonGroup.objects.filter(school_id=school_id)
    if teacher_id:
        qs = qs.filter(teacher_id=teacher_id)
    if start:
        qs = qs.filter(date__gte=start)
    if end:
        qs = qs.filter(date__lte=end)
    pins = list(qs.values_list("id", "date", "start_time", "teacher_id"))
    if not pins:
        return set()
    members = {
        (day, start_time, tid): n
        for day, start_time, tid, n in Lesson.objects.filter(
            school_id=school_id,
            date__in={p[1] for p in pins},
            start_time__in={p[2] for p in pins},
            teacher_id__in={p[3] for p in pins},
        ).order_by().values_list("date", "start_time", "teacher_id").annotate(n=Count("id"))
    }
    stale = {pid for pid, day, start_time, tid in pins if members.get((day, start_time, tid), 0) < 2}
    if stale:
        ConcurrentLessonGroup.objects.filter(id__in=stale).delete()
    return {
        ConcurrentLessonGroup.key_for(day, start_time, tid)
        for pid, day, start_time, tid in pins if pid not in stale
    }


def sort_concurrent(members):
    """A set of concurrent lessons, the one that ran first: a held lesson
    beats a cancelled one (a class called off in the room and kept on Zoom is
    the Zoom lesson's), the in-room one beats the online one, then the one
    with a room; the id keeps the answer stable. The one rule for Reports
    (commerce/report_views._concurrent_groups) and Compensation, so both
    name the same plan and the same room."""
    return sorted(
        members, key=lambda lesson: (lesson.status == "cancelled", lesson.is_online, lesson.room_id is None, str(lesson.id))
    )


def lead_lesson(members):
    return sort_concurrent(members)[0]


def lesson_display_name(lesson):
    """The course's name, else the lesson type's (en, then it); None when
    neither -- the one rule for Reports and Compensation."""
    course_name = (lesson.course.name.strip() or None) if lesson.course_id and lesson.course.name else None
    if not course_name and lesson.lesson_type_id:
        course_name = lesson.lesson_type.name_en or lesson.lesson_type.name_it or None
    return course_name


def compensation_rows(teacher, school, start, end):
    """One row per unit of work the teacher held at `school` from `start` to
    `end` (both included), in date order: a lesson, or a pinned set of
    concurrent lessons (catalog.ConcurrentLessonGroup) as ONE row -- the lead
    lesson's plan computed once on everyone present across the set (4 in the
    room + 2 on Zoom = the plan at 6), its members listed under `lessons`.
    "Held" is period_compensation's policy: not cancelled, already started.
    Returns (rows, link_plan). One source for period_compensation (totals:
    the school's Compensation page, Reports › Teachers) and
    TeacherCompensationOverviewView (the teacher's own page), so the two
    sides always agree on what a pinned set pays."""
    from bookings.models import Attendance
    from catalog.models import Lesson
    from teachers.models import TeacherSchool

    link = TeacherSchool.objects.filter(teacher=teacher, school=school).select_related("compensation_plan").first()
    link_plan = link.compensation_plan if link else None

    # Belt-and-suspenders: attendance can only be marked once a lesson's start
    # datetime has passed (bookings/attendance_views.py), but compensation is
    # computed straight from Lesson rows, not from when attendance was marked —
    # so a future lesson within the requested month is excluded here too,
    # in case attendance is ever written through another path (QA #10).
    # The date-only clamp (`date <= date.today()`) let a lesson later THIS
    # SAME day leak in — a lesson isn't "occurred" until its full start
    # datetime has passed, same definition TeacherAttendanceView already uses
    # (QA C3), so filter by date range first (cheap) then drop anything that
    # hasn't actually happened yet.
    now = timezone.now()
    lessons = (
        Lesson.objects.filter(teacher=teacher, school=school, date__gte=start, date__lte=end)
        .exclude(status="cancelled")
        .select_related("course", "compensation_plan", "lesson_type")
        .order_by("date", "start_time")
    )
    lessons = [lsn for lsn in lessons if _lesson_datetime(lsn) <= now]
    present_by_lesson = {
        row["lesson_id"]: row["n"]
        for row in Attendance.objects.filter(lesson_id__in=[lsn.id for lsn in lessons], status="present")
        .values("lesson_id").annotate(n=Count("id"))
    }

    # A pinned key gathers its lessons into one unit, at the place of the first
    frozen = frozen_group_keys(school.id, teacher.id, start, end)
    units: list = []
    by_key: dict = {}
    for lesson in lessons:
        key = concurrent_key(lesson)
        if key in frozen:
            if key not in by_key:
                by_key[key] = []
                units.append(by_key[key])
            by_key[key].append(lesson)
        else:
            units.append([lesson])

    rows = []
    for members in units:
        if len(members) > 1:
            members = sort_concurrent(members)
        lead = members[0]
        # Il piano assegnato al singolo orario (scheda classe) vince sul
        # piano di default del collegamento insegnante-scuola
        plan = lead.compensation_plan or link_plan
        students_count = sum(present_by_lesson.get(lesson.id, 0) for lesson in members)
        fee = compute_lesson_fee(plan, lesson_type_id=lead.lesson_type_id, students_count=students_count) if plan else 0.0
        has_bonus = bool(plan and plan.bonus_threshold is not None and students_count > plan.bonus_threshold)
        threshold_gap = (
            max(0, plan.bonus_threshold + 1 - students_count)
            if plan and plan.bonus_threshold is not None and not has_bonus
            else 0
        )
        names = [name for name in (lesson_display_name(lesson) for lesson in members) if name]
        rows.append(
            {
                "lesson_id": str(lead.id),
                "lesson_ids": [str(lesson.id) for lesson in members],
                "merged": len(members) > 1,
                "date": lead.date,
                "start_time": lead.start_time,
                "course": " + ".join(dict.fromkeys(names)) or None,
                "students": students_count,
                "lesson_type": lead.lesson_type.name_en if lead.lesson_type_id else "",
                "fee": fee,
                "plan_name": plan.name if plan else None,
                "has_bonus": has_bonus,
                "threshold_gap": threshold_gap,
                # the set's members, for the row's detail lines; empty for a lone lesson
                "lessons": [
                    {
                        "id": str(lesson.id), "course": lesson_display_name(lesson),
                        "is_online": lesson.is_online, "students": present_by_lesson.get(lesson.id, 0),
                    }
                    for lesson in members
                ] if len(members) > 1 else [],
            }
        )
    return rows, link_plan


def monthly_compensation(teacher, school, month: str):
    """month: 'YYYY-MM'. period_compensation over that calendar month, with
    the month itself in the answer (the Compensation pages key on it)."""
    year, mon = (int(x) for x in month.split("-"))
    start = date(year, mon, 1)
    end = date(year, mon, monthrange(year, mon)[1])
    return {"month": month, **period_compensation(teacher, school, start, end)}
