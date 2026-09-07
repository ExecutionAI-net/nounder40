"""X-R2-02 / R2-H3: `SchoolRoomSerializer.location` was an unscoped
`PrimaryKeyRelatedField`, and `SchoolScopedModelViewSet.create()` skips the
usual school-injection when `school_field` contains "__" (rooms use
`location__school`, reached via a relation, not a direct FK). Nothing then
checked the submitted location actually belonged to the caller's own school:
a school admin could POST /api/school/rooms/ with another school's location
id and plant a room straight into the victim school's room pool."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from schools.models import School, SchoolLocation, SchoolMembership

pytestmark = pytest.mark.django_db
User = get_user_model()


def _school(name="S"):
    return School.objects.create(name=name, slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com")


def _location(school):
    return SchoolLocation.objects.create(school=school, name="Main")


def _school_admin_client(school):
    user = User.objects.create(
        email=f"adm-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="admin")
    api = APIClient()
    api.force_authenticate(user=user)
    return api


def test_admin_cannot_create_a_room_under_another_schools_location():
    victim = _school("Victim")
    attacker_school = _school("Attacker")
    victim_location = _location(victim)

    client = _school_admin_client(attacker_school)
    resp = client.post(
        "/api/school/rooms/",
        {"location": str(victim_location.id), "name": "Planted room", "capacity": 5},
        format="json",
    )
    assert resp.status_code == 400
    assert "location" in resp.json()
    assert not victim_location.rooms.filter(name="Planted room").exists()


def test_admin_can_still_create_a_room_under_their_own_location():
    school = _school()
    location = _location(school)
    client = _school_admin_client(school)
    resp = client.post(
        "/api/school/rooms/",
        {"location": str(location.id), "name": "Sala 1", "capacity": 5},
        format="json",
    )
    assert resp.status_code == 201, resp.content
    assert location.rooms.filter(name="Sala 1").exists()
