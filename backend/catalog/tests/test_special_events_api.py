"""Special events (SPECIAL_EVENTS.md) — the school and HQ endpoints, and the
two permission matrices around them: a school role without the "events"
section and an HQ role without the "events" key are both shut out.
"""
import uuid
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import HQMember, Role
from catalog.models import Course, Lesson
from schools.models import School, SchoolMembership, SchoolRole

pytestmark = pytest.mark.django_db


def _jwt_client(user):
    # The section guards authenticate from the JWT themselves
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True)


def _school_client(school, sub_role):
    user = get_user_model().objects.create(
        email=f"{sub_role}-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school,
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role=sub_role)
    return _jwt_client(user)


@pytest.fixture
def owner_client(school):
    return _school_client(school, "owner")


@pytest.fixture
def staff_client(school):
    # The seeded staff role has no "events" section (schools/migrations/0010)
    SchoolRole.objects.update_or_create(
        key="staff", defaults={"label": "Staff", "builtin": True, "permissions": ["dashboard", "courses", "lessons"]}
    )
    from core.section_guard import _matrix_cache

    _matrix_cache["expires"] = 0.0  # the guard caches the matrix for 30s
    return _school_client(school, "staff")


def _hq_client(sub_role):
    user = get_user_model().objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role=sub_role
    )
    HQMember.objects.create(user=user, email=user.email, name="QA", sub_role=sub_role)
    return _jwt_client(user)


def _payload(**extra):
    day = timezone.localdate() + timedelta(days=12)
    data = {
        "name": "Masterclass Giselle", "description": "Con ospite", "date": day.isoformat(),
        "start_time": "17:00", "duration_minutes": 120, "max_capacity": 20, "price": "35",
        "submit": True,
    }
    data.update(extra)
    return data


def test_school_creates_and_submits_hq_approves_and_the_lesson_appears(school, owner_client):
    r = owner_client.post("/api/school/events/", _payload(), format="json")
    assert r.status_code == 201, r.content
    body = r.json()
    assert body["status"] == "pending" and body["lesson_id"] is None
    assert body["price"] == "35.00" and body["is_free"] is False
    event_id = body["id"]

    # The school's course list does not show it; its own list does
    assert event_id not in {c["id"] for c in owner_client.get("/api/school/courses-overview/").json()}
    assert event_id in {e["id"] for e in owner_client.get("/api/school/events/").json()}
    # The ticket package is not in the school's package manager
    assert all(p.get("event") is None for p in owner_client.get("/api/school/packages/").json())

    hq = _hq_client("owner")
    queue = hq.get("/api/hq/events/?status=pending").json()
    assert queue["counts"]["pending"] == 1
    assert queue["results"][0]["id"] == event_id and queue["results"][0]["school"]["name"] == "S"

    r = hq.post(f"/api/hq/events/{event_id}/approve/", {}, format="json")
    assert r.status_code == 200, r.content
    assert r.json()["status"] == "approved" and r.json()["lesson_id"]
    lesson = Lesson.objects.get(course_id=event_id)
    assert lesson.lesson_type_id is None and lesson.end_time.strftime("%H:%M") == "19:00"

    # An edit after approval flags the event in HQ's "Modified" list
    r = owner_client.patch(f"/api/school/events/{event_id}/", {"name": "Masterclass Giselle II"}, format="json")
    assert r.status_code == 200 and r.json()["changed_at"]
    assert hq.get("/api/hq/events/?status=modified").json()["counts"]["modified"] == 1
    assert hq.post(f"/api/hq/events/{event_id}/reviewed/", {}, format="json").json()["changed_at"] is None


def test_reject_with_note_then_resubmit(school, owner_client):
    event_id = owner_client.post("/api/school/events/", _payload(price=""), format="json").json()["id"]
    hq = _hq_client("super_admin")
    r = hq.post(f"/api/hq/events/{event_id}/reject/", {"note": "Manca la descrizione"}, format="json")
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    assert r.json()["review_note"] == "Manca la descrizione"

    owner_client.patch(f"/api/school/events/{event_id}/", {"description": "Serata di repertorio"}, format="json")
    r = owner_client.post(f"/api/school/events/{event_id}/submit/", {}, format="json")
    assert r.status_code == 200 and r.json()["status"] == "pending" and r.json()["review_note"] == ""
    # approve requires pending/suspended: a second reject on a pending one is fine, on approved it is not
    hq.post(f"/api/hq/events/{event_id}/approve/", {}, format="json")
    assert hq.post(f"/api/hq/events/{event_id}/reject/", {}, format="json").status_code == 400


def test_validation_and_delete_of_a_draft(school, owner_client):
    r = owner_client.post("/api/school/events/", _payload(name="  ", submit=False), format="json")
    assert r.status_code == 400 and r.json()["error"] == "name_required"
    r = owner_client.post("/api/school/events/", _payload(price="-3", submit=False), format="json")
    assert r.status_code == 400 and r.json()["error"] == "invalid_price"
    r = owner_client.post("/api/school/events/", _payload(date="2020-01-01"), format="json")
    assert r.status_code == 400 and r.json()["error"] == "date_in_past"

    draft = owner_client.post("/api/school/events/", _payload(submit=False), format="json").json()
    assert draft["status"] == "draft"
    r = owner_client.delete(f"/api/school/events/{draft['id']}/")
    assert r.status_code == 200 and r.json() == {"deleted": True}
    assert not Course.objects.filter(pk=draft["id"]).exists()


def test_school_role_without_the_section_is_shut_out(staff_client):
    assert staff_client.get("/api/school/events/").status_code == 403
    assert staff_client.post("/api/school/events/", _payload(), format="json").status_code == 403


def test_hq_role_without_the_key_is_shut_out(school, owner_client):
    event_id = owner_client.post("/api/school/events/", _payload(), format="json").json()["id"]
    support = _hq_client("support")  # seed: dashboard + inbox only
    assert support.get("/api/hq/events/").status_code == 403
    assert support.post(f"/api/hq/events/{event_id}/approve/", {}, format="json").status_code == 403
    # a student token gets nothing either (the view's own check)
    student = get_user_model().objects.create(email=f"st-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT])
    assert _jwt_client(student).get("/api/hq/events/").status_code == 403
    assert Course.objects.get(pk=event_id).event_status == "pending"


def _approved_event(owner_client, **extra):
    event = owner_client.post("/api/school/events/", _payload(**extra), format="json").json()
    hq = _hq_client("owner")
    return hq.post(f"/api/hq/events/{event['id']}/approve/", {}, format="json").json()


def test_class_endpoints_hand_an_event_lesson_to_the_event_workflow(school, owner_client):
    event = _approved_event(owner_client)
    lesson_id = event["lesson_id"]
    detail = owner_client.get(f"/api/school/classes/{lesson_id}/").json()
    assert detail["courses"]["is_special_event"] is True
    r = owner_client.patch(f"/api/school/classes/{lesson_id}/", {"date": "2030-01-01"}, format="json")
    assert r.status_code == 409 and r.json()["error"] == "special_event_use_events_page"
    r = owner_client.delete(f"/api/school/classes/{lesson_id}/")
    assert r.status_code == 200 and r.json()["cancelled"] is True
    assert Course.objects.get(pk=event["id"]).event_status == "cancelled"
    assert Lesson.objects.get(pk=lesson_id).status == "cancelled"


def test_event_image_uploads_under_the_events_section(school, owner_client):
    import io

    from django.core.files.uploadedfile import SimpleUploadedFile
    from PIL import Image

    event = owner_client.post("/api/school/events/", _payload(submit=False), format="json").json()
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (10, 20, 30)).save(buf, format="PNG")
    png = SimpleUploadedFile("e.png", buf.getvalue(), content_type="image/png")
    r = owner_client.post(f"/api/school/events/{event['id']}/image/", {"file": png}, format="multipart")
    assert r.status_code == 200 and r.json()["image_url"], r.content
    assert owner_client.get(f"/api/school/events/{event['id']}/").json()["image_url"]


def test_ticket_checkout_is_refused_while_the_event_is_not_bookable(school, owner_client):
    from unittest.mock import patch as mock_patch

    school.stripe_account_id = "acct_x"
    school.stripe_onboarding_complete = True
    school.save(update_fields=["stripe_account_id", "stripe_onboarding_complete"])
    event = _approved_event(owner_client, price="30")
    ticket_id = str(Course.objects.get(pk=event["id"]).event_package.id)
    user = get_user_model().objects.create(email=f"st-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT])
    from students.models import Student

    Student.objects.create(user=user, name="Stu", school=school)
    api = _jwt_client(user)
    hq = _hq_client("owner")
    hq.post(f"/api/hq/events/{event['id']}/suspend/", {"note": "x"}, format="json")
    r = api.post("/api/stripe/checkout/", {"type": "package", "product_id": ticket_id}, format="json")
    assert r.status_code == 409, r.content
    assert r.json()["error"] in ("event_not_bookable", "lesson_not_bookable")

    hq.post(f"/api/hq/events/{event['id']}/approve/", {}, format="json")
    with mock_patch("commerce.stripe_service.stripe.checkout.Session.create") as create:
        create.return_value = type("S", (), {"id": "cs_test", "url": "https://stripe.test/cs"})()
        r = api.post("/api/stripe/checkout/", {"type": "package", "product_id": ticket_id}, format="json")
    assert r.status_code == 200, r.content
    assert create.call_args.kwargs["metadata"]["lesson_id"] == event["lesson_id"]
