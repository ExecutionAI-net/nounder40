"""QA R2-H15: three school-side invite endpoints share the "team_invite"
email template with the HQ member and teacher invite flows. Switching that
template off in HQ > Emails used to still answer with unconditional success
({"success": true} / {"sent": true} / no email_sent field at all) while the
email was silently dropped."""
import uuid
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import HQMember, HQRole, Role
from notifications.models import EmailSetting
from schools.models import School, SchoolMembership, SchoolRole

pytestmark = pytest.mark.django_db


def _user(**kwargs):
    return get_user_model().objects.create(email=f"u-{uuid.uuid4().hex[:8]}@example.com", **kwargs)


def _client(user):
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


@pytest.fixture
def school():
    for key, label in (("owner", "Titolare"), ("admin", "Amministratore"), ("staff", "Staff")):
        SchoolRole.objects.update_or_create(
            key=key, defaults={"label": label, "builtin": True, "permissions": ["team"]}
        )
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"s-{uuid.uuid4().hex[:8]}@example.com", active=True
    )


@pytest.fixture
def hq_owner():
    HQRole.objects.update_or_create(
        key="owner", defaults={"label": "Owner", "builtin": True, "permissions": ["schools"]}
    )
    user = _user(role=Role.HQ, roles=[Role.HQ], hq_sub_role="owner")
    HQMember.objects.create(user=user, email=user.email, name="Owner", sub_role="owner", active=True)
    return user


@pytest.fixture
def school_owner(school):
    user = _user(role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school)
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    return user


def _disable_team_invite():
    EmailSetting.objects.create(key="enabled.team_invite", value="off")


def test_hq_resend_invite_reports_email_sent_when_team_invite_is_on(hq_owner, school, django_capture_on_commit_callbacks):
    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, django_capture_on_commit_callbacks(execute=True):
        res = _client(hq_owner).post(f"/api/hq/schools/{school.pk}/resend-invite/")

    assert res.status_code == 200, res.data
    assert res.data == {"success": True, "email_sent": True}
    delayed.assert_called_once()


def test_hq_resend_invite_reports_email_not_sent_when_team_invite_is_off(hq_owner, school, django_capture_on_commit_callbacks):
    _disable_team_invite()

    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, django_capture_on_commit_callbacks(execute=True):
        res = _client(hq_owner).post(f"/api/hq/schools/{school.pk}/resend-invite/")

    assert res.status_code == 200, res.data
    assert res.data == {"success": True, "email_sent": False}
    delayed.assert_called_once()


def test_school_team_post_reports_email_sent_when_team_invite_is_on(school_owner, school, django_capture_on_commit_callbacks):
    payload = {"email": f"newbie-{uuid.uuid4().hex[:8]}@example.com", "name": "New Person", "school_sub_role": "staff"}

    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, django_capture_on_commit_callbacks(execute=True):
        res = _client(school_owner).post("/api/school/team/", payload, format="json")

    assert res.status_code == 201, res.data
    assert res.data["email_sent"] is True
    delayed.assert_called_once()


def test_school_team_post_reports_email_not_sent_when_team_invite_is_off(school_owner, school, django_capture_on_commit_callbacks):
    _disable_team_invite()
    payload = {"email": f"newbie-{uuid.uuid4().hex[:8]}@example.com", "name": "New Person", "school_sub_role": "staff"}

    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, django_capture_on_commit_callbacks(execute=True):
        res = _client(school_owner).post("/api/school/team/", payload, format="json")

    assert res.status_code == 201, res.data
    assert res.data["email_sent"] is False
    delayed.assert_called_once()


def test_school_team_resend_reports_sent_when_team_invite_is_on(school_owner, school, django_capture_on_commit_callbacks):
    pending = _user(role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school)
    pending.set_unusable_password()
    pending.save()
    membership = SchoolMembership.objects.create(profile=pending, school=school, sub_role="staff")

    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, django_capture_on_commit_callbacks(execute=True):
        res = _client(school_owner).post("/api/school/team/resend/", {"id": str(membership.pk)}, format="json")

    assert res.status_code == 200, res.data
    assert res.data == {"sent": True}
    delayed.assert_called_once()


def test_school_team_resend_reports_not_sent_when_team_invite_is_off(school_owner, school, django_capture_on_commit_callbacks):
    _disable_team_invite()
    pending = _user(role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school)
    pending.set_unusable_password()
    pending.save()
    membership = SchoolMembership.objects.create(profile=pending, school=school, sub_role="staff")

    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, django_capture_on_commit_callbacks(execute=True):
        res = _client(school_owner).post("/api/school/team/resend/", {"id": str(membership.pk)}, format="json")

    assert res.status_code == 200, res.data
    assert res.data == {"sent": False}
    delayed.assert_called_once()
