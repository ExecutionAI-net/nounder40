"""QA report Critical #1: `PendingInvitationViewSet` had no owner-hierarchy
check at all, unlike `HQMemberViewSet.partial_update()` (see
test_hq_team_permissions.py). Any caller holding just the 'team' permission
-- enough to reach the /hq/invitations/ segment per the middleware mapping in
core/section_guard.py (`HQ_SECTION_BY_SEGMENT["invitations"] = "team"`) --
could POST an hq_member invitation with `role_detail: "owner"`, then POST its
`approve/` action, and mint a brand-new, fully active Owner: a full privilege
escalation via a code path the earlier direct-edit fix never touched.

These tests pin the fix across all three paths that can set/materialize
`role_detail` on an hq_member invitation: create(), update()/partial_update()
and approve() itself (defense-in-depth, matching the belt-and-suspenders
style already used in HQMemberViewSet). They use force_authenticate, same as
test_hq_team_permissions.py, to exercise the hq_views.py-level guard
directly regardless of the middleware's own section gate (covered
separately in test_hq_section_guard.py)."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import HQMember, HQRole, PendingInvitation, Role

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
def team_coordinator_client():
    """A custom role holding only 'dashboard' + 'team' -- enough to reach
    /hq/invitations/ (middleware) but not owner-equivalent. This is exactly
    the shape of custom role the QA agent's live repro used (a plausible
    'Team Coordinator' role an owner might reasonably create)."""
    HQRole.objects.update_or_create(
        key="team_coordinator",
        defaults={"label": "Team Coordinator", "builtin": False, "permissions": ["dashboard", "team"]},
    )
    return _client_for("team_coordinator")


@pytest.fixture
def owner_client():
    return _client_for("owner")


@pytest.fixture
def super_admin_client():
    return _client_for("super_admin")


def _invite_payload(**overrides):
    payload = {
        "type": PendingInvitation.Kind.HQ_MEMBER,
        "email": f"escalation-{uuid.uuid4().hex[:8]}@example.com",
        "name": "QA Escalation Test",
        "role_detail": "owner",
    }
    payload.update(overrides)
    return payload


def test_non_owner_with_team_permission_cannot_create_an_owner_invitation(team_coordinator_client):
    resp = team_coordinator_client.post("/api/hq/invitations/", _invite_payload(), format="json")
    assert resp.status_code == 403
    assert resp.json()["error"] == "only_owner_assigns_owner"
    assert not PendingInvitation.objects.filter(role_detail="owner").exists()


def test_non_owner_with_team_permission_cannot_create_a_super_admin_invitation(team_coordinator_client):
    resp = team_coordinator_client.post(
        "/api/hq/invitations/", _invite_payload(role_detail="super_admin"), format="json"
    )
    assert resp.status_code == 403
    assert resp.json()["error"] == "only_owner_assigns_owner"


def test_non_owner_with_team_permission_can_still_create_a_low_privilege_invitation(team_coordinator_client):
    """The guard must not overreach: inviting a plain 'support' hq_member is
    exactly what the 'team' permission is meant to allow."""
    resp = team_coordinator_client.post(
        "/api/hq/invitations/", _invite_payload(role_detail="support"), format="json"
    )
    assert resp.status_code == 201, resp.content


def test_non_owner_cannot_patch_an_existing_invitation_to_owner(team_coordinator_client):
    invite = PendingInvitation.objects.create(**_invite_payload(role_detail="support"))
    resp = team_coordinator_client.patch(
        f"/api/hq/invitations/{invite.id}/", {"role_detail": "owner"}, format="json"
    )
    assert resp.status_code == 403
    assert resp.json()["error"] == "only_owner_assigns_owner"
    invite.refresh_from_db()
    assert invite.role_detail == "support"


def test_non_owner_cannot_approve_an_owner_invitation(team_coordinator_client):
    """Defense-in-depth: even an invitation that already carries
    role_detail="owner" (e.g. legitimately created by a real owner) must
    still refuse approval by a non-owner-equivalent caller -- the point
    where the escalation actually materializes into a real HQMember/User."""
    invite = PendingInvitation.objects.create(**_invite_payload())
    resp = team_coordinator_client.post(f"/api/hq/invitations/{invite.id}/approve/")
    assert resp.status_code == 403
    assert resp.json()["error"] == "only_owner_assigns_owner"
    assert not HQMember.objects.filter(email=invite.email).exists()
    assert PendingInvitation.objects.filter(pk=invite.pk).exists()


def test_school_teacher_invitation_role_detail_is_unaffected(team_coordinator_client):
    """The guard must only apply to hq_member invitations -- school-teacher
    invites use role_detail with different semantics and must not be
    blocked by this HQ-owner-hierarchy check."""
    resp = team_coordinator_client.post(
        "/api/hq/invitations/",
        {
            "type": PendingInvitation.Kind.SCHOOL_TEACHER,
            "email": f"teacher-{uuid.uuid4().hex[:8]}@example.com",
            "name": "QA Teacher",
            "role_detail": "owner",  # meaningless for a teacher invite, must not trip the HQ guard
        },
        format="json",
    )
    assert resp.status_code == 201, resp.content


def test_owner_can_still_create_and_approve_an_owner_invitation(owner_client):
    resp = owner_client.post("/api/hq/invitations/", _invite_payload(), format="json")
    assert resp.status_code == 201, resp.content
    invite_id = resp.json()["id"]

    resp = owner_client.post(f"/api/hq/invitations/{invite_id}/approve/")
    assert resp.status_code == 201, resp.content
    assert resp.json()["sub_role"] == "owner"


def test_super_admin_can_still_create_and_approve_an_owner_invitation(super_admin_client):
    resp = super_admin_client.post("/api/hq/invitations/", _invite_payload(), format="json")
    assert resp.status_code == 201, resp.content
    invite_id = resp.json()["id"]

    resp = super_admin_client.post(f"/api/hq/invitations/{invite_id}/approve/")
    assert resp.status_code == 201, resp.content
    assert resp.json()["sub_role"] == "owner"


def test_owner_can_patch_an_invitation_to_owner(owner_client):
    invite = PendingInvitation.objects.create(**_invite_payload(role_detail="support"))
    resp = owner_client.patch(f"/api/hq/invitations/{invite.id}/", {"role_detail": "owner"}, format="json")
    assert resp.status_code == 200, resp.content
    invite.refresh_from_db()
    assert invite.role_detail == "owner"
