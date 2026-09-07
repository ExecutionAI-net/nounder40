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
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True
    )


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


# --- QA R2-M9: room cost ---------------------------------------------------


def test_negative_room_cost_is_rejected(school):
    location = _location(school)
    resp = _school_owner_client(school).post(
        "/api/school/rooms/",
        {"location": str(location.id), "name": "Room A", "capacity": 10, "cost": "-10"},
        format="json",
    )
    assert resp.status_code == 400
    assert "cost" in resp.json()


def test_zero_and_positive_room_cost_are_accepted(school):
    location = _location(school)
    client = _school_owner_client(school)
    for cost in ("0", "25.50"):
        resp = client.post(
            "/api/school/rooms/",
            {"location": str(location.id), "name": f"Room {cost}", "capacity": 10, "cost": cost},
            format="json",
        )
        assert resp.status_code == 201, resp.content


# --- QA R2-M9: School booking policy + language ----------------------------


def test_negative_cancellation_policy_hours_is_rejected(school):
    resp = _school_owner_client(school).patch(
        "/api/school/profile/", {"cancellation_policy_hours": -5}, format="json"
    )
    assert resp.status_code == 400
    assert "cancellation_policy_hours" in resp.json()
    school.refresh_from_db()
    assert school.cancellation_policy_hours == 24


def test_zero_cancellation_policy_hours_is_a_valid_always_refund_policy(school):
    resp = _school_owner_client(school).patch(
        "/api/school/profile/", {"cancellation_policy_hours": 0}, format="json"
    )
    assert resp.status_code == 200, resp.content
    school.refresh_from_db()
    assert school.cancellation_policy_hours == 0


def test_negative_min_booking_notice_hours_is_rejected(school):
    resp = _school_owner_client(school).patch(
        "/api/school/profile/", {"min_booking_notice_hours": -2}, format="json"
    )
    assert resp.status_code == 400
    assert "min_booking_notice_hours" in resp.json()


def test_unsupported_language_is_rejected(school):
    resp = _school_owner_client(school).patch("/api/school/profile/", {"language": "xx"}, format="json")
    assert resp.status_code == 400
    assert "language" in resp.json()
    school.refresh_from_db()
    assert school.language == "it"


def test_every_supported_locale_is_accepted(school):
    client = _school_owner_client(school)
    for locale in ("en", "it", "es", "fr", "de"):
        resp = client.patch("/api/school/profile/", {"language": locale}, format="json")
        assert resp.status_code == 200, (locale, resp.content)
        school.refresh_from_db()
        assert school.language == locale


# --- QA R2-M9: closures ----------------------------------------------------


def test_closure_end_before_start_is_rejected(school):
    resp = _school_owner_client(school).post(
        "/api/school/closures/", {"date": "2026-12-10", "end_date": "2026-12-01", "type": "full_day"}, format="json"
    )
    assert resp.status_code == 400
    assert "end_date" in resp.json()


def test_partial_closure_without_a_start_time_is_rejected(school):
    resp = _school_owner_client(school).post(
        "/api/school/closures/", {"date": "2026-12-11", "type": "partial"}, format="json"
    )
    assert resp.status_code == 400
    assert "from_time" in resp.json()


def test_valid_closures_still_save(school):
    client = _school_owner_client(school)
    assert client.post(
        "/api/school/closures/", {"date": "2026-12-12", "end_date": "2026-12-14", "type": "full_day"}, format="json"
    ).status_code == 201
    assert client.post(
        "/api/school/closures/", {"date": "2026-12-15", "type": "partial", "from_time": "18:00"}, format="json"
    ).status_code == 201
    # single day, end_date == date is still a valid (degenerate) range
    assert client.post(
        "/api/school/closures/", {"date": "2026-12-16", "end_date": "2026-12-16", "type": "full_day"}, format="json"
    ).status_code == 201


def test_partial_closure_patch_that_does_not_touch_the_time_still_works(school):
    from schools.models import SchoolClosure

    closure = SchoolClosure.objects.create(
        school=school, date="2026-12-20", type=SchoolClosure.Kind.PARTIAL, from_time="19:00"
    )
    resp = _school_owner_client(school).patch(
        f"/api/school/closures/{closure.id}/", {"notes": "Christmas rehearsal"}, format="json"
    )
    assert resp.status_code == 200, resp.content
