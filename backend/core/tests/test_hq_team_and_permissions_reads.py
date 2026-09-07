"""QA report High #1: `GET /api/hq/team/` and `GET /api/hq/permissions/` were
readable by *every* HQ role regardless of permissions. `core/section_guard.py`
skips both segments (`HQ_SEGMENT_ENFORCED_ELSEWHERE`) on the assumption
enforcement "already lives" in `HQMemberViewSet.initial()` /
`HQRoleViewSet.initial()` -- true for writes, but those `initial()` overrides
only gated `POST/PUT/PATCH/DELETE`, leaving GET completely unchecked. This
leaked real staff PII (name/email/phone) and the full permission matrix
(including custom roles) to the lowest-trust HQ role.

The fix extends both `initial()` guards to cover GET too, and adds a
self-serving `GET /api/hq/permissions/mine/` action (exempted from the
'permissions' gate) so every HQ role can still read its *own* permission
list -- this is what HQLayout/Dashboard now call instead of the full roster,
to filter nav items and gate schools_view/schools_create_edit-only UI
without regressing to a broken sidebar for the 5 non-owner-equivalent
built-in roles."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import HQMember, HQRole, Role

pytestmark = pytest.mark.django_db


def _hq_user(sub_role):
    user = get_user_model().objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role=sub_role
    )
    HQMember.objects.create(user=user, email=user.email, name="QA", sub_role=sub_role)
    return user


def _client_for(sub_role):
    api = APIClient()
    api.force_authenticate(user=_hq_user(sub_role))
    return api


@pytest.fixture
def support_client():
    """Seed permissions: ["dashboard", "inbox"] -- no 'team' or 'permissions'."""
    return _client_for("support")


@pytest.fixture
def owner_client():
    return _client_for("owner")


@pytest.fixture
def team_only_client():
    HQRole.objects.update_or_create(
        key="team_only", defaults={"label": "Team Only", "builtin": False, "permissions": ["dashboard", "team"]}
    )
    return _client_for("team_only")


@pytest.fixture
def permissions_only_client():
    HQRole.objects.update_or_create(
        key="permissions_only",
        defaults={"label": "Permissions Only", "builtin": False, "permissions": ["dashboard", "permissions"]},
    )
    return _client_for("permissions_only")


def test_support_cannot_read_the_team_roster(support_client):
    resp = support_client.get("/api/hq/team/")
    assert resp.status_code == 403


def test_support_cannot_read_the_permission_matrix(support_client):
    resp = support_client.get("/api/hq/permissions/")
    assert resp.status_code == 403


def test_owner_can_still_read_the_team_roster_and_permission_matrix(owner_client):
    assert owner_client.get("/api/hq/team/").status_code == 200
    assert owner_client.get("/api/hq/permissions/").status_code == 200


def test_role_with_team_permission_can_read_the_team_roster(team_only_client):
    resp = team_only_client.get("/api/hq/team/")
    assert resp.status_code == 200


def test_role_with_team_permission_but_not_permissions_still_cannot_read_the_matrix(team_only_client):
    """'team' and 'permissions' are separate keys -- holding one must not
    grant the other, otherwise the fix would just move the same leak."""
    resp = team_only_client.get("/api/hq/permissions/")
    assert resp.status_code == 403


def test_role_with_permissions_permission_can_read_the_matrix(permissions_only_client):
    resp = permissions_only_client.get("/api/hq/permissions/")
    assert resp.status_code == 200


def test_role_with_permissions_permission_but_not_team_still_cannot_read_the_roster(permissions_only_client):
    resp = permissions_only_client.get("/api/hq/team/")
    assert resp.status_code == 403


def test_any_hq_role_can_read_its_own_permissions_via_mine(support_client):
    """The safe replacement for the full roster: every role, including the
    lowest-trust one, can read its own {key, label, permissions} without
    seeing anyone else's."""
    resp = support_client.get("/api/hq/permissions/mine/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["key"] == "support"
    assert set(body["permissions"]) == {"dashboard", "inbox"}


def test_mine_never_leaks_other_roles(support_client):
    resp = support_client.get("/api/hq/permissions/mine/")
    assert resp.status_code == 200
    # A single object, not the full roster/matrix.
    assert isinstance(resp.json(), dict)


def test_hq_user_with_no_sub_role_gets_an_empty_mine_response_not_an_error():
    user = get_user_model().objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ]
    )
    api = APIClient()
    api.force_authenticate(user=user)
    resp = api.get("/api/hq/permissions/mine/")
    assert resp.status_code == 200
    assert resp.json() == {"key": "", "label": "", "permissions": []}
