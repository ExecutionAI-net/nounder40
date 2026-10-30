"""A product can be hidden from the students' storefront and still be sold
in person (ShopProduct.online, Carlo 30/10/2026)."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from commerce.models import ShopProduct, ShopProductVariant
from schools.models import School
from students.models import Student

pytestmark = pytest.mark.django_db


@pytest.fixture
def hidden_product():
    return ShopProduct.objects.create(name="Solo in sede", price=30, category="other", online=False)


@pytest.fixture
def shown_product():
    return ShopProduct.objects.create(name="In vetrina", price=30, category="other")


@pytest.fixture
def student_api():
    school = School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    Student.objects.create(user=user, name="Stu", school=school)
    api = APIClient()
    api.force_authenticate(user=user)
    return api


def test_storefront_lists_only_online_products(hidden_product, shown_product):
    names = {p["name"] for p in APIClient().get("/api/student/shop/").json()}
    assert names == {"In vetrina"}
    assert APIClient().get(f"/api/student/shop/{hidden_product.id}/").status_code == 404
    assert APIClient().get(f"/api/student/shop/{shown_product.id}/").status_code == 200


def test_checkout_refuses_a_hidden_product(student_api, hidden_product):
    r = student_api.post("/api/student/shop/checkout/", {"items": [{"product_id": str(hidden_product.id), "qty": 1}]}, format="json")
    assert r.status_code == 400 and r.json()["error"] == "not_online"


def test_hq_toggles_the_flag_and_still_sells_in_person(hidden_product):
    user = get_user_model().objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ)
    hq = APIClient()
    hq.force_authenticate(user=user)
    variant = ShopProductVariant.objects.create(product=hidden_product, size="", color="", stock=3)

    # Hidden from students, sold at the desk
    r = hq.post("/api/hq/shop-sales/", {"items": [{"product_id": str(hidden_product.id), "variant_id": str(variant.id), "qty": 1}]}, format="json")
    assert r.status_code == 201, r.json()

    r = hq.patch(f"/api/hq/shop/{hidden_product.id}/", {"online": True}, format="json")
    assert r.status_code == 200 and r.json()["online"] is True
    assert APIClient().get(f"/api/student/shop/{hidden_product.id}/").status_code == 200
