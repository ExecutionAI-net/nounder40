"""R3-M1 (QA_REGRESSION_ROUND3_HQ.md HQ-R3-03): a `[dashboard, team]` role
could promote itself to `operations`.

The hierarchy rule named `owner` and `super_admin` explicitly, and that was
all of it. Live, a custom role holding only `[dashboard, team]` did

    PATCH /hq/team/<own id>/ {"sub_role": "operations"}   -> 200
    GET   /hq/permissions/mine/                           -> operations, 11 permissions

and `operations` carries `schools_create_edit`, which the R2-H2 fix made the
key to cross-school god-mode over every `/api/school/*` and every chat
thread. "Manage the roster" became "write every tenant's data" in one
request. The pending-invite path (`role_detail: "operations"`) did the same.

The rule now is: you may not hand out a permission that lets its holder widen
their own reach (`schools_create_edit`, `permissions`, `team`) unless you hold
it yourself. Lateral assignments — a roster manager inviting a `support` or
`finance` member — must keep working; that is what the `team` permission is
for.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import HQMember, HQRole, PendingInvitation, Role

pytestmark = pytest.mark.django_db
User = get_user_model()


def _hq_user(sub_role):
    user = User.objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role=sub_role
    )
    HQMember.objects.create(user=user, email=user.email, name="QA", sub_role=sub_role, active=True)
    return user


def _client(user):
    api = APIClient()
    api.force_authenticate(user=user)
    return api


@pytest.fixture
def coordinator():
    """The live repro's caller: a custom role with only [dashboard, team]."""
    HQRole.objects.update_or_create(
        key="team_coordinator",
        defaults={"label": "Team Coordinator", "builtin": False, "permissions": ["dashboard", "team"]},
    )
    return _hq_user("team_coordinator")


@pytest.fixture
def coordinator_client(coordinator):
    return _client(coordinator)


def _member(sub_role):
    return HQMember.objects.get(user=_hq_user(sub_role))


# --- upward: refused ---------------------------------------------------------


def test_a_team_only_role_cannot_promote_itself_to_operations(coordinator_client, coordinator):
    """The exact live repro."""
    member = HQMember.objects.get(user=coordinator)

    resp = coordinator_client.patch(f"/api/hq/team/{member.pk}/", {"sub_role": "operations"}, format="json")

    assert resp.status_code == 403, resp.content
    assert resp.json()["error"] == "role_exceeds_caller_permissions"
    assert "schools_create_edit" in resp.json()["permissions"]
    member.refresh_from_db()
    coordinator.refresh_from_db()
    assert member.sub_role == "team_coordinator"
    assert coordinator.effective_hq_sub_role() == "team_coordinator"


def test_a_team_only_role_cannot_promote_somebody_else_to_operations(coordinator_client):
    victim = _member("support")
    resp = coordinator_client.patch(f"/api/hq/team/{victim.pk}/", {"sub_role": "operations"}, format="json")
    assert resp.status_code == 403
    victim.refresh_from_db()
    assert victim.sub_role == "support"


def test_the_same_rule_covers_put(coordinator_client, coordinator):
    """R3-C1 put every write verb through one guard — this must ride along."""
    member = HQMember.objects.get(user=coordinator)
    resp = coordinator_client.put(
        f"/api/hq/team/{member.pk}/",
        {"email": member.email, "name": "QA", "sub_role": "operations", "active": True},
        format="json",
    )
    assert resp.status_code == 403, resp.content
    member.refresh_from_db()
    assert member.sub_role == "team_coordinator"


def test_a_team_only_role_cannot_create_an_operations_invitation(coordinator_client):
    resp = coordinator_client.post(
        "/api/hq/invitations/",
        {"type": PendingInvitation.Kind.HQ_MEMBER, "email": f"x-{uuid.uuid4().hex[:6]}@example.com",
         "name": "X", "role_detail": "operations"},
        format="json",
    )
    assert resp.status_code == 403, resp.content
    assert not PendingInvitation.objects.filter(role_detail="operations").exists()


def test_a_team_only_role_cannot_patch_a_pending_invite_up_to_operations(coordinator_client):
    """The second half of the live repro."""
    invite = PendingInvitation.objects.create(
        type=PendingInvitation.Kind.HQ_MEMBER, email=f"x-{uuid.uuid4().hex[:6]}@example.com",
        name="X", role_detail="support",
    )
    resp = coordinator_client.patch(
        f"/api/hq/invitations/{invite.id}/", {"role_detail": "operations"}, format="json"
    )
    assert resp.status_code == 403, resp.content
    invite.refresh_from_db()
    assert invite.role_detail == "support"


def test_a_team_only_role_cannot_approve_an_operations_invitation(coordinator_client):
    """Defence in depth: the point where the role becomes real."""
    invite = PendingInvitation.objects.create(
        type=PendingInvitation.Kind.HQ_MEMBER, email=f"x-{uuid.uuid4().hex[:6]}@example.com",
        name="X", role_detail="operations",
    )
    resp = coordinator_client.post(f"/api/hq/invitations/{invite.id}/approve/")
    assert resp.status_code == 403, resp.content
    assert not HQMember.objects.filter(email=invite.email).exists()


def test_a_role_carrying_permissions_cannot_be_handed_out_either():
    """`permissions` edits the matrix itself — the other way to grant
    yourself anything."""
    HQRole.objects.update_or_create(
        key="team_only", defaults={"label": "Team Only", "builtin": False, "permissions": ["dashboard", "team"]},
    )
    HQRole.objects.update_or_create(
        key="matrix_editor",
        defaults={"label": "Matrix Editor", "builtin": False, "permissions": ["dashboard", "permissions"]},
    )
    caller = _hq_user("team_only")
    victim = _member("support")

    resp = _client(caller).patch(f"/api/hq/team/{victim.pk}/", {"sub_role": "matrix_editor"}, format="json")

    assert resp.status_code == 403, resp.content
    assert resp.json()["permissions"] == ["permissions"]


def test_an_unknown_sub_role_is_refused_not_measured(coordinator_client):
    """A role outside the matrix fails *open* in `hq_permission_set`, so
    handing one out is the most dangerous assignment, not the safest."""
    victim = _member("support")
    resp = coordinator_client.patch(f"/api/hq/team/{victim.pk}/", {"sub_role": "godmode"}, format="json")
    assert resp.status_code == 400, resp.content
    assert resp.json()["error"] == "unknown_sub_role"
    victim.refresh_from_db()
    assert victim.sub_role == "support"


# --- lateral and downward: still allowed -------------------------------------


@pytest.mark.parametrize("sub_role", ["support", "finance", "analytics", "tech_support"])
def test_a_team_only_role_can_still_assign_ordinary_roles(coordinator_client, sub_role):
    """None of these carry an escalation key. A plain "subset of my own
    permissions" rule would have blocked all four — `inbox`, `payments`,
    `reports` and `schools_view` are not permissions a roster manager holds,
    and refusing them would break the very job the `team` permission is for."""
    victim = _member("support")
    resp = coordinator_client.patch(f"/api/hq/team/{victim.pk}/", {"sub_role": sub_role}, format="json")
    assert resp.status_code == 200, resp.content
    victim.refresh_from_db()
    assert victim.sub_role == sub_role


def test_a_team_only_role_can_still_assign_a_role_that_also_holds_team(coordinator_client):
    """You may hand out what you already hold."""
    HQRole.objects.update_or_create(
        key="other_coordinator",
        defaults={"label": "Other Coordinator", "builtin": False, "permissions": ["dashboard", "team"]},
    )
    victim = _member("support")
    resp = coordinator_client.patch(
        f"/api/hq/team/{victim.pk}/", {"sub_role": "other_coordinator"}, format="json"
    )
    assert resp.status_code == 200, resp.content


def test_an_owner_can_still_assign_operations():
    owner = _hq_user("owner")
    victim = _member("support")
    resp = _client(owner).patch(f"/api/hq/team/{victim.pk}/", {"sub_role": "operations"}, format="json")
    assert resp.status_code == 200, resp.content
    victim.refresh_from_db()
    assert victim.sub_role == "operations"


def test_an_edit_that_does_not_touch_the_role_is_unaffected(coordinator_client):
    victim = _member("support")
    resp = coordinator_client.patch(f"/api/hq/team/{victim.pk}/", {"phone": "+391234"}, format="json")
    assert resp.status_code == 200, resp.content
