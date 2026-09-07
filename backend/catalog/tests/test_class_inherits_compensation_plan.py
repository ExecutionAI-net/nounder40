"""QA_REGRESSION_ROUND2 R2-H7: "Add lesson" (POST /api/school/classes/) had
no fallback to the course's own compensation_plan_id, unlike teacher_id/
room_id right next to it in the same dict -- and unlike the wizard's and the
edit-schedule's own lesson-creation paths, which already inherit it. The
Add-lesson form's plan select defaults to "Like the course" by sending
nothing at all (same convention as teacher/room), so a class added this way
silently got no compensation plan -- the teacher's fee for it then computed
as 0 with no visible cause."""
import uuid
from datetime import date, timedelta

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from catalog.models import Course, Lesson, LessonType
from schools.models import School
from teachers.models import CompensationPlan

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def lesson_type():
    return LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")


@pytest.fixture
def plan(school):
    return CompensationPlan.objects.create(school=school, name="Base Plan", base_fee=20)


@pytest.fixture
def course(school, lesson_type, plan):
    return Course.objects.create(school=school, lesson_type=lesson_type, credit_cost=1, compensation_plan=plan)


@pytest.fixture
def staff_client(school):
    staff = User.objects.create(
        email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    client = APIClient()
    client.force_authenticate(staff)
    return client


def test_add_lesson_inherits_course_compensation_plan_when_not_specified(course, plan, staff_client):
    body = {
        "course_id": str(course.id), "date": (date.today() + timedelta(days=7)).isoformat(),
        "start_time": "10:00", "duration_minutes": 60,
    }
    resp = staff_client.post("/api/school/classes/", body, format="json")
    assert resp.status_code == 200, resp.content
    lesson = Lesson.objects.get(course=course)
    assert lesson.compensation_plan_id == plan.id


def test_add_lesson_explicit_plan_overrides_course_plan(course, plan, school, staff_client):
    other_plan = CompensationPlan.objects.create(school=school, name="Other Plan", base_fee=30)
    body = {
        "course_id": str(course.id), "date": (date.today() + timedelta(days=7)).isoformat(),
        "start_time": "10:00", "duration_minutes": 60, "compensation_plan_id": str(other_plan.id),
    }
    resp = staff_client.post("/api/school/classes/", body, format="json")
    assert resp.status_code == 200, resp.content
    lesson = Lesson.objects.get(course=course)
    assert lesson.compensation_plan_id == other_plan.id


def test_add_lesson_recurring_also_inherits_course_compensation_plan(course, plan, staff_client):
    body = {
        "course_id": str(course.id), "date": (date.today() + timedelta(days=7)).isoformat(),
        "start_time": "10:00", "duration_minutes": 60, "frequency": "weekly",
        "end_date": (date.today() + timedelta(days=21)).isoformat(),
    }
    resp = staff_client.post("/api/school/classes/", body, format="json")
    assert resp.status_code == 200, resp.content
    lessons = Lesson.objects.filter(course=course)
    assert lessons.exists()
    assert all(lsn.compensation_plan_id == plan.id for lsn in lessons)


def test_add_lesson_on_a_course_with_no_plan_still_gets_none(school, lesson_type, staff_client):
    plan_less_course = Course.objects.create(school=school, lesson_type=lesson_type, credit_cost=1)
    body = {
        "course_id": str(plan_less_course.id), "date": (date.today() + timedelta(days=7)).isoformat(),
        "start_time": "10:00", "duration_minutes": 60,
    }
    resp = staff_client.post("/api/school/classes/", body, format="json")
    assert resp.status_code == 200, resp.content
    lesson = Lesson.objects.get(course=plan_less_course)
    assert lesson.compensation_plan_id is None
