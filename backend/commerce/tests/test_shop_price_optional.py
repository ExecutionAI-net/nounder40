"""A shop product may have no list price (price 0, Carlo 30/10/2026): HQ
types the unit price on each manual sale, and the storefront does not sell
it online."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from commerce.models import ShopProduct, ShopProductVariant, ShopSale
from schools.models import School
from students.models import Student

pytestmark = pytest.mark.django_db


@pytest.fixture
def hq():
    user = get_user_model().objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ)
    api = APIClient()
    api.force_authenticate(user=user)
    return api


@pytest.fixture
def unpriced_variant():
    product = ShopProduct.objects.create(name="Lezione privata", price=0, category="lesson")
    return ShopProductVariant.objects.create(product=product, size="", color="", stock=100)


def _items(variant, **extra):
    return [{"product_id": str(variant.product_id), "variant_id": str(variant.id), "qty": 2, **extra}]


def test_manual_sale_takes_the_typed_unit_price(hq, unpriced_variant):
    r = hq.post("/api/hq/shop-sales/", {"items": _items(unpriced_variant, unit_price=25)}, format="json")
    assert r.status_code == 201, r.json()
    sale = ShopSale.objects.get(order_id=r.json()["order_id"])
    assert float(sale.unit_price) == 25.0 and float(sale.total) == 50.0


def test_manual_sale_without_a_price_is_refused(hq, unpriced_variant):
    r = hq.post("/api/hq/shop-sales/", {"items": _items(unpriced_variant)}, format="json")
    assert r.status_code == 400 and r.json()["error"] == "unit_price_required"
    r = hq.post("/api/hq/shop-sales/", {"items": _items(unpriced_variant, unit_price="abc")}, format="json")
    assert r.status_code == 400 and r.json()["error"] == "unit_price_required"


def test_a_priced_product_ignores_a_typed_unit_price(hq):
    product = ShopProduct.objects.create(name="Body", price=50, category="clothing")
    variant = ShopProductVariant.objects.create(product=product, size="M", color="nero", stock=5)
    r = hq.post("/api/hq/shop-sales/", {"items": _items(variant, unit_price=1)}, format="json")
    assert r.status_code == 201
    assert float(ShopSale.objects.get(order_id=r.json()["order_id"]).unit_price) == 50.0


def test_storefront_refuses_an_unpriced_product(unpriced_variant):
    school = School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    Student.objects.create(user=user, name="Stu", school=school)
    api = APIClient()
    api.force_authenticate(user=user)
    r = api.post("/api/student/shop/checkout/", {"items": [{"product_id": str(unpriced_variant.product_id), "qty": 1}]}, format="json")
    assert r.status_code == 400 and r.json()["error"] == "no_price"
