"""period_compensation (the teacher's payout, the Teachers tab of the
reports) pays a lesson with its course's plan when the lesson has none of
its own and the teacher-school link has none either -- the same
lesson -> course -> link resolution as the Lessons tab
(teachers.services.lesson_plan)."""
import uuid
from datetime import date, time, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from catalog.models import Course, Lesson, LessonType
from schools.models import School
from teachers.models import CompensationPlan, Teacher, TeacherSchool
from teachers.services import lesson_plan, period_compensation

pytestmark = pytest.mark.django_db
User = get_user_model()
YESTERDAY = date.today() - timedelta(days=1)


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome")


@pytest.fixture
def teacher(school):
    user = User.objects.create(email=f"t-{uuid.uuid4().hex[:8]}@example.com")
    teacher = Teacher.objects.create(user=user, name="Andrea", email=user.email)
    TeacherSchool.objects.create(teacher=teacher, school=school, active=True)
    return teacher


def _lesson(school, teacher, *, course_plan=None, lesson_plan=None):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Ballet")
    course = Course.objects.create(school=school, lesson_type=lt, credit_cost=Decimal("1.0"), compensation_plan=course_plan)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt, teacher=teacher, compensation_plan=lesson_plan,
        date=YESTERDAY, start_time=time(18, 0), end_time=time(19, 0), max_capacity=10, status="scheduled",
    )


def test_period_compensation_pays_the_course_plan(school, teacher):
    course_plan = CompensationPlan.objects.create(school=school, name="Corso", base_fee=Decimal("30"))
    _lesson(school, teacher, course_plan=course_plan)

    comp = period_compensation(teacher, school, YESTERDAY, YESTERDAY)
    assert comp["total"] == 30.0
    assert comp["breakdown"][0]["plan_name"] == "Corso"


def test_lesson_plan_resolution_order(school, teacher):
    link_plan = CompensationPlan.objects.create(school=school, name="Insegnante", base_fee=Decimal("20"))
    course_plan = CompensationPlan.objects.create(school=school, name="Corso", base_fee=Decimal("30"))
    own_plan = CompensationPlan.objects.create(school=school, name="Scheda", base_fee=Decimal("50"))

    assert lesson_plan(_lesson(school, teacher, course_plan=course_plan, lesson_plan=own_plan), link_plan) is own_plan
    assert lesson_plan(_lesson(school, teacher, course_plan=course_plan), link_plan) == course_plan
    assert lesson_plan(_lesson(school, teacher), link_plan) is link_plan
    assert lesson_plan(_lesson(school, teacher)) is None
