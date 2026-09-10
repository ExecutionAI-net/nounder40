"""X-R3-10: starting a thread needs the same authority as reading one.

`perform_create`'s HQ branch was `if role == "hq" and is_hq(user)` and
nothing else, so `finance` and `analytics` -- roles `visible_conversations()`
shows nothing to -- could open a thread, and a bare `POST {}` took the model
defaults and produced `type=school_student, school=NULL`: a row only
god-mode HQ can ever see again. The student branch trusted the `school` in
the request body, so a student could open a thread at a school she has never
enrolled at.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import HQMember, Role
from chat.models import Conversation
from schools.models import School, SchoolStudent
from students.models import Student

pytestmark = pytest.mark.django_db
User = get_user_model()
URL = "/api/chat/conversations/"


def _client(user, panel=None):
    api = APIClient()
    headers = {"HTTP_AUTHORIZATION": f"Bearer {RefreshToken.for_user(user).access_token}"}
    if panel:
        headers["HTTP_X_PANEL_ROLE"] = panel
    api.credentials(**headers)
    return api


def _school(name="S"):
    return School.objects.create(
        name=name, slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com",
    )


def _hq(sub_role):
    user = User.objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ],
        hq_sub_role=sub_role,
    )
    HQMember.objects.create(user=user, email=user.email, name="HQ", sub_role=sub_role, active=True)
    return user


def _student(school, *, enrolled=True):
    user = User.objects.create(
        email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT],
    )
    student = Student.objects.create(user=user, name="Anna", school=school)
    if enrolled:
        SchoolStudent.objects.create(school=school, student=student)
    return user, student


def test_an_hq_owner_can_open_a_thread_with_a_school(_=None):
    school = _school()
    owner = _hq("super_admin")
    resp = _client(owner, "hq").post(URL, {"type": "hq_school", "school": str(school.id)}, format="json")
    assert resp.status_code == 201, resp.data
    conv = Conversation.objects.get(pk=resp.json()["id"])
    assert (conv.hq_id, conv.school_id, conv.type) == (owner.id, school.id, Conversation.Type.HQ_SCHOOL)


def test_an_empty_body_no_longer_creates_an_orphan():
    owner = _hq("super_admin")
    resp = _client(owner, "hq").post(URL, {}, format="json")
    assert resp.status_code == 400, resp.data
    assert not Conversation.objects.exists()


def test_an_hq_thread_without_a_school_is_refused():
    owner = _hq("super_admin")
    resp = _client(owner, "hq").post(URL, {"type": "hq_school"}, format="json")
    assert resp.status_code == 400, resp.data
    assert not Conversation.objects.exists()


@pytest.mark.parametrize("sub_role", ["finance", "analytics"])
def test_a_role_that_sees_no_threads_cannot_start_one(sub_role):
    school = _school()
    narrow = _hq(sub_role)
    resp = _client(narrow, "hq").post(
        URL, {"type": "hq_school", "school": str(school.id)}, format="json",
    )
    assert resp.status_code == 403, resp.data
    assert not Conversation.objects.exists()


def test_support_keeps_the_inbox_it_exists_for():
    """The gate mirrors the read side, so the narrow role WITH `inbox` stays
    able to work -- otherwise the fix would break the HQ support desk."""
    from core.section_guard import hq_has_permission

    school = _school()
    support = _hq("support")
    if not hq_has_permission(support, "inbox"):
        pytest.skip("this deployment's `support` role has no inbox permission")
    resp = _client(support, "hq").post(
        URL, {"type": "hq_school", "school": str(school.id)}, format="json",
    )
    assert resp.status_code == 201, resp.data


def test_a_student_can_open_a_thread_with_her_own_school():
    school = _school()
    user, _student_row = _student(school)
    resp = _client(user, "student").post(
        URL, {"type": "school_student", "school": str(school.id)}, format="json",
    )
    assert resp.status_code == 201, resp.data


def test_a_student_cannot_open_a_thread_at_a_school_she_is_not_enrolled_at():
    mine, theirs = _school("Mine"), _school("Theirs")
    user, _student_row = _student(mine)
    resp = _client(user, "student").post(
        URL, {"type": "school_student", "school": str(theirs.id)}, format="json",
    )
    assert resp.status_code == 403, resp.data
    assert not Conversation.objects.filter(school=theirs).exists()


def test_enrolment_at_a_second_school_is_enough():
    home, second = _school("Home"), _school("Second")
    user, student = _student(home)
    SchoolStudent.objects.create(school=second, student=student)
    resp = _client(user, "student").post(
        URL, {"type": "school_student", "school": str(second.id)}, format="json",
    )
    assert resp.status_code == 201, resp.data
