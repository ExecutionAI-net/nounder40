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
