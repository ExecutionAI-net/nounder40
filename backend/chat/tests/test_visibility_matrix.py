"""R2-C2 / X-R2-01 (plus the HQ cross-reference from R2-H2 / X-R2-03):

`visible_conversations()` used to grant a teacher the exact same broad
`Conversation.objects.filter(school_id=<her school>)` access as a school-role
user, so ANY teacher of a school -- no staff grants required -- could list,
read, reply to, mark-read, resolve and delete every conversation of that
school, including private `school_student` threads (a student's own chat
with the school) and `hq_school` threads. The unread-count endpoint counted
them too.

It also treated ANY HQ token as god-mode over chat, so a narrow HQ role
(`support`/`tech_support`, permissions only `dashboard` + `inbox`) could read
and post into a school's private `school_student` chat.

Fixed matrix: a teacher only sees conversations where `teacher == self`
(her `school_teacher` and `teacher_support` threads); a school-role user
still sees every conversation of her own school; a narrow HQ role with the
`inbox` permission sees only `hq_school` and `teacher_support` (its own
inbox), never `school_student` / `school_teacher`; a broad HQ role
(owner/super_admin, or `schools_create_edit`) keeps full visibility."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import HQMember, Role
from chat.models import Conversation, Message
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
    """A plain teacher of `school`, no staff grants, single school (so
    `_role_context` resolves her school unambiguously via TeacherSchool)."""
    user = User.objects.create(email=f"t-{uuid.uuid4().hex[:8]}@example.com", role=Role.TEACHER, roles=[Role.TEACHER])
    t = Teacher.objects.create(user=user, name="T2", email=user.email)
    TeacherSchool.objects.create(teacher=t, school=school, active=True)
    return t


@pytest.fixture
def school_student_conversation(school, student):
    """The private thread a student opens with her own school."""
    return Conversation.objects.create(type=Conversation.Type.SCHOOL_STUDENT, school=school, student=student)


@pytest.fixture
def hq_school_conversation(school):
    return Conversation.objects.create(type=Conversation.Type.HQ_SCHOOL, school=school)


@pytest.fixture
def other_teacher_thread(school):
    """Another teacher's own school_teacher thread -- not the probing
    teacher's, and not a school_student/hq_school thread either."""
    user = User.objects.create(email=f"t-other-{uuid.uuid4().hex[:8]}@example.com", role=Role.TEACHER, roles=[Role.TEACHER])
    other = Teacher.objects.create(user=user, name="T1", email=user.email)
    TeacherSchool.objects.create(teacher=other, school=school, active=True)
    return Conversation.objects.create(type=Conversation.Type.SCHOOL_TEACHER, school=school, teacher=other)


def _hq_client(sub_role):
    user = User.objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role=sub_role,
    )
    HQMember.objects.create(user=user, email=user.email, name="QA", sub_role=sub_role)
    return _jwt_client(user)


# --- R2-C2: a plain teacher must not see the school's or other roles' chats -

def test_teacher_cannot_list_a_school_student_conversation(teacher, school_student_conversation):
    resp = _jwt_client(teacher.user).get("/api/chat/conversations/")
    assert resp.status_code == 200
    assert str(school_student_conversation.id) not in [c["id"] for c in resp.data]


def test_teacher_cannot_read_a_school_student_conversations_messages(teacher, school_student_conversation, student):
    Message.objects.create(
        conversation=school_student_conversation, sender=student.user, sender_role="student",
        content="my medical certificate expires soon",
    )
    resp = _jwt_client(teacher.user).get(f"/api/chat/conversations/{school_student_conversation.id}/messages/")
    assert resp.status_code == 404


def test_teacher_cannot_reply_into_a_school_student_conversation(teacher, school_student_conversation):
    resp = _jwt_client(teacher.user).post(
        f"/api/chat/conversations/{school_student_conversation.id}/messages/", {"content": "intruding"}, format="json",
    )
    assert resp.status_code == 404


def test_teacher_cannot_resolve_a_school_student_conversation(teacher, school_student_conversation):
    resp = _jwt_client(teacher.user).patch(
        f"/api/chat/conversations/{school_student_conversation.id}/", {"status": "resolved"}, format="json",
    )
    assert resp.status_code == 404


def test_teacher_cannot_delete_a_school_student_conversation(teacher, school_student_conversation):
    resp = _jwt_client(teacher.user).delete(f"/api/chat/conversations/{school_student_conversation.id}/")
    assert resp.status_code == 404
    assert Conversation.objects.filter(pk=school_student_conversation.id).exists()


def test_teacher_cannot_see_an_hq_school_conversation(teacher, hq_school_conversation):
    resp = _jwt_client(teacher.user).get("/api/chat/conversations/")
    assert str(hq_school_conversation.id) not in [c["id"] for c in resp.data]


def test_teacher_cannot_see_another_teachers_thread(teacher, other_teacher_thread):
    resp = _jwt_client(teacher.user).get("/api/chat/conversations/")
    assert str(other_teacher_thread.id) not in [c["id"] for c in resp.data]


def test_teacher_unread_count_excludes_conversations_she_cannot_see(teacher, school_student_conversation, student):
    Message.objects.create(
        conversation=school_student_conversation, sender=student.user, sender_role="student", content="hi",
    )
    resp = _jwt_client(teacher.user).get("/api/chat/unread/")
    assert resp.status_code == 200
    assert resp.data["total"] == 0
    assert str(school_student_conversation.id) not in resp.data["by_conversation"]


def test_teacher_still_sees_her_own_school_teacher_thread(teacher, school):
    own = Conversation.objects.create(type=Conversation.Type.SCHOOL_TEACHER, school=school, teacher=teacher)
    resp = _jwt_client(teacher.user).get("/api/chat/conversations/")
    assert str(own.id) in [c["id"] for c in resp.data]


def test_teacher_still_sees_her_own_teacher_support_thread(teacher):
    own = Conversation.objects.create(type=Conversation.Type.TEACHER_SUPPORT, teacher=teacher)
    resp = _jwt_client(teacher.user).get("/api/chat/conversations/")
    assert str(own.id) in [c["id"] for c in resp.data]


# --- Control: a school-role user still sees every conversation of her school

def test_school_role_still_sees_every_conversation_of_its_school(school, school_student_conversation, hq_school_conversation):
    admin = User.objects.create(email=f"adm-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school)
    resp = _jwt_client(admin).get("/api/chat/conversations/")
    ids = [c["id"] for c in resp.data]
    assert str(school_student_conversation.id) in ids
    assert str(hq_school_conversation.id) in ids


# --- R2-H2 cross-reference: narrow HQ roles lose god-mode over school chats -

def test_narrow_hq_role_cannot_see_a_school_student_conversation(school_student_conversation):
    client = _hq_client("support")  # permissions seed: ["dashboard", "inbox"]
    resp = client.get(f"/api/chat/conversations/{school_student_conversation.id}/messages/")
    assert resp.status_code == 404


def test_narrow_hq_role_cannot_post_into_a_school_student_conversation(school_student_conversation):
    client = _hq_client("tech_support")
    resp = client.post(
        f"/api/chat/conversations/{school_student_conversation.id}/messages/", {"content": "intruding"}, format="json",
    )
    assert resp.status_code == 404


def test_narrow_hq_role_still_sees_its_own_inbox(hq_school_conversation):
    """`support`/`tech_support` hold the "inbox" permission -- they keep
    HQ<->School (their own inbox) visibility, just not cross-tenant chats."""
    client = _hq_client("support")
    resp = client.get("/api/chat/conversations/")
    assert str(hq_school_conversation.id) in [c["id"] for c in resp.data]


def test_broad_hq_role_keeps_full_chat_visibility(school_student_conversation):
    """owner/super_admin (or `schools_create_edit`, e.g. operations) is
    unaffected -- genuine HQ oversight still works."""
    client = _hq_client("owner")
    resp = client.get(f"/api/chat/conversations/{school_student_conversation.id}/messages/")
    assert resp.status_code == 200
