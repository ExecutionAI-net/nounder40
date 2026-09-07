"""QA M-2/L-3: three fields with no server-side range check.

- `School.platform_fee_percentage` / `shop_commission_percentage` accepted
  anything (e.g. 150%), silently breaking the Stripe `application_fee_amount`
  split and shop commission math. Both are HQ-only (`_SCHOOL_HQ_ONLY_FIELDS`
  in schools/views.py), so only reachable via the HQ `SchoolViewSet`.
- `SchoolRoom.capacity` accepted negative numbers.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model

from accounts.models import Role
from rest_framework.test import APIClient

from schools.models import School, SchoolLocation

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def hq_client():
    user = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ])
    api = APIClient()
    api.force_authenticate(user=user)
    return api


# --- platform_fee_percentage / shop_commission_percentage -------------------

def test_platform_fee_percentage_above_100_is_rejected(hq_client, school):
    resp = hq_client.patch(f"/api/hq/schools/{school.id}/", {"platform_fee_percentage": "150"}, format="json")
    assert resp.status_code == 400
    assert "platform_fee_percentage" in resp.json()
    school.refresh_from_db()
    assert float(school.platform_fee_percentage) != 150.0


def test_platform_fee_percentage_negative_is_rejected(hq_client, school):
    resp = hq_client.patch(f"/api/hq/schools/{school.id}/", {"platform_fee_percentage": "-1"}, format="json")
    assert resp.status_code == 400
    assert "platform_fee_percentage" in resp.json()


def test_platform_fee_percentage_boundary_100_is_accepted(hq_client, school):
    resp = hq_client.patch(f"/api/hq/schools/{school.id}/", {"platform_fee_percentage": "100"}, format="json")
    assert resp.status_code == 200, resp.content
    school.refresh_from_db()
    assert float(school.platform_fee_percentage) == 100.0


def test_shop_commission_percentage_above_100_is_rejected(hq_client, school):
    resp = hq_client.patch(f"/api/hq/schools/{school.id}/", {"shop_commission_percentage": "101"}, format="json")
    assert resp.status_code == 400
    assert "shop_commission_percentage" in resp.json()


def test_shop_commission_percentage_boundary_0_is_accepted(hq_client, school):
    resp = hq_client.patch(f"/api/hq/schools/{school.id}/", {"shop_commission_percentage": "0"}, format="json")
    assert resp.status_code == 200, resp.content
    school.refresh_from_db()
    assert float(school.shop_commission_percentage) == 0.0


# --- SchoolRoom.capacity ------------------------------------------------

def _location(school):
    return SchoolLocation.objects.create(school=school, name="Main")


def _school_owner_client(school):
    from schools.models import SchoolMembership, SchoolRole

    SchoolRole.objects.update_or_create(
        key="owner", defaults={"label": "Owner", "builtin": True, "permissions": ["settings"]}
    )
    user = User.objects.create(
        email=f"owner-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    api = APIClient()
    api.force_authenticate(user=user)
    return api


def test_negative_room_capacity_is_rejected(school):
    location = _location(school)
    client = _school_owner_client(school)
    resp = client.post("/api/school/rooms/", {"location": str(location.id), "name": "Room A", "capacity": -3}, format="json")
    assert resp.status_code == 400
    assert "capacity" in resp.json()


def test_zero_room_capacity_is_rejected(school):
    location = _location(school)
    client = _school_owner_client(school)
    resp = client.post("/api/school/rooms/", {"location": str(location.id), "name": "Room A", "capacity": 0}, format="json")
    assert resp.status_code == 400
    assert "capacity" in resp.json()


def test_room_capacity_of_one_is_accepted(school):
    location = _location(school)
    client = _school_owner_client(school)
    resp = client.post("/api/school/rooms/", {"location": str(location.id), "name": "Room A", "capacity": 1}, format="json")
    assert resp.status_code == 201, resp.content
    assert resp.json()["capacity"] == 1
