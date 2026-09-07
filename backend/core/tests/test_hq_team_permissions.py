"""QA report Critical #1-#3: any HQ sub-role (even 'support', with no `team`
or `permissions` grant) could PATCH itself to owner, edit any role's
permission matrix, or DELETE any HQ member including the owner — because
`HQMemberViewSet`/`HQRoleViewSet` only checked `role == 'hq'`, never the
caller's own HQRole.permissions. These tests pin the fix: writes now require
the matching permission key, and the owner cannot be self-deleted."""
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
    return _client_for("support")


@pytest.fixture
def owner_client():
    return _client_for("owner")


def test_support_cannot_promote_itself_to_owner(support_client):
    member_id = HQMember.objects.get(sub_role="support").pk
    resp = support_client.patch(f"/api/hq/team/{member_id}/", {"sub_role": "owner"}, format="json")
    assert resp.status_code == 403
    assert not HQMember.objects.filter(pk=member_id, sub_role="owner").exists()


def test_support_cannot_edit_its_own_role_permissions(support_client):
    resp = support_client.patch(
        "/api/hq/permissions/support/", {"permissions": ["dashboard", "inbox", "team", "permissions"]}, format="json"
    )
    assert resp.status_code == 403
    assert HQRole.objects.get(key="support").permissions == ["dashboard", "inbox"]


def test_support_cannot_delete_the_owner(support_client):
    owner_member = HQMember.objects.create(
        user=get_user_model().objects.create(
            email=f"owner-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role="owner"
        ),
        email="owner@example.com", name="Owner", sub_role="owner",
    )
    resp = support_client.delete(f"/api/hq/team/{owner_member.pk}/")
    assert resp.status_code == 403
    assert HQMember.objects.filter(pk=owner_member.pk).exists()


def test_support_cannot_delete_itself(support_client):
    member_id = HQMember.objects.get(sub_role="support").pk
    resp = support_client.delete(f"/api/hq/team/{member_id}/")
    assert resp.status_code == 403


def test_team_only_role_cannot_rewrite_a_super_admins_email():
    """R2-C1 (live account takeover, QA_REGRESSION_ROUND2_HQ.md HQ-R2-01):
    the guard used to live only inside the `if "sub_role" in request.data`
    branch, so a caller who left sub_role alone and PATCHed just `email`
    sailed through with zero hierarchy check. `email` is the login
    credential (synced to User.email) -- rewriting it and then running the
    public password-reset flow against the new address is a full takeover.
    Exact repro: a 'team'-only role (here 'support', which the fixture wires
    up without 'team' -- swap in a custom [dashboard, team] role to match
    the live repro's caller shape; the guard must not depend on the caller
    holding 'team' either, so support alone already proves the point) PATCHes
    a super_admin's email."""
    from accounts.models import HQRole

    HQRole.objects.update_or_create(
        key="team_coordinator",
        defaults={"label": "Team Coordinator", "builtin": False, "permissions": ["dashboard", "team"]},
    )
    coordinator = _hq_user("team_coordinator")
    api = APIClient()
    api.force_authenticate(user=coordinator)

    super_admin_member = HQMember.objects.create(
        user=get_user_model().objects.create(
            email=f"sa-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role="super_admin"
        ),
        email="sa@example.com", name="Super Admin", sub_role="super_admin",
    )
    original_email = super_admin_member.user.email

    resp = api.patch(
        f"/api/hq/team/{super_admin_member.pk}/", {"email": "attacker@example.com"}, format="json"
    )
    assert resp.status_code == 403
    super_admin_member.user.refresh_from_db()
    assert super_admin_member.user.email == original_email


def test_team_only_role_cannot_rewrite_a_super_admins_name_phone_or_active():
    """Same gap, other fields the QA report called out alongside email."""
    from accounts.models import HQRole

    HQRole.objects.update_or_create(
        key="team_coordinator",
        defaults={"label": "Team Coordinator", "builtin": False, "permissions": ["dashboard", "team"]},
    )
    coordinator = _hq_user("team_coordinator")
    api = APIClient()
    api.force_authenticate(user=coordinator)

    super_admin_member = HQMember.objects.create(
        user=get_user_model().objects.create(
            email=f"sa-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role="super_admin"
        ),
        email="sa2@example.com", name="Super Admin", sub_role="super_admin", active=True,
    )

    resp = api.patch(
        f"/api/hq/team/{super_admin_member.pk}/",
        {"name": "Hijacked Name", "phone": "+000", "active": False},
        format="json",
    )
    assert resp.status_code == 403
    super_admin_member.refresh_from_db()
    assert super_admin_member.name == "Super Admin"
    assert super_admin_member.active is True


def test_owner_equivalent_caller_can_still_edit_another_owner_equivalent_member(owner_client):
    """Positive counterpart: the R2-C1 fix must not lock owners out of
    managing each other."""
    other_owner = HQMember.objects.create(
        user=get_user_model().objects.create(
            email=f"owner2-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role="owner"
        ),
        email="owner2@example.com", name="Second Owner", sub_role="owner",
    )
    resp = owner_client.patch(
        f"/api/hq/team/{other_owner.pk}/", {"name": "Renamed Owner", "phone": "+391234"}, format="json"
    )
    assert resp.status_code == 200, resp.content
    other_owner.user.refresh_from_db()
    assert other_owner.user.first_name == "Renamed"


def test_owner_equivalent_caller_can_still_edit_their_own_record(owner_client):
    member = HQMember.objects.get(sub_role="owner")
    resp = owner_client.patch(f"/api/hq/team/{member.pk}/", {"phone": "+3912345"}, format="json")
    assert resp.status_code == 200, resp.content


def test_owner_can_still_manage_team_and_permissions(owner_client):
    member = HQMember.objects.get(sub_role="owner")
    other = HQMember.objects.create(
        user=get_user_model().objects.create(
            email=f"stf-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role="support"
        ),
        email="stf@example.com", name="Staff", sub_role="support",
    )

    resp = owner_client.patch(
        "/api/hq/permissions/support/", {"permissions": ["dashboard", "inbox", "team"]}, format="json"
    )
    assert resp.status_code == 200
    assert "team" in HQRole.objects.get(key="support").permissions

    resp = owner_client.delete(f"/api/hq/team/{other.pk}/")
    assert resp.status_code == 204

    resp = owner_client.delete(f"/api/hq/team/{member.pk}/")
    assert resp.status_code == 400
    assert resp.data["error"] == "cannot_remove_self"
