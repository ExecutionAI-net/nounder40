"""School.nav_order — the school's own order of its sidebar sections, set
from Settings → Menu order through PATCH /api/school/profile/. A settings
permission is needed to write it (the same gate as the booking policy);
every member can read it (the layout draws the sidebar from it)."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from schools.models import School, SchoolMembership, SchoolRole

pytestmark = pytest.mark.django_db
User = get_user_model()
URL = "/api/school/profile/"


def _school():
    from core import section_guard

    SchoolRole.objects.update_or_create(key="admin", defaults={"label": "Admin", "builtin": True, "permissions": ["settings", "students"]})
    SchoolRole.objects.update_or_create(key="staff", defaults={"label": "Staff", "builtin": True, "permissions": ["students"]})
    section_guard._matrix_cache["expires"] = 0.0
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome", active=True,
    )


def _client(school, sub_role):
    user = User.objects.create(
        email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role=sub_role)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def test_a_settings_holder_saves_the_order_and_everyone_reads_it():
    school = _school()
    order = ["dashboard", "students", "calendar", "reports"]

    res = _client(school, "admin").patch(URL, {"nav_order": order}, format="json")
    assert res.status_code == 200, res.content
    assert res.json()["nav_order"] == order
    school.refresh_from_db()
    assert school.nav_order == order

    # A member without the settings permission still reads it: the sidebar is hers too
    assert _client(school, "staff").get(URL).json()["nav_order"] == order


def test_without_the_settings_permission_the_order_is_refused():
    school = _school()

    res = _client(school, "staff").patch(URL, {"nav_order": ["students"]}, format="json")
    assert res.status_code == 403
    school.refresh_from_db()
    assert school.nav_order == []


@pytest.mark.parametrize("bad", ["students", [1, 2], [""], ["x" * 41], [{"key": "students"}]])
def test_only_a_list_of_section_keys_is_accepted(bad):
    school = _school()

    res = _client(school, "admin").patch(URL, {"nav_order": bad}, format="json")
    assert res.status_code == 400 and res.json()["error"] == "nav_order_invalid"
    school.refresh_from_db()
    assert school.nav_order == []
