"""R2-L5a: `/api/schema/` and `/api/docs/` answered 200 to anonymous callers,
publishing the entire API surface — every route, parameter and serializer
shape — to anyone who could reach the host.

They are a developer tool, not a product surface, so they are now gated to HQ
(and Django staff/superusers, the account a developer already uses on
`/admin/`; that also keeps the Swagger page openable in a browser through the
admin session, since the JWT lives in localStorage and a plain page load
carries no Authorization header). These tests pin that, plus the two things
the gate must NOT touch: `/api/health/` and ordinary endpoints.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role

pytestmark = pytest.mark.django_db


def _client(user=None):
    api = APIClient()
    if user is not None:
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


def _user(role, **extra):
    return get_user_model().objects.create(
        email=f"{role}-{uuid.uuid4().hex[:8]}@example.com", role=role, roles=[role], **extra
    )


@pytest.mark.parametrize("path", ["/api/schema/", "/api/docs/"])
def test_anonymous_cannot_read_schema_or_docs(path):
    assert _client().get(path).status_code == 401


@pytest.mark.parametrize("path", ["/api/schema/", "/api/docs/"])
def test_student_cannot_read_schema_or_docs(path):
    assert _client(_user(Role.STUDENT)).get(path).status_code == 403


@pytest.mark.parametrize("path", ["/api/schema/", "/api/docs/"])
def test_school_member_cannot_read_schema_or_docs(path):
    assert _client(_user(Role.SCHOOL)).get(path).status_code == 403


@pytest.mark.parametrize("path", ["/api/schema/", "/api/docs/"])
def test_hq_can_read_schema_and_docs(path):
    assert _client(_user(Role.HQ)).get(path).status_code == 200


@pytest.mark.parametrize("path", ["/api/schema/", "/api/docs/"])
def test_django_staff_can_read_schema_and_docs_through_the_admin_session(path):
    """The browser flow: no Authorization header, only the /admin/ session."""
    staff = _user(Role.STUDENT, is_staff=True)
    api = APIClient()
    api.force_login(staff)
    assert api.get(path).status_code == 200


def test_health_check_stays_anonymous():
    """The gate must not creep onto the liveness probe."""
    resp = _client().get("/api/health/")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_ordinary_endpoints_are_unaffected():
    student = _user(Role.STUDENT)
    assert _client(student).get("/api/auth/me/").status_code == 200
    assert _client().get("/api/schools/public/").status_code == 200
