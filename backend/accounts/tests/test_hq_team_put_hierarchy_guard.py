"""R3-C1 (QA_REGRESSION_ROUND3_HQ.md HQ-R3-01): `PUT /api/hq/team/<id>/`
bypassed every hierarchy guard.

PR #86 closed R2-C1 by putting the owner-equivalent target check inside
`HQMemberViewSet.partial_update()`. `update()` (HTTP PUT) stayed inherited
from DRF, so the whole R2-C1 takeover was still live through the sibling
verb: a custom role holding only `[dashboard, team]` PUT a super_admin's row
(rewriting its e-mail and demoting it to `support`), which then unlocked the
R2-H1 invite-approve vector and DELETE on the same row, and finally PUT
itself to `sub_role: owner`.

These tests pin the shared guard: PUT gets exactly the same treatment as
PATCH, PUT keeps `User.email` in sync with the roster row (that sync also
lived only in the PATCH override), and the owner paths still work.
"""
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


@pytest.fixture
def team_coordinator():
    """The live repro's caller: a custom role with only [dashboard, team]."""
    HQRole.objects.update_or_create(
        key="team_coordinator",
        defaults={"label": "Team Coordinator", "builtin": False, "permissions": ["dashboard", "team"]},
    )
    return _hq_user("team_coordinator")


@pytest.fixture
def team_coordinator_client(team_coordinator):
    api = APIClient()
    api.force_authenticate(user=team_coordinator)
    return api


@pytest.fixture
def super_admin_member():
    return HQMember.objects.create(
        user=get_user_model().objects.create(
            email=f"sa-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role="super_admin"
        ),
        email=f"sa-{uuid.uuid4().hex[:8]}@example.com", name="Super Admin", sub_role="super_admin", active=True,
    )


def test_team_only_role_cannot_put_a_super_admin_row(team_coordinator_client, super_admin_member):
    """The exact live payload: PUT rewrote e-mail + sub_role and returned 200."""
    original_email = super_admin_member.user.email
    resp = team_coordinator_client.put(
        f"/api/hq/team/{super_admin_member.pk}/",
        {"email": "qa-r3-hq-takeover@example.com", "name": "QA HQ Super Admin",
         "sub_role": "support", "active": True},
        format="json",
    )
    assert resp.status_code == 403, resp.content
    super_admin_member.refresh_from_db()
    super_admin_member.user.refresh_from_db()
    assert super_admin_member.sub_role == "super_admin"
    assert super_admin_member.user.email == original_email


def test_team_only_role_cannot_put_itself_to_owner(team_coordinator_client, team_coordinator):
    """Second half of the chain: self-promotion to Owner through PUT."""
    member = HQMember.objects.get(user=team_coordinator)
    resp = team_coordinator_client.put(
        f"/api/hq/team/{member.pk}/",
        {"email": member.email, "name": "QA", "sub_role": "owner", "active": True},
        format="json",
    )
    assert resp.status_code == 403
    assert resp.json()["error"] == "only_owner_assigns_owner"
    member.refresh_from_db()
    team_coordinator.refresh_from_db()
    assert member.sub_role == "team_coordinator"
    assert team_coordinator.effective_hq_sub_role() == "team_coordinator"


def test_team_only_role_cannot_put_itself_to_super_admin(team_coordinator_client, team_coordinator):
    member = HQMember.objects.get(user=team_coordinator)
    resp = team_coordinator_client.put(
        f"/api/hq/team/{member.pk}/",
        {"email": member.email, "name": "QA", "sub_role": "super_admin", "active": True},
        format="json",
    )
    assert resp.status_code == 403
    member.refresh_from_db()
    assert member.sub_role == "team_coordinator"


def test_team_only_role_can_still_put_a_low_privilege_member(team_coordinator_client):
    """The guard must not overreach: managing ordinary staff is what the
    'team' permission is for, and PUT must keep working for it."""
    staff = HQMember.objects.create(
        user=get_user_model().objects.create(
            email=f"stf-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role="support"
        ),
        email=f"stf-{uuid.uuid4().hex[:8]}@example.com", name="Staff", sub_role="support", active=True,
    )
    resp = team_coordinator_client.put(
        f"/api/hq/team/{staff.pk}/",
        {"email": staff.email, "name": "Renamed Staff", "sub_role": "support", "active": True},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    staff.refresh_from_db()
    assert staff.name == "Renamed Staff"


def test_put_keeps_user_email_in_sync_with_the_roster_row(team_coordinator_client):
    """The `User.email` sync lived in the PATCH-only override, so a PUT wrote
    `HQMember.email` alone and the roster stopped matching the login."""
    staff_user = get_user_model().objects.create(
        email=f"stf-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role="support"
    )
    staff = HQMember.objects.create(
        user=staff_user, email=staff_user.email, name="Staff", sub_role="support", active=True,
    )
    new_email = f"renamed-{uuid.uuid4().hex[:8]}@example.com"
    resp = team_coordinator_client.put(
        f"/api/hq/team/{staff.pk}/",
        {"email": new_email, "name": "Staff", "sub_role": "support", "active": True},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    staff_user.refresh_from_db()
    assert staff_user.email == new_email


def test_put_still_refuses_a_duplicate_email(team_coordinator_client):
    taken = get_user_model().objects.create(email=f"taken-{uuid.uuid4().hex[:8]}@example.com")
    staff_user = get_user_model().objects.create(
        email=f"stf-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role="support"
    )
    staff = HQMember.objects.create(
        user=staff_user, email=staff_user.email, name="Staff", sub_role="support", active=True,
    )
    resp = team_coordinator_client.put(
        f"/api/hq/team/{staff.pk}/",
        {"email": taken.email, "name": "Staff", "sub_role": "support", "active": True},
        format="json",
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "email_taken"


def test_owner_can_still_put_another_owner():
    """Positive counterpart: owners manage each other over PUT too."""
    owner = _hq_user("owner")
    api = APIClient()
    api.force_authenticate(user=owner)
    other_owner = HQMember.objects.create(
        user=get_user_model().objects.create(
            email=f"owner2-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role="owner"
        ),
        email=f"owner2-{uuid.uuid4().hex[:8]}@example.com", name="Second Owner", sub_role="owner", active=True,
    )
    resp = api.put(
        f"/api/hq/team/{other_owner.pk}/",
        {"email": other_owner.email, "name": "Renamed Owner", "sub_role": "owner", "active": True},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    other_owner.refresh_from_db()
    assert other_owner.name == "Renamed Owner"


def test_team_only_role_still_cannot_delete_a_super_admin(team_coordinator_client, super_admin_member):
    """DELETE goes through the same shared guard now — pin it stays closed."""
    resp = team_coordinator_client.delete(f"/api/hq/team/{super_admin_member.pk}/")
    assert resp.status_code == 403
    assert HQMember.objects.filter(pk=super_admin_member.pk).exists()
