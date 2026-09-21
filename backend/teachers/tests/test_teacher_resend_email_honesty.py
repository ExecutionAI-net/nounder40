"""R3-M2 (QA_REGRESSION_ROUND3_CROSSCUT.md X-R3-08): the last invite call
site that still claimed success it hadn't earned.

PR #106 (R2-H15) made five of the six invite endpoints report whether the
mail will actually be sent — `enabled.team_invite` can be switched off in
HQ > Emails, and then nothing is queued at all.
`SchoolTeacherResendInviteView.post` discarded `_send_teacher_invite_email`'s
return value and answered a hardcoded `{"sent": true}`.

Live, with the switch off: `/school/team/` 201 `email_sent:false` ✓,
`/school/team/resend/` `sent:false` ✓, `/school/teachers/` 201
`email_sent:false` ✓, HQ invite+approve `email_sent:false` ✓, HQ school
resend `email_sent:false` ✓ — and `/school/teachers/resend/` **200
`sent:true`** while no mail reached any inbox.
"""
import uuid

from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from notifications.models import EmailSetting
from schools.models import School, SchoolMembership, SchoolRole
from teachers.models import Teacher, TeacherSchool

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    for key, label in (("owner", "Titolare"), ("admin", "Amministratore"), ("staff", "Staff")):
        SchoolRole.objects.update_or_create(
            key=key, defaults={"label": label, "builtin": True, "permissions": ["teachers", "team"]}
        )
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com", active=True
    )


@pytest.fixture
def owner_client(school):
    user = User.objects.create(
        email=f"own-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


@pytest.fixture
def teacher(school):
    email = f"t-{uuid.uuid4().hex[:8]}@example.com"
    user = User.objects.create(email=email, role=Role.TEACHER, roles=[Role.TEACHER])
    user.set_unusable_password()
    user.save(update_fields=["password"])
    obj = Teacher.objects.create(user=user, name="QA Teacher", email=email)
    TeacherSchool.objects.create(teacher=obj, school=school)
    return obj


def _set_team_invite(enabled: bool):
    EmailSetting.objects.update_or_create(key="enabled.team_invite", defaults={"value": "true" if enabled else "false"})


def test_resend_reports_false_when_the_template_is_switched_off(owner_client, teacher):
    """The live repro: 200 `sent: true` while no mail was queued."""
    _set_team_invite(False)

    resp = owner_client.post("/api/school/teachers/resend/", {"teacher_id": str(teacher.id)}, format="json")

    assert resp.status_code == 200, resp.content
    assert resp.json() == {"sent": False, "kind": "invite"}


def test_resend_still_reports_true_when_the_template_is_on(owner_client, teacher):
    _set_team_invite(True)

    resp = owner_client.post("/api/school/teachers/resend/", {"teacher_id": str(teacher.id)}, format="json")

    assert resp.status_code == 200, resp.content
    assert resp.json() == {"sent": True, "kind": "invite"}


def test_an_unknown_teacher_still_404s(owner_client):
    resp = owner_client.post(
        "/api/school/teachers/resend/", {"teacher_id": str(uuid.uuid4())}, format="json"
    )
    assert resp.status_code == 404, resp.content


def test_resend_for_an_active_teacher_sends_the_password_reset_not_the_setup_link(
    owner_client, teacher, django_capture_on_commit_callbacks
):
    """Carlo, 21/09/2026: the button stays for everyone. An onboarded teacher
    must not get the setup link (SCH-R4-05: it re-runs complete-invite and
    replaces her password) -- she gets the ordinary reset e-mail, in her own
    language, and the school is told which one went out."""
    teacher.user.set_password("Danza-2026")
    teacher.user.language_preference = "fr"
    teacher.user.save(update_fields=["password", "language_preference"])
    EmailSetting.objects.update_or_create(key="enabled.password_reset", defaults={"value": "true"})

    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, django_capture_on_commit_callbacks(
        execute=True
    ):
        resp = owner_client.post("/api/school/teachers/resend/", {"teacher_id": str(teacher.id)}, format="json")

    assert resp.status_code == 200, resp.content
    assert resp.json() == {"sent": True, "kind": "reset"}
    kwargs = delayed.call_args.kwargs
    assert kwargs["key"] == "password_reset" and kwargs["locale"] == "fr"
    assert "/fr/reset-password?uid=" in kwargs["context"]["reset_url"]
    assert "setup_url" not in kwargs["context"]
