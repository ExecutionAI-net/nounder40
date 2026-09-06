"""QA report (Orta): ConversationViewSet.perform_create had no branch for a
teacher initiating a `school_teacher` conversation -- it fell through to the
generic `school_id` branch, which saves `school_id` only, never `teacher`.
The conversation was then invisible to the very teacher who created it
(visible_conversations() filters school_teacher-adjacent access by
`teacher=teacher`, not by `school_id` alone for a teacher caller)."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from chat.models import Conversation
from schools.models import School
from teachers.models import Teacher, TeacherSchool

pytestmark = pytest.mark.django_db


def _teacher_client():
    school = School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")
    user = get_user_model().objects.create(
        email=f"t-{uuid.uuid4().hex[:8]}@example.com", role=Role.TEACHER, roles=[Role.TEACHER],
        active_school=school,
    )
    teacher = Teacher.objects.create(user=user, name="T", email=user.email)
    TeacherSchool.objects.create(teacher=teacher, school=school)
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api, teacher, school


def test_teacher_can_start_a_school_teacher_conversation():
    api, teacher, school = _teacher_client()
    resp = api.post("/api/chat/conversations/", {"type": "school_teacher"}, format="json")
    assert resp.status_code == 201, resp.content
    conv = Conversation.objects.get(pk=resp.data["id"])
    assert conv.teacher_id == teacher.id
    assert conv.school_id == school.id

    # And it's now actually visible to the teacher who just created it.
    list_resp = api.get("/api/chat/conversations/?type=school_teacher")
    assert str(conv.id) in [c["id"] for c in list_resp.data]


def test_teacher_can_start_a_teacher_support_conversation():
    api, teacher, _school = _teacher_client()
    resp = api.post("/api/chat/conversations/", {"type": "teacher_support"}, format="json")
    assert resp.status_code == 201, resp.content
    conv = Conversation.objects.get(pk=resp.data["id"])
    assert conv.teacher_id == teacher.id
    assert conv.school_id is None


def test_teacher_without_active_school_cannot_start_a_school_teacher_conversation():
    """No TeacherSchool link at all -- genuinely no school to message."""
    user = get_user_model().objects.create(
        email=f"t-{uuid.uuid4().hex[:8]}@example.com", role=Role.TEACHER, roles=[Role.TEACHER],
    )
    Teacher.objects.create(user=user, name="T", email=user.email)
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    resp = api.post("/api/chat/conversations/", {"type": "school_teacher"}, format="json")
    assert resp.status_code == 400


def test_teacher_with_unpopulated_active_school_falls_back_to_teacher_school():
    """Pins the exact QA seed shape: active_school_id blank (qa_platform.py
    never sets it for teachers), but TeacherSchool links to exactly one
    school -- unambiguous, so this must still succeed rather than 400
    "no_active_school"."""
    school = School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")
    user = get_user_model().objects.create(
        email=f"t-{uuid.uuid4().hex[:8]}@example.com", role=Role.TEACHER, roles=[Role.TEACHER],
    )
    teacher = Teacher.objects.create(user=user, name="T", email=user.email)
    TeacherSchool.objects.create(teacher=teacher, school=school, active=True)
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    resp = api.post("/api/chat/conversations/", {"type": "school_teacher"}, format="json")
    assert resp.status_code == 201, resp.content
    assert Conversation.objects.get(pk=resp.data["id"]).school_id == school.id


def test_teacher_at_multiple_schools_with_no_active_one_must_still_choose():
    school_a = School.objects.create(name="A", slug=f"a-{uuid.uuid4().hex[:8]}", email="a@example.com")
    school_b = School.objects.create(name="B", slug=f"b-{uuid.uuid4().hex[:8]}", email="b@example.com")
    user = get_user_model().objects.create(
        email=f"t-{uuid.uuid4().hex[:8]}@example.com", role=Role.TEACHER, roles=[Role.TEACHER],
    )
    teacher = Teacher.objects.create(user=user, name="T", email=user.email)
    TeacherSchool.objects.create(teacher=teacher, school=school_a, active=True)
    TeacherSchool.objects.create(teacher=teacher, school=school_b, active=True)
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    resp = api.post("/api/chat/conversations/", {"type": "school_teacher"}, format="json")
    assert resp.status_code == 400
