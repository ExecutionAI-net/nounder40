"""QA R2-M9: `CompensationPlan` accepted values only the UI refused.

- `base_fee: -5` → 201 (a negative base fee turns the teacher's pay into a
  debt in every compensation report).
- `bonus_max_threshold` lower than `bonus_threshold` → 201, an empty bonus
  band: the plan advertises a bonus it can never pay.

Both are now enforced in `CompensationPlanSerializer`.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from schools.models import School, SchoolMembership, SchoolRole
from teachers.models import CompensationPlan

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    SchoolRole.objects.update_or_create(
        key="owner",
        defaults={"label": "Owner", "builtin": True, "permissions": ["teachers", "compensation", "settings"]},
    )
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True
    )


@pytest.fixture
def client(school):
    user = User.objects.create(
        email=f"owner-{uuid.uuid4().hex[:8]}@example.com",
        role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    api = APIClient()
    api.force_authenticate(user=user)
    return api


def test_negative_base_fee_is_rejected(client):
    resp = client.post("/api/school/compensation-plans/", {"name": "Bad", "base_fee": "-5"}, format="json")
    assert resp.status_code == 400
    assert "base_fee" in resp.json()
    assert not CompensationPlan.objects.filter(name="Bad").exists()


def test_zero_base_fee_is_accepted(client):
    resp = client.post("/api/school/compensation-plans/", {"name": "Volunteer", "base_fee": "0"}, format="json")
    assert resp.status_code == 201, resp.content


def test_negative_bonus_per_student_is_rejected(client):
    resp = client.post(
        "/api/school/compensation-plans/",
        {"name": "Bad", "base_fee": "20", "bonus_per_student": "-1"}, format="json",
    )
    assert resp.status_code == 400
    assert "bonus_per_student" in resp.json()


def test_max_threshold_below_threshold_is_rejected(client):
    resp = client.post(
        "/api/school/compensation-plans/",
        {"name": "Bad", "base_fee": "20", "bonus_threshold": 10, "bonus_max_threshold": "5"},
        format="json",
    )
    assert resp.status_code == 400
    assert "bonus_max_threshold" in resp.json()


def test_equal_thresholds_are_accepted(client):
    resp = client.post(
        "/api/school/compensation-plans/",
        {"name": "Tight", "base_fee": "20", "bonus_threshold": 5, "bonus_max_threshold": "5"},
        format="json",
    )
    assert resp.status_code == 201, resp.content


def test_valid_plan_still_saves(client):
    resp = client.post(
        "/api/school/compensation-plans/",
        {"name": "Standard", "base_fee": "22", "bonus_threshold": 3,
         "bonus_max_threshold": "10", "bonus_per_student": "5"},
        format="json",
    )
    assert resp.status_code == 201, resp.content
    plan = CompensationPlan.objects.get(name="Standard")
    assert float(plan.base_fee) == 22.0 and float(plan.bonus_max_threshold) == 10.0


def test_inverted_thresholds_rejected_on_patch(client, school):
    plan = CompensationPlan.objects.create(
        school=school, name="Standard", base_fee=22, bonus_threshold=3, bonus_max_threshold=10
    )
    resp = client.patch(f"/api/school/compensation-plans/{plan.id}/", {"bonus_max_threshold": "1"}, format="json")
    assert resp.status_code == 400
    plan.refresh_from_db()
    assert float(plan.bonus_max_threshold) == 10.0
