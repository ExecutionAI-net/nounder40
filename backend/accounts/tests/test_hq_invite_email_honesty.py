"""QA R2-H15: POST /api/hq/invitations/{id}/approve/ used to always answer
201 with no way to tell whether the "team_invite" email actually went out --
switching that template off in HQ > Emails silently dropped every HQ member
invite while the API kept claiming success."""
import uuid
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import HQMember, HQRole, PendingInvitation, Role
from notifications.models import EmailSetting

pytestmark = pytest.mark.django_db


def _user(**kwargs):
    return get_user_model().objects.create(email=f"u-{uuid.uuid4().hex[:8]}@example.com", **kwargs)


def _client(user):
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


@pytest.fixture
def owner():
    HQRole.objects.update_or_create(
        key="owner", defaults={"label": "Owner", "builtin": True, "permissions": ["team"]}
    )
    user = _user(role=Role.HQ, roles=[Role.HQ], hq_sub_role="owner")
    HQMember.objects.create(user=user, email=user.email, name="Owner", sub_role="owner", active=True)
    return user


def _invite(owner):
    return PendingInvitation.objects.create(
        type=PendingInvitation.Kind.HQ_MEMBER,
        name="New Member",
        email=f"invitee-{uuid.uuid4().hex[:8]}@example.com",
        role_detail="support",
        invited_by=owner,
    )


def test_approve_reports_email_sent_when_team_invite_is_on(owner, django_capture_on_commit_callbacks):
    invite = _invite(owner)

    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, django_capture_on_commit_callbacks(execute=True):
        res = _client(owner).post(f"/api/hq/invitations/{invite.pk}/approve/")

    assert res.status_code == 201, res.data
    assert res.data["email_sent"] is True
    delayed.assert_called_once()


def test_approve_reports_email_not_sent_when_team_invite_is_off(owner, django_capture_on_commit_callbacks):
    EmailSetting.objects.create(key="enabled.team_invite", value="off")
    invite = _invite(owner)

    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, django_capture_on_commit_callbacks(execute=True):
        res = _client(owner).post(f"/api/hq/invitations/{invite.pk}/approve/")

    assert res.status_code == 201, res.data
    assert res.data["email_sent"] is False
    # The switch only silences delivery, not the invite/setup link itself.
    delayed.assert_called_once()
