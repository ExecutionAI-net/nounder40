"""HQ › Shop › Sales (Carlo, 2026-11-01): a manual sale carries the day it
happened (`sold_at`, typed on the form, today by default) and a line can be
corrected afterwards — the date, the student, the product/variant, the
quantity, the price, the payment, the discount, the referrer. Stock and the
two commissions follow; an online line is Stripe's record and stays."""
import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role
from commerce.models import ShopProduct, ShopProductVariant, ShopReferrer, ShopSale
from schools.models import School
from students.models import Student

pytestmark = pytest.mark.django_db
User = get_user_model()
SALES = "/api/hq/shop-sales/"


def _api(role=Role.HQ):
    user = User.objects.create(email=f"{role}-{uuid.uuid4().hex[:8]}@example.com", role=role, roles=[role])
    api = APIClient()
    api.force_authenticate(user=user)
    return api


@pytest.fixture
def hq():
    return _api()


@pytest.fixture
def school():
    return School.objects.create(
        name="Barcelona", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        shop_commission_percentage=Decimal("10.00"),
    )


@pytest.fixture
def student(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT])
    return Student.objects.create(user=user, name="Francesca", school=school)


@pytest.fixture
def body():
    product = ShopProduct.objects.create(name="Body", price=Decimal("50.00"), category="clothing")
    ShopProductVariant.objects.create(product=product, size="S", color="nero", stock=5)
    ShopProductVariant.objects.create(product=product, size="M", color="nero", stock=5)
    return product


@pytest.fixture
def shoes():
    product = ShopProduct.objects.create(name="Scarpe", price=Decimal("80.00"), category="shoes")
    ShopProductVariant.objects.create(product=product, size="38", color="", stock=3)
    return product


def _variant(product, size):
    return ShopProductVariant.objects.get(product=product, size=size)


def _post_sale(hq, product, size="M", qty=2, **extra):
    v = _variant(product, size)
    payload = {
        "payment_method": "contante",
        "items": [{"product_id": str(product.id), "variant_id": str(v.id), "qty": qty}],
        **extra,
    }
    r = hq.post(SALES, payload, format="json")
    assert r.status_code == 201, r.json()
    return ShopSale.objects.get(order_id=r.json()["order_id"])


# ── the day of the sale ──────────────────────────────────────────────────────

def test_a_sale_is_dated_today_unless_hq_types_the_day(hq, body):
    today = timezone.localdate()
    assert _post_sale(hq, body).sold_at == today

    typed = _post_sale(hq, body, sold_at="2026-10-15")
    assert typed.sold_at == date(2026, 10, 15)
    # the moment the row was written is still today
    assert timezone.localdate(typed.created_at) == today

    # the register lists by the sale day, newest first
    listed = hq.get(SALES).json()
    assert [row["sold_at"] for row in listed] == [today.isoformat(), "2026-10-15"]


def test_a_sale_day_still_to_come_or_not_a_date_is_refused(hq, body):
    v = _variant(body, "M")
    items = [{"product_id": str(body.id), "variant_id": str(v.id), "qty": 1}]
    tomorrow = (timezone.localdate() + timedelta(days=1)).isoformat()
    r = hq.post(SALES, {"items": items, "sold_at": tomorrow}, format="json")
    assert r.status_code == 400 and r.json()["error"] == "invalid_sold_at"
    r = hq.post(SALES, {"items": items, "sold_at": "yesterday"}, format="json")
    assert r.status_code == 400 and r.json()["error"] == "invalid_sold_at"
    # nothing was sold
    assert ShopSale.objects.count() == 0 and _variant(body, "M").stock == 5


# ── correcting a line ────────────────────────────────────────────────────────

def test_edit_moves_the_date_and_the_payment_and_nothing_else(hq, body):
    sale = _post_sale(hq, body, qty=2)
    r = hq.patch(f"{SALES}{sale.id}/", {"sold_at": "2026-10-20", "payment_method": "carta"}, format="json")
    assert r.status_code == 200, r.json()
    sale.refresh_from_db()
    assert sale.sold_at == date(2026, 10, 20) and sale.payment_method == "carta"
    assert sale.qty == 2 and sale.total == Decimal("100.00")
    assert _variant(body, "M").stock == 3

    tomorrow = (timezone.localdate() + timedelta(days=1)).isoformat()
    assert hq.patch(f"{SALES}{sale.id}/", {"sold_at": tomorrow}, format="json").json()["error"] == "invalid_sold_at"
    assert hq.patch(f"{SALES}{sale.id}/", {"payment_method": "paypal"}, format="json").json()["error"] == "invalid_payment_method"


def test_edit_quantity_moves_only_the_difference_of_stock(hq, body):
    sale = _post_sale(hq, body, qty=2)  # M: 5 -> 3
    r = hq.patch(f"{SALES}{sale.id}/", {"qty": 3}, format="json")
    assert r.status_code == 200, r.json()
    v = _variant(body, "M")
    assert (v.stock, v.sold) == (2, 3)
    sale.refresh_from_db()
    assert sale.total == Decimal("150.00")

    r = hq.patch(f"{SALES}{sale.id}/", {"qty": 1}, format="json")
    assert r.status_code == 200
    v = _variant(body, "M")
    assert (v.stock, v.sold) == (4, 1)
    assert hq.patch(f"{SALES}{sale.id}/", {"qty": 0}, format="json").json()["error"] == "invalid_item"


def test_edit_variant_gives_the_pieces_back_and_takes_the_new_ones(hq, body):
    sale = _post_sale(hq, body, size="M", qty=2)
    s = _variant(body, "S")
    r = hq.patch(f"{SALES}{sale.id}/", {"product_id": str(body.id), "variant_id": str(s.id)}, format="json")
    assert r.status_code == 200, r.json()
    assert (_variant(body, "M").stock, _variant(body, "M").sold) == (5, 0)
    assert (_variant(body, "S").stock, _variant(body, "S").sold) == (3, 2)
    sale.refresh_from_db()
    assert sale.variant_id == s.id and sale.size == "S"
    # the same product: the price stays
    assert sale.unit_price == Decimal("50.00")


def test_edit_product_takes_its_list_price_unless_one_is_typed(hq, body, shoes):
    sale = _post_sale(hq, body, size="M", qty=1)
    v38 = _variant(shoes, "38")
    r = hq.patch(f"{SALES}{sale.id}/", {"product_id": str(shoes.id), "variant_id": str(v38.id)}, format="json")
    assert r.status_code == 200, r.json()
    sale.refresh_from_db()
    assert sale.product_id == shoes.id and sale.unit_price == Decimal("80.00") and sale.total == Decimal("80.00")
    assert _variant(body, "M").stock == 5 and _variant(shoes, "38").stock == 2

    r = hq.patch(f"{SALES}{sale.id}/", {"unit_price": "70"}, format="json")
    assert r.status_code == 200 and Decimal(r.json()["total"]) == Decimal("70.00")
    assert hq.patch(f"{SALES}{sale.id}/", {"unit_price": "-1"}, format="json").json()["error"] == "invalid_unit_price"
    assert hq.patch(f"{SALES}{sale.id}/", {"unit_price": "abc"}, format="json").json()["error"] == "invalid_unit_price"

    # a variant of another product is refused and nothing moves
    r = hq.patch(f"{SALES}{sale.id}/", {"product_id": str(body.id), "variant_id": str(v38.id)}, format="json")
    assert r.status_code == 404 and r.json()["error"] == "variant_not_found"
    assert _variant(shoes, "38").stock == 2


def test_edit_student_moves_the_school_commission(hq, body, student, school):
    sale = _post_sale(hq, body, qty=2)
    assert sale.student_id is None and sale.commission == 0

    r = hq.patch(f"{SALES}{sale.id}/", {"student_id": str(student.id)}, format="json")
    assert r.status_code == 200, r.json()
    sale.refresh_from_db()
    assert sale.student_id == student.id and sale.school_id == school.id
    assert sale.commission == Decimal("10.00")  # 10% of 100
    assert r.json()["students"] == {"name": "Francesca"} and r.json()["schools"] == {"name": "Barcelona"}

    # the discount lowers the net amount and so the commission
    r = hq.patch(f"{SALES}{sale.id}/", {"discount": "20"}, format="json")
    sale.refresh_from_db()
    assert (sale.discount, sale.total, sale.commission) == (Decimal("20.00"), Decimal("80.00"), Decimal("8.00"))
    # never more than the line
    hq.patch(f"{SALES}{sale.id}/", {"discount": "500"}, format="json")
    sale.refresh_from_db()
    assert (sale.discount, sale.total) == (Decimal("100.00"), Decimal("0.00"))

    # nobody: no school, no commission
    r = hq.patch(f"{SALES}{sale.id}/", {"student_id": None, "discount": "0"}, format="json")
    sale.refresh_from_db()
    assert sale.student_id is None and sale.school_id is None and sale.commission == 0
    assert hq.patch(f"{SALES}{sale.id}/", {"student_id": str(uuid.uuid4())}, format="json").status_code == 404


def test_edit_referrer_and_percentage(hq, body):
    anna = ShopReferrer.objects.create(first_name="Anna", last_name="Bianchi")
    sale = _post_sale(hq, body, qty=2)

    r = hq.patch(f"{SALES}{sale.id}/", {"referrer_id": str(anna.id), "referrer_percentage": 10}, format="json")
    assert r.status_code == 200, r.json()
    sale.refresh_from_db()
    assert (sale.referrer_contact_id, sale.referrer, sale.referrer_percentage, sale.referrer_commission) == (
        anna.id, "Anna Bianchi", Decimal("10.00"), Decimal("10.00"))

    # only the percentage
    hq.patch(f"{SALES}{sale.id}/", {"referrer_percentage": 5}, format="json")
    sale.refresh_from_db()
    assert (sale.referrer_percentage, sale.referrer_commission) == (Decimal("5.00"), Decimal("5.00"))
    # the net amount changes: the commission follows at the same percentage
    hq.patch(f"{SALES}{sale.id}/", {"qty": 1}, format="json")
    sale.refresh_from_db()
    assert (sale.total, sale.referrer_commission) == (Decimal("50.00"), Decimal("2.50"))

    # nobody: no percentage either
    hq.patch(f"{SALES}{sale.id}/", {"referrer_id": None}, format="json")
    sale.refresh_from_db()
    assert (sale.referrer_contact_id, sale.referrer, sale.referrer_percentage, sale.referrer_commission) == (None, "", 0, 0)

    inactive = ShopReferrer.objects.create(first_name="Old", active=False)
    assert hq.patch(f"{SALES}{sale.id}/", {"referrer_id": str(inactive.id)}, format="json").json()["error"] == "referrer_not_found"


def test_an_online_line_is_not_edited_and_only_hq_edits(hq, body):
    v = _variant(body, "M")
    online = ShopSale.objects.create(
        product=body, variant=v, qty=1, unit_price=50, total=50, source=ShopSale.Source.ONLINE, payment_method="stripe",
    )
    r = hq.patch(f"{SALES}{online.id}/", {"qty": 2}, format="json")
    assert r.status_code == 409 and r.json()["error"] == "online_sale_locked"
    online.refresh_from_db()
    assert online.qty == 1

    assert hq.patch(f"{SALES}{uuid.uuid4()}/", {"qty": 2}, format="json").status_code == 404
    assert hq.patch(f"{SALES}{online.id}/", "just text", format="json").status_code == 400

    manual = _post_sale(hq, body, qty=1)
    assert _api(Role.SCHOOL).patch(f"{SALES}{manual.id}/", {"qty": 2}, format="json").status_code == 403
