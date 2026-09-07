"""Malformed input must answer 400, never 500 (QA R2-M1 / X-R2-04).

The endpoints covered here are the anonymous ones — the ones anybody could
use to make the app 500 — plus the shared helpers in `core.params` that the
authenticated views now go through.
"""
import uuid

import pytest
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from core.params import ensure_object_body, parse_date, parse_int, parse_month, parse_uuid, parse_uuid_list
from schools.models import School

pytestmark = pytest.mark.django_db


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


# ── helpers ──────────────────────────────────────────────────────────────

def test_parsers_accept_valid_and_blank_values():
    value = uuid.uuid4()
    assert parse_uuid(str(value), "school") == value
    assert parse_uuid("", "school") is None
    assert parse_uuid(None, "school") is None
    assert parse_uuid_list(f"{value},{value}", "school") == [value, value]
    assert parse_uuid_list("", "school") == []
    assert parse_int("7", "n") == 7
    assert parse_int("", "n", default=0) == 0
    assert parse_date("2026-09-08", "date").isoformat() == "2026-09-08"
    assert parse_month("2026-09", "month") == "2026-09"
    assert ensure_object_body({"a": 1}) == {"a": 1}


@pytest.mark.parametrize(
    "call",
    [
        lambda: parse_uuid("x", "school"),
        lambda: parse_uuid_list("x", "school"),
        lambda: parse_int("abc", "students"),
        lambda: parse_date("2026-13-45", "date"),
        lambda: parse_month("2026-13", "month"),
        lambda: parse_month("x", "month"),
        lambda: ensure_object_body("hello"),
        lambda: ensure_object_body(["a"]),
    ],
)
def test_parsers_raise_drf_validation_error(call):
    with pytest.raises(ValidationError):
        call()


# ── anonymous endpoints ──────────────────────────────────────────────────

@pytest.mark.parametrize(
    "url",
    [
        "/api/student/lessons/?school_id=x",
        "/api/student/lessons/?lesson_type_id=x",
        "/api/student/lessons/?teacher_id=x",
        "/api/student/lessons/?date=2026-13-45",
        "/api/student/school-packages/?school_id=x",
    ],
)
def test_public_catalog_rejects_malformed_filters(api, url):
    assert api.get(url).status_code == 400


def test_public_catalog_accepts_valid_filters(api, school):
    assert api.get(f"/api/student/lessons/?school_id={school.id}").status_code == 200
    assert api.get("/api/student/lessons/?date=2026-09-08").status_code == 200
    assert api.get(f"/api/student/school-packages/?school_id={school.id}").status_code == 200


@pytest.mark.parametrize("param", ["type", "teacher", "location"])
def test_public_ical_rejects_malformed_filters(api, school, param):
    assert api.get(f"/api/calendar/{school.id}.ics?{param}=x").status_code == 400


def test_public_ical_serves_valid_request(api, school):
    res = api.get(f"/api/calendar/{school.id}.ics?type={uuid.uuid4()}")
    assert res.status_code == 200


@pytest.mark.parametrize("endpoint", ["complete-invite", "password-reset-confirm"])
def test_auth_endpoints_reject_malformed_uid(api, endpoint):
    """A uid that base64-decodes to something that isn't a UUID used to reach
    `User.objects.get(pk=...)` and 500."""
    res = api.post(
        f"/api/auth/{endpoint}/",
        {"uid": urlsafe_base64_encode(force_bytes("not-a-uuid")), "token": "t",
         "password": "Str0ng!Passw0rd", "new_password": "Str0ng!Passw0rd"},
        format="json",
    )
    assert res.status_code == 400
    assert res.json()["error"] == "invalid_link"
