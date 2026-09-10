"""A multi-role account acts as ONE role per panel in chat (2026-09-07).

/api/chat/ is one shared mount, so unlike /api/school/* vs /api/hq/* it could
not tell which panel a multi-role account was on: `is_hq(user)` won the HQ
branch everywhere. Live symptoms on dev: the school-side admin (roles hq +
school, member of two schools) saw the same six conversations -- all of
them -- whichever school was active; a thread opened from the school panel
was saved as `hq=user` with no school (HQ's inbox showed it with no school
name); every message carried sender_role "hq"; and nothing ever counted as
unread because every message was "mine".

The frontend now sends X-Panel-Role (REST) / ?as= (WS); chat/panel.py only
honours a role the user really holds."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import HQMember, Role
from chat.models import Conversation, Message
from chat.panel import panel_role
from chat.realtime import INBOX_HQ_GROUP, inbox_groups_for_user
from schools.models import School, SchoolMembership
from students.models import Student

pytestmark = pytest.mark.django_db
User = get_user_model()


def _client(user, panel=None):
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    if panel:
        api.credentials(
            HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}",
            HTTP_X_PANEL_ROLE=panel,
        )
    return api


def _school(name):
    return School.objects.create(name=name, slug=f"{name.lower()}-{uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:6]}@example.com")


@pytest.fixture
def schools():
    return _school("Barcelona"), _school("Milano")


@pytest.fixture
def multi(schools):
    """Carlo-shaped account: primary role hq (super_admin), also a school admin
    of both schools, Barcelona active."""
    bcn, mil = schools
    u = User.objects.create(
        email=f"multi-{uuid.uuid4().hex[:6]}@example.com", role=Role.HQ,
        roles=[Role.HQ, Role.SCHOOL], hq_sub_role="super_admin", school_sub_role="admin", active_school=bcn,
    )
    HQMember.objects.create(user=u, sub_role="super_admin")
    for s in (bcn, mil):
        SchoolMembership.objects.create(profile=u, school=s, sub_role="admin")
    return u


@pytest.fixture
def threads(schools):
    bcn, mil = schools
    stu_user = User.objects.create(email=f"s-{uuid.uuid4().hex[:6]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT])
    stu = Student.objects.create(user=stu_user, name="S", school=bcn)
    return {
        "bcn_student": Conversation.objects.create(type="school_student", school=bcn, student=stu),
        "bcn_hq": Conversation.objects.create(type="hq_school", school=bcn),
        "mil_student": Conversation.objects.create(type="school_student", school=mil),
        "orphan_hq": Conversation.objects.create(type="hq_school"),
        "student": stu,
    }


# --- resolution ------------------------------------------------------------

def test_panel_role_honours_a_held_role_and_falls_back_otherwise(multi):
    assert panel_role(multi, "school") == "school"
    assert panel_role(multi, "hq") == "hq"
    assert panel_role(multi, "teacher") == "hq"   # not held -> primary role
    assert panel_role(multi, "godmode") == "hq"
    assert panel_role(multi, None) == "hq"


def test_single_role_user_ignores_a_forged_header(schools):
    bcn, _ = schools
    u = User.objects.create(email=f"adm-{uuid.uuid4().hex[:6]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=bcn)
    assert panel_role(u, "hq") == "school"


# --- visibility follows the panel --------------------------------------------

def test_school_panel_sees_only_the_active_school(multi, threads, schools):
    bcn, mil = schools
    ids = {c["id"] for c in _client(multi, "school").get("/api/chat/conversations/").json()}
    assert ids == {str(threads["bcn_student"].id), str(threads["bcn_hq"].id)}

    multi.active_school = mil
    multi.save(update_fields=["active_school"])
    ids = {c["id"] for c in _client(multi, "school").get("/api/chat/conversations/").json()}
    assert ids == {str(threads["mil_student"].id)}


def test_hq_panel_still_sees_everything(multi, threads):
    ids = {c["id"] for c in _client(multi, "hq").get("/api/chat/conversations/").json()}
    assert ids == {str(threads[k].id) for k in ("bcn_student", "bcn_hq", "mil_student", "orphan_hq")}


def test_no_header_keeps_the_old_primary_role_behaviour(multi, threads):
    assert len(_client(multi).get("/api/chat/conversations/").json()) == 4


def test_unread_count_follows_the_panel(multi, threads):
    stu = threads["student"]
    for conv in (threads["bcn_student"], threads["mil_student"]):
        Message.objects.create(conversation=conv, sender=stu.user, sender_role="student", content="hi")
    assert _client(multi, "school").get("/api/chat/unread/").json()["total"] == 1   # Barcelona only
    assert _client(multi, "hq").get("/api/chat/unread/").json()["total"] == 2


# --- creation follows the panel ----------------------------------------------

def test_thread_opened_from_the_school_panel_belongs_to_the_school(multi, schools):
    bcn, _ = schools
    r = _client(multi, "school").post("/api/chat/conversations/", {"type": "hq_school"}, format="json")
    assert r.status_code == 201, r.content
    conv = Conversation.objects.get(pk=r.json()["id"])
    assert conv.school_id == bcn.id
    assert conv.hq_id is None
    assert r.json()["school_name"] == "Barcelona"


def test_thread_opened_from_the_hq_panel_is_hq_owned(multi, schools):
    bcn, _mil = schools
    # X-R3-10: the school is required now — an HQ<->School thread with no
    # school is the orphan that finding is about. The HQ inbox already sends
    # it (hq/inbox/page.tsx).
    r = _client(multi, "hq").post(
        "/api/chat/conversations/", {"type": "hq_school", "school": str(bcn.id)}, format="json",
    )
    assert r.status_code == 201
    conv = Conversation.objects.get(pk=r.json()["id"])
    assert (conv.hq_id, conv.school_id) == (multi.id, bcn.id)


def test_message_carries_the_panel_role_and_counts_as_unread_on_the_other_side(multi, threads):
    conv = threads["bcn_hq"]
    r = _client(multi, "hq").post(f"/api/chat/conversations/{conv.id}/messages/", {"content": "ciao scuola"}, format="json")
    assert r.status_code == 201 and r.json()["sender_role"] == "hq"
    # same person, school panel: it is not "mine" there, so it is unread
    assert _client(multi, "school").get("/api/chat/unread/").json()["total"] == 1
    assert _client(multi, "hq").get("/api/chat/unread/").json()["total"] == 0
    r = _client(multi, "school").post(f"/api/chat/conversations/{conv.id}/read/")
    assert r.json()["marked_read"] == 1
    assert _client(multi, "school").get("/api/chat/unread/").json()["total"] == 0


def test_internal_note_is_hidden_from_the_student_panel_only(multi, threads):
    """A staff-side flag: the panel decides, not the union of roles."""
    conv = threads["bcn_student"]
    _client(multi, "school").post(f"/api/chat/conversations/{conv.id}/messages/", {"content": "nota", "is_internal": True}, format="json")
    assert len(_client(multi, "school").get(f"/api/chat/conversations/{conv.id}/messages/").json()) == 1
    assert len(_client(threads["student"].user).get(f"/api/chat/conversations/{conv.id}/messages/").json()) == 0


# --- realtime groups follow the panel ----------------------------------------

def test_inbox_groups_follow_the_panel(multi, schools):
    bcn, _ = schools
    assert inbox_groups_for_user(multi, "school") == [f"inbox_user_{multi.id}", f"inbox_school_{bcn.id}"]
    assert inbox_groups_for_user(multi, "hq") == [f"inbox_user_{multi.id}", INBOX_HQ_GROUP]
    assert inbox_groups_for_user(multi) == [f"inbox_user_{multi.id}", INBOX_HQ_GROUP]
