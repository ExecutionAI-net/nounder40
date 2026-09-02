"""Compensation calculation — base fee + per-student bonus above a threshold,
optionally overridden per lesson type (spec section 7.6)."""

from calendar import monthrange
from datetime import date

from django.db.models import Count

from .models import CompensationPlanRate


def compute_lesson_fee(plan, *, lesson_type_id, students_count) -> float:
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


def monthly_compensation(teacher, school, month: str):
    """month: 'YYYY-MM'. Sums compute_lesson_fee() over every completed lesson
    the teacher taught at this school that month, using their assigned plan
    (falls back to no fee if unassigned)."""
    from bookings.models import Attendance
    from catalog.models import Lesson
    from teachers.models import TeacherSchool

    year, mon = (int(x) for x in month.split("-"))
    start = date(year, mon, 1)
    end = date(year, mon, monthrange(year, mon)[1])

    link = TeacherSchool.objects.filter(teacher=teacher, school=school).select_related("compensation_plan").first()
    link_plan = link.compensation_plan if link else None

    lessons = Lesson.objects.filter(
        teacher=teacher, school=school, date__gte=start, date__lte=end
    ).exclude(status="cancelled").select_related("compensation_plan", "lesson_type").order_by("date", "start_time")

    lessons = list(lessons)
    present_by_lesson = {
        row["lesson_id"]: row["n"]
        for row in Attendance.objects.filter(lesson_id__in=[lsn.id for lsn in lessons], status="present")
        .values("lesson_id").annotate(n=Count("id"))
    }

    breakdown = []
    total = 0.0
    for lesson in lessons:
        # Il piano assegnato al singolo orario (scheda classe) vince sul
        # piano di default del collegamento insegnante-scuola
        plan = lesson.compensation_plan or link_plan
        students_count = present_by_lesson.get(lesson.id, 0)
        fee = compute_lesson_fee(plan, lesson_type_id=lesson.lesson_type_id, students_count=students_count) if plan else 0.0
        total += fee
        breakdown.append(
            {
                "lesson_id": str(lesson.id), "date": lesson.date, "students": students_count,
                "lesson_type": lesson.lesson_type.name_en if lesson.lesson_type_id else "",
                "fee": fee,
                "plan_name": plan.name if plan else None,
                "has_bonus": bool(plan and plan.bonus_threshold is not None and students_count > plan.bonus_threshold),
            }
        )
    plan_names = sorted({b["plan_name"] for b in breakdown if b["plan_name"]})
    return {
        "month": month,
        "plan": ", ".join(plan_names) if plan_names else (link_plan.name if link_plan else None),
        "total": round(total, 2),
        "breakdown": breakdown,
    }
