"""Shop referrers registry (Carlo, 30/10/2026): HQ keeps the people who
bring sales in a list, picks one on a manual sale, and the percentage is
still typed per sale. A referrer with sales is deactivated, never deleted."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from commerce.models import ShopProduct, ShopProductVariant, ShopReferrer, ShopSale

pytestmark = pytest.mark.django_db


@pytest.fixture
def hq():
    user = get_user_model().objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ)
    api = APIClient()
    api.force_authenticate(user=user)
    return api


@pytest.fixture
def variant():
    product = ShopProduct.objects.create(name="Body", price=50, category="abbigliamento")
    return ShopProductVariant.objects.create(product=product, size="M", color="nero", stock=5)


def test_registry_crud(hq):
    r = hq.post("/api/hq/shop-referrers/", {"first_name": "Anna", "last_name": "Bianchi", "phone": "+39 333 1234567", "email": "anna@example.com"}, format="json")
    assert r.status_code == 201
    row = r.json()
    assert row["full_name"] == "Anna Bianchi" and row["active"] is True and row["sales_count"] == 0

    assert hq.post("/api/hq/shop-referrers/", {"first_name": "  "}, format="json").status_code == 400

    r = hq.patch(f"/api/hq/shop-referrers/{row['id']}/", {"last_name": "Verdi", "active": False}, format="json")
    assert r.status_code == 200 and r.json()["full_name"] == "Anna Verdi" and r.json()["active"] is False

    listed = hq.get("/api/hq/shop-referrers/").json()
    assert [x["id"] for x in listed] == [row["id"]]

    assert hq.delete(f"/api/hq/shop-referrers/{row['id']}/").status_code == 204
    assert not ShopReferrer.objects.filter(pk=row["id"]).exists()


def test_manual_sale_takes_the_referrer_from_the_registry(hq, variant):
    ref = ShopReferrer.objects.create(first_name="Anna", last_name="Bianchi")
    body = {
        "payment_method": "contante", "referrer_id": str(ref.id), "referrer_percentage": 10,
        "items": [{"product_id": str(variant.product_id), "variant_id": str(variant.id), "qty": 2}],
    }
    r = hq.post("/api/hq/shop-sales/", body, format="json")
    assert r.status_code == 201, r.json()
    sale = ShopSale.objects.get(order_id=r.json()["order_id"])
    assert sale.referrer_contact_id == ref.id
    assert sale.referrer == "Anna Bianchi"
    assert float(sale.referrer_percentage) == 10.0 and float(sale.referrer_commission) == 10.0  # 10% of 100

    # Listed sales carry the registry id, so the sales filter can use it
    assert hq.get("/api/hq/shop-sales/").json()[0]["referrer_contact"] == str(ref.id)
    # ...and the registry counts the sale
    assert hq.get("/api/hq/shop-referrers/").json()[0]["sales_count"] == 1

    # With sales behind it the referrer cannot be deleted, only deactivated
    assert hq.delete(f"/api/hq/shop-referrers/{ref.id}/").status_code == 409


def test_unknown_or_inactive_referrer_is_refused(hq, variant):
    inactive = ShopReferrer.objects.create(first_name="Old", active=False)
    items = [{"product_id": str(variant.product_id), "variant_id": str(variant.id), "qty": 1}]
    r = hq.post("/api/hq/shop-sales/", {"referrer_id": str(uuid.uuid4()), "items": items}, format="json")
    assert r.status_code == 400 and r.json()["error"] == "referrer_not_found"
    r = hq.post("/api/hq/shop-sales/", {"referrer_id": str(inactive.id), "items": items}, format="json")
    assert r.status_code == 400 and r.json()["error"] == "referrer_not_found"


def test_migration_links_existing_names():
    """The data step of migration 0010, run again on fresh rows: one
    registry row per distinct typed name, each sale linked to it."""
    from importlib import import_module

    from django.apps import apps

    product = ShopProduct.objects.create(name="Body", price=50, category="abbigliamento")
    for name in ("Anna Bianchi", "Anna Bianchi", "Luca Neri", ""):
        ShopSale.objects.create(product=product, qty=1, unit_price=50, total=50, referrer=name)

    import_module("commerce.migrations.0010_shop_referrer").link_existing_referrers(apps, None)

    rows = {r.first_name: r for r in ShopReferrer.objects.all()}
    assert set(rows) == {"Anna Bianchi", "Luca Neri"}
    assert ShopSale.objects.filter(referrer="Anna Bianchi", referrer_contact=rows["Anna Bianchi"]).count() == 2
    assert ShopSale.objects.filter(referrer="").first().referrer_contact_id is None
