"""GET /api/hq/reports/detailed/?tab=schools — the "shop commission" column.

The commission on a shop sale belongs to the school on the sale line: the
student's home school when the product is HQ's. The column used to read the
*product's* school, which an HQ product does not have, so it stayed at zero
for every school whatever the sales ledger said."""
import uuid
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from commerce.models import ShopProduct, ShopSale
from schools.models import School

pytestmark = pytest.mark.django_db
User = get_user_model()
DETAILED = "/api/hq/reports/detailed/"


def _school(name):
    return School.objects.create(
        name=name, slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        shop_commission_percentage=Decimal("5.00"),
    )


def _client():
    hq = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role="hq", roles=["hq"])
    client = APIClient()
    client.force_authenticate(hq)
    return client


def _sale(product, school, total, commission, source):
    return ShopSale.objects.create(
        product=product, school=school, qty=1, unit_price=Decimal(total), total=Decimal(total),
        commission=Decimal(commission), source=source,
    )


def test_hq_product_sales_credit_the_school_on_the_sale_line():
    earner, other = _school("Earner"), _school("Other")
    hq_product = ShopProduct.objects.create(school=None, name="Collezione Libri", price=Decimal("12.00"))
    _sale(hq_product, earner, "12.00", "0.60", ShopSale.Source.ONLINE)
    _sale(hq_product, earner, "20.00", "1.00", ShopSale.Source.MANUAL)
    _sale(hq_product, None, "12.00", "0", ShopSale.Source.ONLINE)  # student without a school

    resp = _client().get(DETAILED, {"tab": "schools"})

    assert resp.status_code == 200, resp.content
    rows = {r["id"]: r for r in resp.json()["rows"]}
    assert rows[str(earner.id)]["shop_commission"] == 1.60
    assert rows[str(other.id)]["shop_commission"] == 0
    assert resp.json()["kpis"]["shop_revenue"] == 44.00
