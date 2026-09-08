"""PATCH /api/teacher/profile/ — the teacher's own self-service profile edit.

Regression for H-4/H2 (QA_FULL_REGRESSION_SUMMARY.md / QA_FULL_REGRESSION_TEACHER.md):
the endpoint used to write ``email`` straight to ``Teacher.email`` (display)
without ever touching ``User.email`` (the actual login credential) and
without any uniqueness check — so a teacher who changed their profile email
would get a "saved" response while silently losing the ability to log in
with the new address (the old one kept working). This mirrors the
already-correct School-side behaviour covered by
teachers/tests/test_teacher_detail_patch.py.
"""
import uuid

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from django.contrib.auth import authenticate, get_user_model
from teachers.models import Teacher

pytestmark = pytest.mark.django_db


def _client(user):
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


def _user(**kwargs):
    kwargs.setdefault("email", f"u-{uuid.uuid4().hex[:8]}@example.com")
    return get_user_model().objects.create(**kwargs)


def _teacher(email, password="Str0ngPassw0rd!"):
    user = _user(email=email, role=Role.TEACHER, roles=[Role.TEACHER])
    user.set_password(password)
    user.save(update_fields=["password"])
    teacher = Teacher.objects.create(user=user, name="Old Name", email=email)
    return teacher, user, password


def test_patch_rejects_email_already_used_by_another_user():
    _teacher("taken@example.com")
    teacher, user, _ = _teacher("teacher@example.com")

    res = _client(user).patch("/api/teacher/profile/", {"email": "TAKEN@example.com"}, format="json")

    assert res.status_code == 400
    assert res.json() == {"error": "email_taken"}
    teacher.refresh_from_db()
    user.refresh_from_db()
    assert teacher.email == "teacher@example.com"
    assert user.email == "teacher@example.com"


def test_patch_updates_teacher_and_user_email_in_lockstep():
    teacher, user, password = _teacher("teacher@example.com")

    res = _client(user).patch("/api/teacher/profile/", {"email": "new@example.com"}, format="json")

    assert res.status_code == 200
    teacher.refresh_from_db()
    user.refresh_from_db()
    assert teacher.email == "new@example.com"
    assert user.email == "new@example.com"

    # The old login credential is genuinely gone: it no longer resolves to
    # any account, so authenticating with it must fail...
    assert authenticate(email="teacher@example.com", password=password) is None
    # ...while the new one works.
    authenticated = authenticate(email="new@example.com", password=password)
    assert authenticated is not None
    assert authenticated.pk == user.pk


def test_patch_allows_keeping_the_same_email():
    teacher, user, _ = _teacher("teacher@example.com")

    res = _client(user).patch(
        "/api/teacher/profile/", {"email": "teacher@example.com", "phone": "123"}, format="json"
    )

    assert res.status_code == 200
    teacher.refresh_from_db()
    assert teacher.phone == "123"
    assert teacher.email == "teacher@example.com"


def test_patch_without_email_field_leaves_login_credential_untouched():
    teacher, user, _ = _teacher("teacher@example.com")

    res = _client(user).patch("/api/teacher/profile/", {"phone": "999"}, format="json")

    assert res.status_code == 200
    teacher.refresh_from_db()
    user.refresh_from_db()
    assert teacher.phone == "999"
    assert teacher.email == "teacher@example.com"
    assert user.email == "teacher@example.com"


# QA TCH-R2-11: the frontend input is `required`, but nothing on the API
# enforced it — PATCH {"first_name": ""} used to return 200 and silently
# re-derive Teacher.name from last_name alone.
@pytest.mark.parametrize("field", ["first_name", "last_name"])
@pytest.mark.parametrize("value", ["", "   "])
def test_patch_rejects_blank_name_field(field, value):
    teacher, user, _ = _teacher("teacher@example.com")
    teacher.first_name, teacher.last_name = "Old", "Name"
    teacher.save(update_fields=["first_name", "last_name"])

    res = _client(user).patch("/api/teacher/profile/", {field: value}, format="json")

    assert res.status_code == 400
    assert field in res.json()
    teacher.refresh_from_db()
    assert teacher.first_name == "Old"
    assert teacher.last_name == "Name"
    assert teacher.name == "Old Name"


def test_patch_accepts_nonblank_name_fields():
    teacher, user, _ = _teacher("teacher@example.com")

    res = _client(user).patch(
        "/api/teacher/profile/", {"first_name": "Anna", "last_name": "Bianchi"}, format="json"
    )

    assert res.status_code == 200
    teacher.refresh_from_db()
    assert teacher.first_name == "Anna"
    assert teacher.last_name == "Bianchi"
    assert teacher.name == "Anna Bianchi"


def test_patch_rejects_bio_over_max_length():
    teacher, user, _ = _teacher("teacher@example.com")

    res = _client(user).patch("/api/teacher/profile/", {"bio": "x" * 5001}, format="json")

    assert res.status_code == 400
    assert "bio" in res.json()
    teacher.refresh_from_db()
    assert teacher.bio == ""


def test_patch_accepts_bio_at_max_length():
    teacher, user, _ = _teacher("teacher@example.com")

    res = _client(user).patch("/api/teacher/profile/", {"bio": "x" * 5000}, format="json")

    assert res.status_code == 200
    teacher.refresh_from_db()
    assert teacher.bio == "x" * 5000
