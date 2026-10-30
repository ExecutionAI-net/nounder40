"""The list price stays required on a product, and HQ can change the unit
price on a manual sale (Carlo, 30/10/2026). A product saved with price 0 by
other means is never sold online."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from commerce.models import ShopProduct, ShopProductVariant, ShopReferrer, ShopSale
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
def variant():
    product = ShopProduct.objects.create(name="Body", price=50, category="clothing")
    return ShopProductVariant.objects.create(product=product, size="M", color="nero", stock=5)


def _items(variant, **extra):
    return [{"product_id": str(variant.product_id), "variant_id": str(variant.id), "qty": 2, **extra}]


def _sale(hq, items):
    r = hq.post("/api/hq/shop-sales/", {"items": items}, format="json")
    return r, (ShopSale.objects.get(order_id=r.json()["order_id"]) if r.status_code == 201 else None)


def test_manual_sale_takes_the_typed_unit_price(hq, variant):
    r, sale = _sale(hq, _items(variant, unit_price=40))
    assert r.status_code == 201, r.json()
    assert float(sale.unit_price) == 40.0 and float(sale.total) == 80.0


def test_manual_sale_without_a_typed_price_uses_the_list_price(hq, variant):
    r, sale = _sale(hq, _items(variant))
    assert r.status_code == 201 and float(sale.unit_price) == 50.0
    r, sale = _sale(hq, _items(variant, unit_price=""))
    assert r.status_code == 201 and float(sale.unit_price) == 50.0


@pytest.mark.parametrize("bad", [0, -5, "abc", "nan", "inf", True, "1e400"])
def test_a_bad_typed_price_is_refused(hq, variant, bad):
    r, _ = _sale(hq, _items(variant, unit_price=bad))
    assert r.status_code == 400 and r.json()["error"] == "invalid_unit_price"


def test_storefront_refuses_an_unpriced_product():
    product = ShopProduct.objects.create(name="Senza prezzo", price=0, category="other")
    school = School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    Student.objects.create(user=user, name="Stu", school=school)
    api = APIClient()
    api.force_authenticate(user=user)
    r = api.post("/api/student/shop/checkout/", {"items": [{"product_id": str(product.id), "qty": 1}]}, format="json")
    assert r.status_code == 400 and r.json()["error"] == "no_price"


def test_a_refused_line_rolls_back_the_stock_of_the_lines_before_it(hq, variant):
    """Review 30/10/2026: the first line's stock was already scaled when the
    second line was refused, and a plain `return` committed it."""
    other = ShopProductVariant.objects.create(product=variant.product, size="L", color="nero", stock=5)
    items = [
        {"product_id": str(variant.product_id), "variant_id": str(variant.id), "qty": 2},
        {"product_id": str(variant.product_id), "variant_id": str(other.id), "qty": 1, "unit_price": "abc"},
    ]
    r = hq.post("/api/hq/shop-sales/", {"items": items}, format="json")
    assert r.status_code == 400
    variant.refresh_from_db()
    assert (variant.stock, variant.sold) == (5, 0)
    assert not ShopSale.objects.exists()


@pytest.mark.parametrize(
    "body",
    [
        {"referrer_percentage": "abc"},
        {"discount": "x"},
    ],
)
def test_non_numeric_amounts_are_400_not_500(hq, variant, body):
    ref = ShopReferrer.objects.create(first_name="Anna")
    payload = {"referrer_id": str(ref.id), "items": _items(variant), **body}
    assert hq.post("/api/hq/shop-sales/", payload, format="json").status_code == 400


def test_bad_quantity_and_unknown_product_have_codes(hq, variant):
    r = hq.post("/api/hq/shop-sales/", {"items": _items(variant, qty="two")}, format="json")
    assert r.status_code == 400
    r = hq.post("/api/hq/shop-sales/", {"items": [{"product_id": str(uuid.uuid4()), "variant_id": str(variant.id), "qty": 1}]}, format="json")
    assert r.status_code == 404 and r.json()["error"] == "product_not_found"
