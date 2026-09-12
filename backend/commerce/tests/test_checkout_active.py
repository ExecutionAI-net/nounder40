"""Checkout rejects deactivated catalog items: hiding a package from the
storefront must also make it unbuyable, otherwise an old checkout link (or a
guessed id) still sells it.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from catalog.models import Package, SubscriptionCatalog
from schools.models import School
from students.models import Student

pytestmark = pytest.mark.django_db


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def client(school):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    Student.objects.create(user=user, name="Stu", school=school)
    api = APIClient()
    api.force_authenticate(user=user)
    return api


def test_inactive_package_cannot_be_checked_out(client, school):
    pkg = Package.objects.create(school=school, credits=8, price=50, active=False)
    res = client.post("/api/stripe/checkout/", {"kind": "package", "item_id": str(pkg.id)}, format="json")
    assert res.status_code == 404
    assert res.json()["error"] == "item_not_found"


def test_inactive_subscription_cannot_be_checked_out(client, school):
    sub = SubscriptionCatalog.objects.create(school=school, price=50, active=False)
    res = client.post("/api/stripe/checkout/", {"kind": "subscription", "item_id": str(sub.id)}, format="json")
    assert res.status_code == 404
    assert res.json()["error"] == "item_not_found"


# --- R4-M3 / ST-R4-02: malformed ids and HQ-owned items answer 4xx, not 500 --


def test_non_uuid_item_id_is_a_400(client):
    res = client.post("/api/stripe/checkout/", {"kind": "package", "item_id": "not-a-uuid"}, format="json")
    assert res.status_code == 400, res.content


def test_non_uuid_school_id_is_a_400(client, school):
    pkg = Package.objects.create(school=school, credits=8, price=50, active=True)
    res = client.post(
        "/api/stripe/checkout/", {"kind": "package", "item_id": str(pkg.id), "school_id": "garbage"}, format="json"
    )
    assert res.status_code == 400, res.content


def test_garbage_subscription_id_is_a_400(client):
    res = client.post("/api/stripe/checkout/", {"kind": "subscription", "item_id": "garbage"}, format="json")
    assert res.status_code == 400, res.content


def test_non_uuid_lesson_id_is_a_400(client, school):
    pkg = Package.objects.create(school=school, credits=1, price=8, active=True, is_drop_in=True)
    res = client.post(
        "/api/stripe/checkout/", {"kind": "package", "item_id": str(pkg.id), "lesson_id": "x"}, format="json"
    )
    assert res.status_code == 400, res.content


def test_an_hq_owned_package_is_refused_cleanly(client):
    """`school=null` used to become `School.objects.filter(pk="None")` -> 500."""
    pkg = Package.objects.create(school=None, credits=12, price=99, active=True)
    res = client.post("/api/stripe/checkout/", {"kind": "package", "item_id": str(pkg.id)}, format="json")
    assert res.status_code == 400, res.content
    assert res.json()["error"] == "item_not_purchasable"
