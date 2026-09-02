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
