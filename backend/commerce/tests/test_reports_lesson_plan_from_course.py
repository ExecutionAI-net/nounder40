"""The Lessons tab pays a lesson with the plan of its course when the lesson
has none of its own (Carlo, 2026-10-29: a school's whole Lessons report
showed no compensation plan and no fee, save one class). Lesson creation
copies the course's plan onto the lesson, but a plan set on the course
after its lessons exist reached the future lessons only, through "update
future classes", and never the past ones: those kept None, and the report
looked only at the lesson and at the teacher-school link. Resolution is
now lesson -> course -> teacher link (teachers.services.lesson_plan)."""
import uuid
from datetime import date, time, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from catalog.models import Course, Lesson, LessonType
from schools.models import School
from teachers.models import CompensationPlan, CompensationPlanRate, Teacher, TeacherSchool

pytestmark = pytest.mark.django_db
User = get_user_model()
URL = "/api/school/reports/detailed/"
YESTERDAY = date.today() - timedelta(days=1)


def _school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome", cancellation_policy_hours=24,
    )


def _teacher(school, plan=None):
    user = User.objects.create(email=f"t-{uuid.uuid4().hex[:8]}@example.com")
    teacher = Teacher.objects.create(user=user, name="Andrea", email=user.email)
    TeacherSchool.objects.create(teacher=teacher, school=school, active=True, compensation_plan=plan)
    return teacher


def _lesson(school, teacher, *, course_plan=None, lesson_plan=None, lesson_type=None):
    lt = lesson_type or LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Ballet")
    course = Course.objects.create(
        school=school, lesson_type=lt, name="Classico", credit_cost=Decimal("1.0"), min_booking_notice_hours=0,
        compensation_plan=course_plan,
    )
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt, teacher=teacher, compensation_plan=lesson_plan,
        date=YESTERDAY, start_time=time(18, 0), end_time=time(19, 0), max_capacity=10, status="scheduled",
    )


def _rows(school):
    hq = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role="hq", roles=["hq"])
    client = APIClient()
    client.force_authenticate(hq)
    res = client.get(URL, {"school": str(school.id), "tab": "lessons"})
    assert res.status_code == 200, res.content
    return {row["id"]: row for row in res.json()["lessons"]["rows"]}


def test_lesson_without_own_plan_is_paid_with_the_course_plan():
    school = _school()
    course_plan = CompensationPlan.objects.create(school=school, name="Corso", base_fee=Decimal("30"))
    teacher = _teacher(school)  # no plan on the link either
    lesson = _lesson(school, teacher, course_plan=course_plan)

    row = _rows(school)[str(lesson.id)]
    assert row["compensation_plan"] == "Corso"
    assert row["compensation_plan_id"] == str(course_plan.id)
    assert row["compensation_fee"] == 30.0


def test_course_plan_per_type_rate_is_found():
    """The rates are indexed once for the whole tab: a course plan's per-type
    rate must be in that index too, or the fee falls back to the base fee."""
    school = _school()
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Pointe")
    course_plan = CompensationPlan.objects.create(school=school, name="Corso", base_fee=Decimal("30"))
    CompensationPlanRate.objects.create(plan=course_plan, lesson_type=lt, base_fee=Decimal("45"))
    lesson = _lesson(school, _teacher(school), course_plan=course_plan, lesson_type=lt)

    assert _rows(school)[str(lesson.id)]["compensation_fee"] == 45.0


def test_lesson_own_plan_beats_the_course_plan():
    school = _school()
    course_plan = CompensationPlan.objects.create(school=school, name="Corso", base_fee=Decimal("30"))
    own_plan = CompensationPlan.objects.create(school=school, name="Scheda", base_fee=Decimal("50"))
    lesson = _lesson(school, _teacher(school), course_plan=course_plan, lesson_plan=own_plan)

    row = _rows(school)[str(lesson.id)]
    assert row["compensation_plan"] == "Scheda"
    assert row["compensation_fee"] == 50.0


def test_course_plan_beats_the_teacher_link_plan():
    school = _school()
    link_plan = CompensationPlan.objects.create(school=school, name="Insegnante", base_fee=Decimal("20"))
    course_plan = CompensationPlan.objects.create(school=school, name="Corso", base_fee=Decimal("30"))
    lesson = _lesson(school, _teacher(school, plan=link_plan), course_plan=course_plan)

    row = _rows(school)[str(lesson.id)]
    assert row["compensation_plan"] == "Corso"
    assert row["compensation_fee"] == 30.0


def test_teacher_link_plan_when_neither_lesson_nor_course_has_one():
    school = _school()
    link_plan = CompensationPlan.objects.create(school=school, name="Insegnante", base_fee=Decimal("20"))
    lesson = _lesson(school, _teacher(school, plan=link_plan))

    row = _rows(school)[str(lesson.id)]
    assert row["compensation_plan"] == "Insegnante"
    assert row["compensation_fee"] == 20.0


def test_no_plan_anywhere_means_no_fee():
    school = _school()
    lesson = _lesson(school, _teacher(school))

    row = _rows(school)[str(lesson.id)]
    assert row["compensation_plan"] == "—"
    assert row["compensation_fee"] is None
