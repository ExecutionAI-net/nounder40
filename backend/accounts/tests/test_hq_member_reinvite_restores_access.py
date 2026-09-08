"""R3-H3 (QA_REGRESSION_ROUND3_HQ.md HQ-R3-02): a removed HQ member could
never be re-added through the product.

The R2-M19a fix (`revoke_role`) correctly deactivates the account when a
removal leaves it with no role and no other profile, and blacklists its
refresh tokens. What was missing is the way back: `approve()` re-created the
`HQMember` row — so the person reappeared on the Team page — but never
touched `roles`, `role` or `is_active`, so `POST /auth/login/` answered
`401 "No active account found"` forever. Live this happened to three
accounts, `qa.hq.super_admin@qa-nounder40.test` among them, and no product
path could repair it.

The same gap, less visibly, hit any pre-existing account invited into HQ (a
teacher, say): the HQMember row appeared but without `hq` in `roles` no HQ
guard recognised it.

These tests pin both halves: removal still kills the session immediately
(R2-M19a's actual security property), and re-invite → approve makes the
account usable again.
"""
import uuid

import pytest
from django.contrib.auth import authenticate, get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import HQMember, HQRole, PendingInvitation, Role

pytestmark = pytest.mark.django_db
User = get_user_model()
PASSWORD = "Str0ngPassw0rd!42"


@pytest.fixture
def hq_roles():
    HQRole.objects.update_or_create(
        key="owner", defaults={"label": "Owner", "builtin": True, "permissions": ["team", "permissions"]}
    )
    HQRole.objects.update_or_create(
        key="super_admin",
        defaults={"label": "Super Admin", "builtin": True, "permissions": ["team", "permissions"]},
    )


def _client(user):
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


@pytest.fixture
def owner_client(hq_roles):
    user = User.objects.create(
        email=f"owner-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role="owner"
    )
    HQMember.objects.create(user=user, email=user.email, name="Owner", sub_role="owner", active=True)
    return _client(user)


@pytest.fixture
def member(hq_roles):
    """A real HQ super_admin with a working password, like the live victim."""
    user = User.objects.create(
        email=f"sa-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role="super_admin"
    )
    user.set_password(PASSWORD)
    user.save(update_fields=["password"])
    HQMember.objects.create(user=user, email=user.email, name="Super Admin", sub_role="super_admin", active=True)
    return user


def _invite_and_approve(owner_client, email, *, name="Super Admin", role_detail="super_admin"):
    resp = owner_client.post(
        "/api/hq/invitations/",
        {"type": PendingInvitation.Kind.HQ_MEMBER, "email": email, "name": name, "role_detail": role_detail},
        format="json",
    )
    assert resp.status_code == 201, resp.content
    invite_id = resp.json()["id"]
    resp = owner_client.post(f"/api/hq/invitations/{invite_id}/approve/")
    assert resp.status_code == 201, resp.content
    return resp


def test_removal_still_deactivates_and_kills_the_session(owner_client, member):
    """The R2-M19a property this fix must not weaken."""
    resp = owner_client.delete(f"/api/hq/team/{member.pk}/")
    assert resp.status_code == 204, resp.content
    member.refresh_from_db()
    assert member.is_active is False
    assert member.roles == []
    assert authenticate(username=member.email, password=PASSWORD) is None


def test_reinviting_a_removed_member_makes_the_account_usable_again(owner_client, member):
    """The live repro: 201 on invite, 201 on approve, row back on the Team
    page — and login still 401 forever."""
    email = member.email
    owner_client.delete(f"/api/hq/team/{member.pk}/")
    member.refresh_from_db()
    assert member.is_active is False

    _invite_and_approve(owner_client, email)

    member.refresh_from_db()
    assert member.is_active is True
    assert Role.HQ in member.roles
    assert member.role == Role.HQ
    assert member.hq_sub_role == "super_admin"
    assert HQMember.objects.filter(user=member, sub_role="super_admin", active=True).exists()
    # The password survived the removal, so the person is back in immediately;
    # the invite e-mail link is the path for someone who never set one.
    assert authenticate(username=email, password=PASSWORD) is not None


def test_the_restored_member_can_log_in_over_the_api(owner_client, member):
    email = member.email
    owner_client.delete(f"/api/hq/team/{member.pk}/")
    assert APIClient().post(
        "/api/auth/login/", {"email": email, "password": PASSWORD}, format="json"
    ).status_code == 401

    _invite_and_approve(owner_client, email)

    resp = APIClient().post("/api/auth/login/", {"email": email, "password": PASSWORD}, format="json")
    assert resp.status_code == 200, resp.content
    assert resp.json()["access"]


def test_old_refresh_tokens_stay_blacklisted_after_the_restore(owner_client, member):
    """Recoverable must not mean "the removal never happened": the sessions
    that were open at removal time stay dead."""
    from rest_framework_simplejwt.exceptions import TokenError

    refresh = RefreshToken.for_user(member)
    email = member.email
    owner_client.delete(f"/api/hq/team/{member.pk}/")
    _invite_and_approve(owner_client, email)

    resp = APIClient().post("/api/auth/refresh/", {"refresh": str(refresh)}, format="json")
    assert resp.status_code == 401, resp.content
    with pytest.raises(TokenError):
        RefreshToken(str(refresh)).check_blacklist()


def test_inviting_an_existing_non_hq_account_actually_grants_the_hq_role(owner_client, hq_roles):
    """Same gap seen from the other side: a teacher invited into HQ used to
    get an HQMember row and no `hq` role at all."""
    teacher = User.objects.create(
        email=f"t-{uuid.uuid4().hex[:8]}@example.com", role=Role.TEACHER, roles=[Role.TEACHER]
    )
    _invite_and_approve(owner_client, teacher.email, name="Teacher", role_detail="support")

    teacher.refresh_from_db()
    assert Role.HQ in teacher.roles
    assert Role.TEACHER in teacher.roles, "the account's other roles must survive"
    assert teacher.role == Role.TEACHER, "the primary role is not hijacked by an HQ invite"
    assert teacher.hq_sub_role == "support"
    assert teacher.is_active is True


def test_approving_an_invite_does_not_deactivate_or_downgrade_an_active_member(owner_client, member):
    """No removal in between — approve must be a no-op on the account itself
    apart from the sub-role it carries."""
    _invite_and_approve(owner_client, member.email, role_detail="support")
    member.refresh_from_db()
    assert member.is_active is True
    assert member.roles == [Role.HQ]
    assert member.hq_sub_role == "support"
