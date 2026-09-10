"""SCH-R3-11: a URL a user types is a script sink the moment something
renders it as an href.

`PATCH /school/profile/ {"website": "javascript:alert(1)"}` was stored and
republished verbatim by the anonymous `/api/schools/public/`. The same check
was missing on `SchoolLocation.google_maps_url`, which is not latent: the
student booking pages render it as a bare `<a href>`.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from schools.models import School, SchoolLocation, SchoolMembership

pytestmark = pytest.mark.django_db
User = get_user_model()

DANGEROUS = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)  ",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "ftp://example.com/x",
]
SAFE = ["https://scuola.example", "http://scuola.example/pagina", "/pagina-interna", ""]


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def owner_client(school):
    user = User.objects.create(
        email=f"own-{uuid.uuid4().hex[:8]}@example.com", role="school", roles=["school"],
        active_school=school,
    )
    SchoolMembership.objects.create(school=school, profile=user, sub_role="owner")
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.mark.parametrize("value", DANGEROUS)
def test_a_dangerous_website_is_refused(owner_client, school, value):
    resp = owner_client.patch("/api/school/profile/", {"website": value}, format="json")
    assert resp.status_code == 400, resp.data
    assert "website" in resp.data
    school.refresh_from_db()
    assert school.website == ""


@pytest.mark.parametrize("value", SAFE)
def test_a_safe_website_is_stored(owner_client, school, value):
    assert owner_client.patch("/api/school/profile/", {"website": value}, format="json").status_code == 200
    school.refresh_from_db()
    assert school.website == value


def test_the_public_endpoint_can_no_longer_publish_a_script_url(owner_client, school):
    owner_client.patch("/api/school/profile/", {"website": "javascript:alert(1)"}, format="json")
    rows = APIClient().get("/api/schools/public/").json()
    assert all("javascript:" not in (r.get("website") or "").lower() for r in rows)


@pytest.mark.parametrize("value", DANGEROUS)
def test_a_dangerous_maps_url_is_refused(owner_client, school, value):
    resp = owner_client.post(
        "/api/school/locations/", {"name": "Sede", "address": "Via 1", "google_maps_url": value}, format="json",
    )
    assert resp.status_code == 400, resp.data
    assert "google_maps_url" in resp.data
    assert not SchoolLocation.objects.filter(school=school).exists()


def test_a_safe_maps_url_is_stored(owner_client, school):
    resp = owner_client.post(
        "/api/school/locations/",
        {"name": "Sede", "address": "Via 1", "google_maps_url": "https://maps.google.com/?q=Via+1"},
        format="json",
    )
    assert resp.status_code == 201, resp.data
    assert SchoolLocation.objects.get(school=school).google_maps_url == "https://maps.google.com/?q=Via+1"
