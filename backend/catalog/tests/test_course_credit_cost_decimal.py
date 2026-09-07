"""QA H-1: Course.credit_cost is a DecimalField with half-credit steps
(models.py: `DecimalField(max_digits=5, decimal_places=1)`), but both the
course creation wizard and the course edit endpoint cast the incoming value
with `int(...)`, silently truncating 1.5/2.5 down to 1/2. A school entering
a half-credit cost saw the form accept it with no error, while the persisted
value was quietly wrong -- invisible until students were charged the wrong
number of credits per lesson. Fixed by converting through Decimal instead."""
import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from catalog.models import Course, LessonType
from schools.models import School

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def setup():
    school = School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    staff = User.objects.create(
        email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    client = APIClient()
    client.force_authenticate(staff)
    return client, school, lt


def test_create_wizard_preserves_half_credit_cost(setup):
    client, school, lt = setup
    start = (date.today() + timedelta(days=7)).isoformat()
    body = {
        "lesson_type_id": str(lt.id),
        "schedules": [{
            "weekday": "monday", "start_date": start, "start_time": "10:00", "duration_minutes": 60,
        }],
        "credit_cost": 1.5,
    }
    resp = client.post("/api/school/courses-create/", body, format="json")
    assert resp.status_code == 200, resp.content

    course = Course.objects.get(school=school, lesson_type=lt)
    assert course.credit_cost == Decimal("1.5")


def test_create_wizard_preserves_another_half_credit_cost(setup):
    client, school, lt = setup
    start = (date.today() + timedelta(days=7)).isoformat()
    body = {
        "lesson_type_id": str(lt.id),
        "schedules": [{
            "weekday": "monday", "start_date": start, "start_time": "10:00", "duration_minutes": 60,
        }],
        "credit_cost": 2.5,
    }
    resp = client.post("/api/school/courses-create/", body, format="json")
    assert resp.status_code == 200, resp.content

    course = Course.objects.get(school=school, lesson_type=lt)
    assert course.credit_cost == Decimal("2.5")


def test_create_wizard_missing_credit_cost_still_defaults_to_one(setup):
    """The old `int(course_level("credit_cost", 1) or 1)` idiom replaced a
    falsy value (missing, 0) with 1 -- preserved so this isn't a behavior
    change for schools that never set a credit cost."""
    client, school, lt = setup
    start = (date.today() + timedelta(days=7)).isoformat()
    body = {
        "lesson_type_id": str(lt.id),
        "schedules": [{
            "weekday": "monday", "start_date": start, "start_time": "10:00", "duration_minutes": 60,
        }],
    }
    resp = client.post("/api/school/courses-create/", body, format="json")
    assert resp.status_code == 200, resp.content

    course = Course.objects.get(school=school, lesson_type=lt)
    assert course.credit_cost == Decimal("1")


def test_edit_endpoint_preserves_half_credit_cost(setup):
    client, school, lt = setup
    course = Course.objects.create(
        school=school, lesson_type=lt, credit_cost=1, start_time="10:00", duration_minutes=60,
    )
    body = {
        "lesson_type_id": str(lt.id),
        "start_time": "10:00",
        "duration_minutes": 60,
        "max_capacity": 15,
        "credit_cost": 2.5,
        "schedules": [],
    }
    resp = client.put(f"/api/school/courses/{course.id}/full/", body, format="json")
    assert resp.status_code == 200, resp.content

    course.refresh_from_db()
    assert course.credit_cost == Decimal("2.5")


def test_edit_endpoint_missing_credit_cost_still_defaults_to_one(setup):
    client, school, lt = setup
    course = Course.objects.create(
        school=school, lesson_type=lt, credit_cost=3, start_time="10:00", duration_minutes=60,
    )
    body = {
        "lesson_type_id": str(lt.id),
        "start_time": "10:00",
        "duration_minutes": 60,
        "max_capacity": 15,
        "schedules": [],
    }
    resp = client.put(f"/api/school/courses/{course.id}/full/", body, format="json")
    assert resp.status_code == 200, resp.content

    course.refresh_from_db()
    assert course.credit_cost == Decimal("1")
