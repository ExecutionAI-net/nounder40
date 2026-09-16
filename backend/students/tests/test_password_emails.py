"""The "set your password" e-mail the school sends from the Students page,
one at a time (reset-password/) or for a selection (password-emails/).

Which e-mail depends on the account, not on the button: an account that
never chose a password (imported, added by the school) gets the school
invitation with the setup link; an account with a password of its own gets
the ordinary reset. Both report honestly whether anything left.
"""
import uuid
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from notifications.models import EmailSetting
from schools.models import School, SchoolMembership, SchoolRole, SchoolStudent
from students.models import Student
from students.services import INVITE_EMAIL_KEY, MAX_ROWS, PASSWORD_RESET_KEY

pytestmark = pytest.mark.django_db
User = get_user_model()
BULK = "/api/school/students/password-emails/"
SINGLE = "/api/school/students/reset-password/"


def _school(name="Danza Barcelona"):
    from core import section_guard

    SchoolRole.objects.update_or_create(key="admin", defaults={"label": "Admin", "builtin": True, "permissions": ["students"]})
    section_guard._matrix_cache["expires"] = 0.0  # see test_import_students._school
    return School.objects.create(
        name=name, slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com", language="it", active=True,
    )


def _client(school):
    user = User.objects.create(
        email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="admin")
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


def _student(school, email, *, password=None, language="it"):
    user = User.objects.create(
        email=email, role=Role.STUDENT, roles=[Role.STUDENT], first_name="Gina", last_name="Schimkovits", language_preference=language,
    )
    if password:
        user.set_password(password)
    else:
        user.set_unusable_password()
    user.save()
    student = Student.objects.create(user=user, first_name="Gina", last_name="Schimkovits", email=email, language_preference=language)
    SchoolStudent.objects.create(school=school, student=student)
    return student


def _send(api, url, payload, capture):
    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, capture(execute=True):
        res = api.post(url, payload, format="json")
    return res, {c.kwargs["to_email"]: c.kwargs for c in delayed.call_args_list}


def test_bulk_sends_invite_or_reset_depending_on_the_account(django_capture_on_commit_callbacks):
    school, other = _school(), _school("Other")
    imported = _student(school, "imported@example.com")
    active = _student(school, "active@example.com", password="Danza-2026", language="es")
    elsewhere = _student(other, "elsewhere@example.com")

    res, sent = _send(_client(school), BULK, {"student_ids": [str(imported.pk), str(active.pk), str(elsewhere.pk), str(imported.pk)]}, django_capture_on_commit_callbacks)
    assert res.status_code == 200, res.content
    assert res.json() == {"requested": 3, "sent": 2, "invites": 1, "resets": 1, "switched_off": 0, "not_found": 1}

    invite = sent["imported@example.com"]
    assert invite["key"] == INVITE_EMAIL_KEY and invite["locale"] == "it"
    assert invite["context"]["school_name"] == school.name and invite["context"]["student_first_name"] == "Gina"
    assert "/it/setup-account?uid=" in invite["context"]["setup_url"] and "&token=" in invite["context"]["setup_url"]

    reset = sent["active@example.com"]
    assert reset["key"] == PASSWORD_RESET_KEY and reset["locale"] == "es"  # the recipient's language
    assert "/es/reset-password?uid=" in reset["context"]["reset_url"]
    assert "elsewhere@example.com" not in sent


def test_bulk_reports_switched_off_emails(django_capture_on_commit_callbacks):
    school = _school()
    imported = _student(school, "imported@example.com")
    active = _student(school, "active@example.com", password="Danza-2026")
    EmailSetting.objects.create(key=f"enabled.{INVITE_EMAIL_KEY}", value="false")

    res, sent = _send(_client(school), BULK, {"student_ids": [str(imported.pk), str(active.pk)]}, django_capture_on_commit_callbacks)
    assert res.json() == {"requested": 2, "sent": 1, "invites": 0, "resets": 1, "switched_off": 1, "not_found": 0}
    assert set(sent) == {"active@example.com"}


def test_bulk_payload_guards():
    school = _school()
    api = _client(school)
    assert api.post(BULK, {"student_ids": []}, format="json").status_code == 400
    assert api.post(BULK, {"student_ids": "x"}, format="json").status_code == 400
    assert api.post(BULK, {"student_ids": ["not-a-uuid"]}, format="json").status_code == 400
    assert api.post(BULK, {"student_ids": [str(uuid.uuid4()) for _ in range(MAX_ROWS + 1)]}, format="json").status_code == 400


def test_single_reset_button_gives_a_never_activated_account_the_invite(django_capture_on_commit_callbacks):
    school = _school()
    imported = _student(school, "imported@example.com")
    res, sent = _send(_client(school), SINGLE, {"student_user_id": str(imported.user_id)}, django_capture_on_commit_callbacks)
    assert res.status_code == 200 and res.json() == {"sent": True, "kind": "invite"}
    assert sent["imported@example.com"]["key"] == INVITE_EMAIL_KEY


def test_single_reset_button_resets_an_active_account(django_capture_on_commit_callbacks):
    school = _school()
    active = _student(school, "active@example.com", password="Danza-2026")
    res, sent = _send(_client(school), SINGLE, {"student_user_id": str(active.user_id)}, django_capture_on_commit_callbacks)
    assert res.json() == {"sent": True, "kind": "reset"}
    assert sent["active@example.com"]["key"] == PASSWORD_RESET_KEY


def test_single_reset_is_honest_when_switched_off(django_capture_on_commit_callbacks):
    school = _school()
    active = _student(school, "active@example.com", password="Danza-2026")
    EmailSetting.objects.create(key="emails_enabled", value="false")
    res, sent = _send(_client(school), SINGLE, {"student_user_id": str(active.user_id)}, django_capture_on_commit_callbacks)
    assert res.json() == {"sent": False, "kind": None} and not sent


def test_single_reset_refuses_someone_elses_student():
    school, other = _school(), _school("Other")
    student = _student(other, "elsewhere@example.com")
    assert _client(school).post(SINGLE, {"student_user_id": str(student.user_id)}, format="json").status_code == 404
