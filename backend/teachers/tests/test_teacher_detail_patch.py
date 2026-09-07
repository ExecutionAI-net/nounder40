"""PATCH /api/school/teachers/{id}/ — an email that collides with another
User must come back as a clean 400, not an unhandled IntegrityError → 500
(the User table has a unique constraint on email; HQMemberViewSet.partial_update
and SchoolTeamView.patch already guard the same collision before saving)."""
import uuid

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from django.contrib.auth import get_user_model
from schools.models import School, SchoolMembership, SchoolRole
from teachers.models import Teacher, TeacherSchool

pytestmark = pytest.mark.django_db


def _client(user):
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


def _user(**kwargs):
    kwargs.setdefault("email", f"u-{uuid.uuid4().hex[:8]}@example.com")
    return get_user_model().objects.create(**kwargs)


@pytest.fixture
def school():
    return School.objects.create(
        name="Scuola", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True
    )


@pytest.fixture
def admin_user(school):
    # A dedicated, uniquely-keyed role rather than "admin": the section-guard
    # middleware caches the whole role→permissions matrix for 30s
    # (core/section_guard.py's `_matrix_cache`), and other test modules in
    # the same pytest process create/update a role keyed "admin" with a
    # permissions list that does not include "teachers" — reusing that key
    # here could silently hit a stale cached entry depending on test order.
    role_key = f"admin-teachers-test-{uuid.uuid4().hex[:8]}"
    SchoolRole.objects.create(
        key=role_key, label="Admin (teachers test)", builtin=True,
        permissions=["settings", "students", "team", "locations", "teachers"],
    )
    user = _user(role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school)
    SchoolMembership.objects.create(profile=user, school=school, sub_role=role_key)
    return user


def _teacher_in_school(school, email):
    # The collision this guards against is on the User table (the login
    # identity, unique on email) — give the teacher's linked User the same
    # email, not just the Teacher row, or the uniqueness check has nothing
    # to collide with.
    user = _user(email=email, role=Role.TEACHER, roles=[Role.TEACHER])
    teacher = Teacher.objects.create(user=user, name="Old Name", email=email)
    TeacherSchool.objects.create(teacher=teacher, school=school)
    return teacher


def test_patch_rejects_email_already_used_by_another_user(admin_user, school):
    _teacher_in_school(school, "taken@example.com")
    teacher = _teacher_in_school(school, "teacher@example.com")

    res = _client(admin_user).patch(
        f"/api/school/teachers/{teacher.id}/", {"email": "TAKEN@example.com"}, format="json"
    )

    assert res.status_code == 400
    assert res.json() == {"error": "email_taken"}
    teacher.refresh_from_db()
    assert teacher.email == "teacher@example.com"


def test_patch_allows_a_free_email(admin_user, school):
    teacher = _teacher_in_school(school, "teacher@example.com")

    res = _client(admin_user).patch(
        f"/api/school/teachers/{teacher.id}/", {"email": "new@example.com"}, format="json"
    )

    assert res.status_code == 200
    teacher.refresh_from_db()
    teacher.user.refresh_from_db()
    assert teacher.email == "new@example.com"
    assert teacher.user.email == "new@example.com"


def test_patch_allows_keeping_the_same_email(admin_user, school):
    teacher = _teacher_in_school(school, "teacher@example.com")

    res = _client(admin_user).patch(
        f"/api/school/teachers/{teacher.id}/", {"email": "teacher@example.com", "phone": "123"}, format="json"
    )

    assert res.status_code == 200
