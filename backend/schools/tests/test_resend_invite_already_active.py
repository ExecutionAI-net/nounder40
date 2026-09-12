"""R4-L8 (QA_REGRESSION_ROUND4 SCH-R4-05): "Resend invite" on an onboarded
member sent a fresh invitation whose link re-ran `complete-invite` and reset
her password; the Teachers page offered the button on every row.
"""
import uuid
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from schools.models import School, SchoolMembership, SchoolRole
from teachers.models import Teacher, TeacherSchool

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    for key in ("owner", "admin", "staff"):
        SchoolRole.objects.update_or_create(
            key=key, defaults={"label": key.title(), "builtin": True, "permissions": ["team", "teachers"]}
        )
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True)


@pytest.fixture
def owner_client(school):
    user = User.objects.create(
        email=f"own-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    api = APIClient()
    api.force_authenticate(user)
    return api


def _member(school, *, onboarded):
    user = User.objects.create(
        email=f"m-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school
    )
    if onboarded:
        user.set_password("Secret!2026")
    else:
        user.set_unusable_password()
    user.save()
    return SchoolMembership.objects.create(profile=user, school=school, sub_role="staff")


def _teacher(school, *, onboarded):
    user = User.objects.create(email=f"t-{uuid.uuid4().hex[:8]}@example.com", role=Role.TEACHER, roles=[Role.TEACHER])
    if onboarded:
        user.set_password("Secret!2026")
    else:
        user.set_unusable_password()
    user.save()
    teacher = Teacher.objects.create(user=user, name="T", email=user.email)
    TeacherSchool.objects.create(teacher=teacher, school=school, active=True)
    return teacher


def test_team_resend_refuses_an_onboarded_member(owner_client, school):
    m = _member(school, onboarded=True)
    with patch("schools.views._send_school_team_invite_email") as send:
        resp = owner_client.post("/api/school/team/resend/", {"id": str(m.id)}, format="json")
    assert resp.status_code == 400, resp.content
    assert resp.json()["error"] == "already_active"
    send.assert_not_called()


def test_team_resend_still_works_for_a_pending_member(owner_client, school):
    m = _member(school, onboarded=False)
    with patch("schools.views._send_school_team_invite_email", return_value=True) as send:
        resp = owner_client.post("/api/school/team/resend/", {"id": str(m.id)}, format="json")
    assert resp.status_code == 200, resp.content
    send.assert_called_once()


def test_teacher_resend_refuses_an_onboarded_teacher(owner_client, school):
    t = _teacher(school, onboarded=True)
    with patch("teachers.views._send_teacher_invite_email") as send:
        resp = owner_client.post("/api/school/teachers/resend/", {"teacher_id": str(t.id)}, format="json")
    assert resp.status_code == 400, resp.content
    assert resp.json()["error"] == "already_active"
    send.assert_not_called()


def test_teacher_roster_says_who_is_still_pending(owner_client, school):
    pending = _teacher(school, onboarded=False)
    active = _teacher(school, onboarded=True)
    rows = {r["teacher_id"]: r for r in owner_client.get("/api/school/teachers/").json()["teachers"]}
    assert rows[str(pending.id)]["pending"] is True
    assert rows[str(active.id)]["pending"] is False
