"""The special event's shareable link (SPECIAL_EVENTS.md, Carlo 25/09/2026):
`Course.slug`, chosen by the school and unique across the network, resolved
publicly at /api/student/events/<slug>/ for /student/book?event=<slug>.
"""
import uuid

import pytest
from rest_framework.test import APIClient

from catalog.models import Course
from schools.models import School

from .test_special_events_api import _approved_event, _hq_client, _payload, _school_client

pytestmark = pytest.mark.django_db


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True)


@pytest.fixture
def owner_client(school):
    return _school_client(school, "owner")


def test_a_new_event_gets_the_suggested_slug_and_a_twin_is_numbered(school, owner_client):
    first = owner_client.post("/api/school/events/", _payload(submit=False), format="json").json()
    assert first["slug"] == f"{school.slug}-masterclass-giselle"
    second = owner_client.post("/api/school/events/", _payload(submit=False), format="json").json()
    assert second["slug"] == f"{school.slug}-masterclass-giselle-2"


def test_a_custom_slug_is_normalised_and_must_be_free(school, owner_client):
    a = owner_client.post("/api/school/events/", _payload(slug="  Stage Punte — Ottobre! ", submit=False), format="json").json()
    assert a["slug"] == "stage-punte-ottobre"
    r = owner_client.post("/api/school/events/", _payload(slug="stage-punte-ottobre", submit=False), format="json")
    assert r.status_code == 400 and r.json()["error"] == "slug_taken"
    # The event keeps its own slug on edit; another event's is refused
    assert owner_client.patch(f"/api/school/events/{a['id']}/", {"slug": "stage-punte-ottobre"}, format="json").status_code == 200
    b = owner_client.post("/api/school/events/", _payload(slug="gala", submit=False), format="json").json()
    r = owner_client.patch(f"/api/school/events/{b['id']}/", {"slug": "stage-punte-ottobre"}, format="json")
    assert r.status_code == 400 and r.json()["error"] == "slug_taken"
    assert Course.objects.get(pk=b["id"]).slug == "gala"
    # Clearing the field = back to the suggestion
    r = owner_client.patch(f"/api/school/events/{a['id']}/", {"slug": ""}, format="json")
    assert r.status_code == 200 and r.json()["slug"] == f"{school.slug}-masterclass-giselle"


def test_the_live_availability_check(school, owner_client):
    a = owner_client.post("/api/school/events/", _payload(slug="open-day", submit=False), format="json").json()
    assert owner_client.get("/api/school/events/slug-available/?slug=Open%20Day").json() == {"slug": "open-day", "available": False}
    assert owner_client.get(f"/api/school/events/slug-available/?slug=open-day&exclude={a['id']}").json()["available"] is True
    assert owner_client.get("/api/school/events/slug-available/?slug=open-day-2").json()["available"] is True
    assert owner_client.get("/api/school/events/slug-available/?slug=").json()["available"] is False
    assert owner_client.get("/api/school/events/slug-available/?slug=x&exclude=nope").status_code == 400


def test_changing_the_slug_after_approval_does_not_flag_hq(school, owner_client):
    event = _approved_event(owner_client, slug="giselle")
    assert event["slug"] == "giselle" and event["changed_at"] is None
    r = owner_client.patch(f"/api/school/events/{event['id']}/", {"slug": "giselle-2026"}, format="json")
    assert r.status_code == 200 and r.json()["slug"] == "giselle-2026"
    # Not a student-visible change (decision with Carlo, 25/09/2026)
    assert r.json()["changed_at"] is None
    # ...while a title change still is
    assert owner_client.patch(f"/api/school/events/{event['id']}/", {"name": "Giselle II"}, format="json").json()["changed_at"]


def test_the_public_link_resolves_only_a_live_event(school, owner_client):
    anon = APIClient()
    pending = owner_client.post("/api/school/events/", _payload(slug="gala"), format="json").json()
    assert anon.get("/api/student/events/gala/").status_code == 404
    assert anon.get("/api/student/events/nope/").status_code == 404

    hq = _hq_client("owner")
    approved = hq.post(f"/api/hq/events/{pending['id']}/approve/", {}, format="json").json()
    r = anon.get("/api/student/events/gala/")
    assert r.status_code == 200, r.content
    body = r.json()
    assert body["id"] == approved["lesson_id"] and body["school"] == str(school.id)
    assert body["courses"]["is_special_event"] is True and body["courses"]["name"] == "Masterclass Giselle"

    # Suspended: hidden again; re-approved: back; cancelled: gone for good
    hq.post(f"/api/hq/events/{pending['id']}/suspend/", {"note": "manca la sede"}, format="json")
    assert anon.get("/api/student/events/gala/").status_code == 404
    hq.post(f"/api/hq/events/{pending['id']}/approve/", {}, format="json")
    assert anon.get("/api/student/events/gala/").status_code == 200
    owner_client.delete(f"/api/school/events/{pending['id']}/")
    assert anon.get("/api/student/events/gala/").status_code == 404
