"""QA_REGRESSION_ROUND2 R2-H9: `_credit_cost_decimal()` accepted any value
with zero validation beyond parsing it as a Decimal. Live-reproduced
consequences: a negative `credit_cost` was stored as-is and booking such a
lesson ADDED credits instead of deducting them (`credits_deducted: -1.0`);
an explicitly-sent `0` was silently replaced by the default of 1, masking
the school's actual (bad) input; and a non-half-step value like `1.25`
wasn't rejected either, just silently rounded to `1.3` by the DB column's
`decimal_places=1` on save. This covers both call sites (create wizard,
full edit) rejecting all three with a clean 400, while a genuinely absent
value still defaults to 1 (see test_course_credit_cost_decimal.py, kept
passing unchanged)."""
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


def _create_body(lt, credit_cost):
    start = (date.today() + timedelta(days=7)).isoformat()
    return {
        "lesson_type_id": str(lt.id),
        "schedules": [{"weekday": "monday", "start_date": start, "start_time": "10:00", "duration_minutes": 60}],
        "credit_cost": credit_cost,
    }


@pytest.mark.parametrize("bad_cost", [-1, 0, 1.25, "not_a_number"])
def test_create_wizard_rejects_invalid_credit_cost(setup, bad_cost):
    client, school, lt = setup
    resp = client.post("/api/school/courses-create/", _create_body(lt, bad_cost), format="json")
    assert resp.status_code == 400, resp.content
    assert not Course.objects.filter(school=school, lesson_type=lt).exists()


def test_create_wizard_still_accepts_a_real_half_step(setup):
    client, school, lt = setup
    resp = client.post("/api/school/courses-create/", _create_body(lt, 1.5), format="json")
    assert resp.status_code == 200, resp.content
    course = Course.objects.get(school=school, lesson_type=lt)
    assert course.credit_cost == Decimal("1.5")


@pytest.mark.parametrize("bad_cost", [-2, 0, 2.25])
def test_edit_endpoint_rejects_invalid_credit_cost(setup, bad_cost):
    client, school, lt = setup
    course = Course.objects.create(
        school=school, lesson_type=lt, credit_cost=Decimal("2"), start_time="10:00", duration_minutes=60,
    )
    body = {
        "lesson_type_id": str(lt.id), "start_time": "10:00", "duration_minutes": 60,
        "max_capacity": 15, "credit_cost": bad_cost, "schedules": [],
    }
    resp = client.put(f"/api/school/courses/{course.id}/full/", body, format="json")
    assert resp.status_code == 400, resp.content

    course.refresh_from_db()
    assert course.credit_cost == Decimal("2")  # untouched by the rejected write
