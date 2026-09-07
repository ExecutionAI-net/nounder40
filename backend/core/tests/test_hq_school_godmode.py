"""R2-H2 / X-R2-03: the HQ role-permission matrix was never enforced on
/api/school/* at all. `SchoolSectionGuardMiddleware` unconditionally
bypassed the whole school matrix for any "hq" role ("HQ non è soggetto alla
matrice scuola"), and `SchoolScopedModelViewSet`/chat treated `is_hq()` as
unconditional god-mode. A narrow HQ role like `support`/`tech_support`
(permissions seed: only ["dashboard", "inbox"]) -- correctly 403'd on
/api/hq/team/, /api/hq/permissions/, POST /api/hq/packages/ by the existing
HQSectionGuardMiddleware fix -- could still read, write and DELETE every
school's operational data via /api/school/*: closures, rooms, courses,
locations, documents, credits, and (see chat/tests/test_visibility_matrix.py)
post into private school<->student chats.

Fix: `SchoolSectionGuardMiddleware` now requires an HQ caller to hold real
cross-school authority -- owner/super_admin-equivalent, or the existing
`schools_create_edit` permission (the same permission that already lets
`operations` manage schools' operational content via /api/hq/schools/) --
before bypassing the school matrix; anything narrower gets a clean 403,
exactly like a non-member. Genuine HQ oversight (owner/super_admin, and
`operations`, which already holds `schools_create_edit`) is unaffected."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import HQMember, Role
from schools.models import School, SchoolClosure, SchoolLocation

pytestmark = pytest.mark.django_db
User = get_user_model()


def _jwt_client(user):
    # The middleware re-authenticates from the JWT itself; force_authenticate
    # sets no Authorization header, so it would never see this user.
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


def _hq_client(sub_role):
    user = User.objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role=sub_role,
    )
    HQMember.objects.create(user=user, email=user.email, name="QA", sub_role=sub_role)
    return _jwt_client(user)


@pytest.fixture
def school():
    return School.objects.create(name="Victim", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com")


@pytest.fixture
def closure(school):
    from datetime import date

    return SchoolClosure.objects.create(school=school, date=date(2026, 9, 21))


@pytest.fixture
def location(school):
    return SchoolLocation.objects.create(school=school, name="Main")


# --- narrow HQ roles: blocked -----------------------------------------------

@pytest.mark.parametrize("sub_role", ["support", "tech_support"])
def test_narrow_hq_role_cannot_read_a_schools_closures(sub_role, school, closure):
    client = _hq_client(sub_role)
    resp = client.get(f"/api/school/closures/{closure.id}/")
    assert resp.status_code == 403
    assert resp.json()["error"] == "hq_school_access_forbidden"


@pytest.mark.parametrize("sub_role", ["support", "tech_support"])
def test_narrow_hq_role_cannot_delete_a_schools_closure(sub_role, school, closure):
    client = _hq_client(sub_role)
    resp = client.delete(f"/api/school/closures/{closure.id}/")
    assert resp.status_code == 403
    assert SchoolClosure.objects.filter(pk=closure.id).exists()


@pytest.mark.parametrize("sub_role", ["support", "tech_support", "finance", "analytics"])
def test_narrow_hq_role_cannot_create_a_room(sub_role, school, location):
    from schools.models import SchoolRoom

    client = _hq_client(sub_role)
    resp = client.post(
        "/api/school/rooms/", {"location": str(location.id), "name": "Planted", "capacity": 5}, format="json",
    )
    assert resp.status_code == 403
    assert not SchoolRoom.objects.filter(location=location, name="Planted").exists()


# --- broad HQ roles: unaffected ---------------------------------------------

@pytest.mark.parametrize("sub_role", ["owner", "super_admin", "operations"])
def test_broad_hq_role_can_still_read_a_schools_closures(sub_role, school, closure):
    """owner/super_admin, and operations (holds schools_create_edit), keep
    the exact cross-school access they had before this fix."""
    client = _hq_client(sub_role)
    resp = client.get(f"/api/school/closures/{closure.id}/")
    assert resp.status_code == 200


@pytest.mark.parametrize("sub_role", ["owner", "super_admin", "operations"])
def test_broad_hq_role_can_still_create_a_room(sub_role, school, location):
    from schools.models import SchoolRoom

    client = _hq_client(sub_role)
    resp = client.post(
        "/api/school/rooms/", {"location": str(location.id), "name": "HQ managed", "capacity": 5}, format="json",
    )
    assert resp.status_code == 201, resp.content
    assert SchoolRoom.objects.filter(location=location, name="HQ managed").exists()


def test_hq_without_sub_role_stays_fail_open(school, closure):
    """Consistent with the existing HQ guard: an HQ account with no
    HQMember row / hq_sub_role at all (older seed shape) is not newly broken
    by this layer."""
    user = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ])
    client = _jwt_client(user)
    assert client.get(f"/api/school/closures/{closure.id}/").status_code == 200
