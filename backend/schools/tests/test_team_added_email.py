"""Carlo, 13/09/2026: an email to a new team member must always leave.

`SchoolTeamView.post` used to send nothing when the invitee already had an
account with a password (only the setup-link invite existed, and sending it
would reset her credentials -- SCH-R4-05). She was added silently and the
school waited for an email that never came. Now she gets `team_added`: which
school, which role, where to log in. Same honesty contract as the invite:
`email_sent` follows the HQ > Emails switch.
"""
import uuid
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from notifications.brand_templates import TEMPLATES
from notifications.builtin_templates import get_builtin
from notifications.emails import get_template, render
from notifications.models import EmailSetting
from schools.models import School, SchoolMembership, SchoolRole

pytestmark = pytest.mark.django_db
User = get_user_model()
URL = "/api/school/team/"
LOCALES = ("en", "it", "es", "fr", "de")


@pytest.fixture
def school():
    for key, label in (("owner", "Titolare"), ("admin", "Amministratrice"), ("staff", "Staff")):
        SchoolRole.objects.update_or_create(key=key, defaults={"label": label, "builtin": True, "permissions": ["team"]})
    return School.objects.create(
        name="Danza Barcelona", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"s-{uuid.uuid4().hex[:6]}@example.com",
        active=True, language="it",
    )


@pytest.fixture
def owner_client(school):
    owner = User.objects.create_user(
        f"owner-{uuid.uuid4().hex[:6]}@example.com", "Danza-2026", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school
    )
    SchoolMembership.objects.create(profile=owner, school=school, sub_role="owner")
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(owner).access_token}")
    return api


def _invite(api, capture, email, name="Alina Quintana", role="admin"):
    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, capture(execute=True):
        res = api.post(URL, {"email": email, "name": name, "school_sub_role": role, "locale": "it"}, format="json")
    return res, delayed


def test_an_existing_account_is_added_and_told_by_email(owner_client, school, django_capture_on_commit_callbacks):
    existing = User.objects.create_user("alina@example.com", "Danza-2026", role=Role.HQ, roles=[Role.HQ], full_name="Alina Quintana")

    res, delayed = _invite(owner_client, django_capture_on_commit_callbacks, "alina@example.com")

    assert res.status_code == 201, res.data
    assert res.data["existing"] is True and res.data["email_sent"] is True
    delayed.assert_called_once()
    kwargs = delayed.call_args.kwargs
    assert kwargs["key"] == "team_added" and kwargs["locale"] == "it"
    ctx = kwargs["context"]
    assert ctx["invite_org"] == "Danza Barcelona" and ctx["invite_role"] == "Amministratrice"
    assert ctx["login_url"].endswith("/it/login") and "setup_url" not in ctx
    # Password untouched, membership created, school role granted.
    existing.refresh_from_db()
    assert existing.check_password("Danza-2026") and Role.SCHOOL in existing.roles
    assert SchoolMembership.objects.filter(profile=existing, school=school, sub_role="admin").exists()
    body = render(get_template("team_added", locale="it").body_html, ctx)
    assert "Danza Barcelona" in body and "Amministratrice" in body and ctx["login_url"] in body


def test_a_new_account_still_gets_the_setup_invite(owner_client, django_capture_on_commit_callbacks):
    res, delayed = _invite(owner_client, django_capture_on_commit_callbacks, f"new-{uuid.uuid4().hex[:6]}@example.com")
    assert res.status_code == 201, res.data
    assert res.data["existing"] is False and res.data["email_sent"] is True
    assert delayed.call_args.kwargs["key"] == "team_invite"
    assert "setup_url" in delayed.call_args.kwargs["context"]


def test_the_switch_in_hq_emails_is_reported_honestly(owner_client, django_capture_on_commit_callbacks):
    User.objects.create_user("alina@example.com", "Danza-2026", role=Role.STUDENT, roles=[Role.STUDENT])
    EmailSetting.objects.create(key="enabled.team_added", value="off")

    res, delayed = _invite(owner_client, django_capture_on_commit_callbacks, "alina@example.com")

    assert res.status_code == 201, res.data
    assert res.data["existing"] is True and res.data["email_sent"] is False
    delayed.assert_called_once()  # the task itself re-checks the switch and skips


@pytest.mark.parametrize("locale", LOCALES)
def test_the_copy_names_org_role_and_login_in_every_locale(locale):
    subject, text = TEMPLATES["team_added"][locale]
    assert "{{invite_org}}" in subject + text and "{{invite_role}}" in subject + text
    assert "{{login_url}}" in text and "{{setup_url}}" not in text
    builtin_subject, builtin_body = get_builtin("team_added", locale)
    assert "{{login_url}}" in builtin_body and "{{invite_org}}" in builtin_subject
