"""Sidebar unread badge in realtime (brainstorm point 1, 2026-09-07).

The badge used to refresh only on a 60 s poll / tab focus. Now every message
create pings an `inbox_event` to the Channels groups of everyone who can see
the conversation, and marking messages read pings the reader's own group so
their other tabs drop the badge. These tests pin the *targeting*: the groups
must mirror visible_conversations() (a teacher is not in her school's group,
HQ is only pinged for the two thread types its inbox is for) and the REST
views must actually fire the signal."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from chat import realtime, views
from chat.models import Conversation
from chat.realtime import INBOX_HQ_GROUP, inbox_groups_for_conversation, inbox_groups_for_user
from schools.models import School
from students.models import Student
from teachers.models import Teacher, TeacherSchool

pytestmark = pytest.mark.django_db
User = get_user_model()


def _jwt_client(user):
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com")


@pytest.fixture
def student(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT])
    return Student.objects.create(user=user, name="S1", school=school)


@pytest.fixture
def teacher(school):
    user = User.objects.create(email=f"t-{uuid.uuid4().hex[:8]}@example.com", role=Role.TEACHER, roles=[Role.TEACHER])
    t = Teacher.objects.create(user=user, name="T", email=user.email)
    TeacherSchool.objects.create(teacher=t, school=school, active=True)
    return t


@pytest.fixture
def school_user(school):
    return User.objects.create(
        email=f"adm-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        school_sub_role="admin", active_school=school,
    )


@pytest.fixture
def sent(monkeypatch):
    """Capture group_send calls instead of touching Redis."""
    calls = []

    class _Layer:
        async def group_send(self, group, event):
            calls.append((group, event))

    monkeypatch.setattr(realtime, "get_channel_layer", lambda: _Layer())
    return calls


# --- group targeting -------------------------------------------------------

def test_school_student_thread_pings_student_user_and_school_only(school, student):
    conv = Conversation.objects.create(type="school_student", school=school, student=student)
    assert inbox_groups_for_conversation(conv) == [
        f"inbox_user_{student.user_id}", f"inbox_school_{school.id}",
    ]


def test_hq_school_thread_pings_school_and_hq(school):
    conv = Conversation.objects.create(type="hq_school", school=school)
    assert inbox_groups_for_conversation(conv) == [f"inbox_school_{school.id}", INBOX_HQ_GROUP]


def test_teacher_support_thread_pings_teacher_user_and_hq(teacher):
    conv = Conversation.objects.create(type="teacher_support", teacher=teacher)
    assert inbox_groups_for_conversation(conv) == [f"inbox_user_{teacher.user_id}", INBOX_HQ_GROUP]


def test_teacher_listens_on_her_own_group_never_the_schools(teacher, school):
    """R2-C2 mirror: a teacher's badge must not react to school<->student threads."""
    teacher.user.active_school = school
    assert inbox_groups_for_user(teacher.user) == [f"inbox_user_{teacher.user_id}"]


def test_school_user_listens_on_user_and_school_groups(school_user, school):
    assert inbox_groups_for_user(school_user) == [f"inbox_user_{school_user.id}", f"inbox_school_{school.id}"]


def test_hq_user_listens_on_hq_group():
    hq = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ])
    assert inbox_groups_for_user(hq) == [f"inbox_user_{hq.id}", INBOX_HQ_GROUP]


# --- the views actually fire it --------------------------------------------

def test_posting_a_message_pings_the_inbox_groups(school, student, sent):
    conv = Conversation.objects.create(type="school_student", school=school, student=student)
    r = _jwt_client(student.user).post(f"/api/chat/conversations/{conv.id}/messages/", {"content": "hi"}, format="json")
    assert r.status_code == 201
    inbox = [(g, e) for g, e in sent if e["type"] == "inbox_event"]
    assert [g for g, _ in inbox] == [f"inbox_user_{student.user_id}", f"inbox_school_{school.id}"]
    assert inbox[0][1]["reason"] == "new_message"
    assert inbox[0][1]["conversation"] == str(conv.id)
    assert inbox[0][1]["sender"] == str(student.user_id)
    # the per-conversation chat broadcast is untouched
    assert any(g == f"chat_{conv.id}" for g, _ in sent)


def test_marking_read_pings_only_the_reader(school, student, school_user, sent):
    conv = Conversation.objects.create(type="school_student", school=school, student=student)
    _jwt_client(student.user).post(f"/api/chat/conversations/{conv.id}/messages/", {"content": "hi"}, format="json")
    sent.clear()
    r = _jwt_client(school_user).post(f"/api/chat/conversations/{conv.id}/read/")
    assert r.status_code == 200 and r.json()["marked_read"] == 1
    assert [(g, e["reason"]) for g, e in sent] == [(f"inbox_user_{school_user.id}", "read")]


def test_marking_read_with_nothing_unread_is_silent(school, student, school_user, sent):
    conv = Conversation.objects.create(type="school_student", school=school, student=student)
    r = _jwt_client(school_user).post(f"/api/chat/conversations/{conv.id}/read/")
    assert r.status_code == 200 and r.json()["marked_read"] == 0
    assert sent == []


def test_no_channel_layer_is_a_noop(school, student, monkeypatch):
    monkeypatch.setattr(realtime, "get_channel_layer", lambda: None)
    conv = Conversation.objects.create(type="school_student", school=school, student=student)
    r = _jwt_client(student.user).post(f"/api/chat/conversations/{conv.id}/messages/", {"content": "hi"}, format="json")
    assert r.status_code == 201


def test_views_import_the_inbox_signal():
    assert views.broadcast_inbox_changed is realtime.broadcast_inbox_changed
