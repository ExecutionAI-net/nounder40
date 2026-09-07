"""Regression tests for the shop-order fulfillment gap (QA C-5 / C-1):

`ShopOrder` stayed `"pending"` forever after a real, successful Stripe charge
— `VerifySessionView._activate()` explicitly did nothing for
`kind == "shop_order"` (`"not_a_package_payment"`), and no webhook handler
existed for it either. `activate_shop_order_payment()` is the shop's mirror of
`commerce.services.activate_package_payment`, wired into both paths exactly
like packages already are: `commerce.webhooks._handle_payment_intent_succeeded`
(webhook) and `VerifySessionView._activate` (return-from-Stripe fallback).

These tests cover: idempotency across *both* delivery paths (webhook and
verify-session can race, exactly like packages), the pending → paid status
transition, the platform-fee/school-amount/referral-commission split landing
correctly on the `Transaction` row using the numbers the checkout view already
computed onto the order, and that a platform-wide (school=None) order — which
has no Stripe Connect split and therefore no `Transaction` row — still shows
up in the HQ shop-sales ledger (`ShopSale`), which is exactly the gap the QA
report's live repro ("Collezione Libri", `school: null`) hit.
"""
import uuid
from decimal import Decimal
from types import SimpleNamespace

import pytest
from django.contrib.auth import get_user_model

from commerce.models import ShopOrder, ShopProduct, ShopSale, Transaction
from commerce.services import activate_shop_order_payment
from commerce.stripe_views import VerifySessionView
from commerce.webhooks import handle_event
from schools.models import School
from students.models import Student

pytestmark = pytest.mark.django_db


@pytest.fixture
def school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        stripe_account_id="acct_x", stripe_onboarding_complete=True,
        platform_fee_percentage=Decimal("10.00"), shop_commission_percentage=Decimal("5.00"),
    )


@pytest.fixture
def referral_school():
    return School.objects.create(name="Referrer", slug=f"ref-{uuid.uuid4().hex[:8]}", email="ref@example.com")


@pytest.fixture
def student(school):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name="Stu", school=school)


@pytest.fixture
def product(school):
    return ShopProduct.objects.create(school=school, name="QA Tee", price=Decimal("20.00"))


@pytest.fixture
def hq_product():
    return ShopProduct.objects.create(school=None, name="Collezione Libri", price=Decimal("12.00"))


def _order_items(product, qty=2):
    return [{
        "product_id": str(product.id), "name": product.name, "price": str(product.price),
        "qty": qty, "size": None, "color": None,
    }]


def _meta(order, student):
    return {"kind": "shop_order", "order_id": str(order.id), "student_id": str(student.id)}


class TestFeeSplitAndStatusTransition:
    def test_school_scoped_order_activates_with_correct_split(self, school, referral_school, student, product):
        order = ShopOrder.objects.create(
            student=student, school=school, items=_order_items(product, qty=2),
            subtotal=Decimal("40.00"), discount_amount=Decimal("5.20"),
            referral_school=referral_school, referral_discount=Decimal("1.20"),
            shipping=Decimal("5.00"), total=Decimal("39.80"),
            stripe_payment_id="cs_test_abc", status="pending",
        )

        result = activate_shop_order_payment(
            payment_id="pi_shop1", amount_cents=3980, metadata=_meta(order, student),
        )

        assert result == "shop_order_activated"
        order.refresh_from_db()
        assert order.status == "paid"

        tx = Transaction.objects.get(stripe_payment_id="pi_shop1")
        assert tx.type == Transaction.Type.SHOP
        assert tx.school_id == school.id
        assert tx.student_id == student.id
        assert tx.amount == Decimal("39.80")
        assert tx.platform_fee == Decimal("3.98")  # 10% of 39.80
        assert tx.school_amount == Decimal("35.82")
        assert tx.referral_school_id == referral_school.id
        assert tx.referral_commission == Decimal("1.20")

        sale = ShopSale.objects.get(order_id=order.id)
        assert sale.source == ShopSale.Source.ONLINE
        assert sale.product_id == product.id
        assert sale.school_id == school.id
        assert sale.qty == 2
        assert sale.discount == Decimal("5.20")
        assert sale.total == Decimal("34.80")  # 40.00 gross - 5.20 discount
        assert sale.commission == Decimal("1.74")  # 5% school commission on the 34.80 net
        assert sale.referrer == referral_school.name
        assert sale.referrer_percentage == Decimal("3.00")  # 1.20 / 40.00 * 100
        assert sale.referrer_commission == Decimal("1.20")
        assert sale.shipping == Decimal("5.00")

    def test_platform_wide_order_has_no_transaction_but_gets_a_shop_sale(self, student, hq_product):
        """The exact QA repro: an HQ-level product (school=None) has no
        Stripe Connect split, so no Transaction row makes sense (Transaction.
        school is required) — but it must still show up in the HQ shop-sales
        ledger, which is what GET /api/hq/shop-sales/ reads."""
        order = ShopOrder.objects.create(
            student=student, school=None, items=_order_items(hq_product, qty=1),
            subtotal=Decimal("12.00"), discount_amount=Decimal("0"),
            shipping=Decimal("4.99"), total=Decimal("16.99"),
            stripe_payment_id="cs_test_hq", status="pending",
        )

        result = activate_shop_order_payment(
            payment_id="pi_hq1", amount_cents=1699, metadata=_meta(order, student),
        )

        assert result == "shop_order_activated"
        order.refresh_from_db()
        assert order.status == "paid"
        assert not Transaction.objects.filter(stripe_payment_id="pi_hq1").exists()

        sale = ShopSale.objects.get(order_id=order.id)
        assert sale.school_id is None
        assert sale.product_id == hq_product.id
        assert sale.total == Decimal("12.00")
        assert sale.commission == Decimal("0")


class TestIdempotency:
    def test_the_same_payment_delivered_twice_fulfills_once(self, school, student, product):
        order = ShopOrder.objects.create(
            student=student, school=school, items=_order_items(product, qty=1),
            subtotal=Decimal("20.00"), total=Decimal("20.00"),
            stripe_payment_id="cs_test_dup", status="pending",
        )
        meta = _meta(order, student)

        first = activate_shop_order_payment(payment_id="pi_dup", amount_cents=2000, metadata=meta)
        second = activate_shop_order_payment(payment_id="pi_dup", amount_cents=2000, metadata=meta)

        assert first == "shop_order_activated"
        assert second == "already_processed"
        assert Transaction.objects.filter(stripe_payment_id="pi_dup").count() == 1
        assert ShopSale.objects.filter(order_id=order.id).count() == 1

    def test_webhook_and_verify_session_race_fulfills_once(self, school, student, product):
        """The exact dual-path race packages already guard against: the
        webhook and the browser's verify-session fallback can both try to
        activate the same payment. Whichever lands first wins; the other is a
        clean no-op, on both code paths."""
        order = ShopOrder.objects.create(
            student=student, school=school, items=_order_items(product, qty=1),
            subtotal=Decimal("20.00"), total=Decimal("20.00"),
            stripe_payment_id="cs_test_race", status="pending",
        )
        meta = _meta(order, student)

        webhook_event = {
            "type": "payment_intent.succeeded",
            "data": {"object": {"id": "pi_race", "amount": 2000, "metadata": meta}},
        }
        webhook_result = handle_event(webhook_event)

        session = SimpleNamespace(payment_status="paid", payment_intent="pi_race", subscription=None, amount_total=2000)
        verify_result = VerifySessionView()._activate(session, meta)

        assert webhook_result == "shop_order_activated"
        assert verify_result == "already_processed"
        order.refresh_from_db()
        assert order.status == "paid"
        assert Transaction.objects.filter(stripe_payment_id="pi_race").count() == 1
        assert ShopSale.objects.filter(order_id=order.id).count() == 1

    def test_a_second_distinct_order_still_activates(self, school, student, product):
        order1 = ShopOrder.objects.create(
            student=student, school=school, items=_order_items(product, qty=1),
            subtotal=Decimal("20.00"), total=Decimal("20.00"), status="pending",
        )
        order2 = ShopOrder.objects.create(
            student=student, school=school, items=_order_items(product, qty=1),
            subtotal=Decimal("20.00"), total=Decimal("20.00"), status="pending",
        )
        activate_shop_order_payment(payment_id="pi_1", amount_cents=2000, metadata=_meta(order1, student))
        activate_shop_order_payment(payment_id="pi_2", amount_cents=2000, metadata=_meta(order2, student))

        order1.refresh_from_db()
        order2.refresh_from_db()
        assert order1.status == "paid" and order2.status == "paid"
        assert Transaction.objects.count() == 2


class TestGuardClauses:
    def test_wrong_kind_is_a_no_op(self, student):
        result = activate_shop_order_payment(
            payment_id="pi_x", amount_cents=100, metadata={"kind": "package"},
        )
        assert result == "not_a_shop_order_payment"

    def test_missing_order_id_in_metadata(self):
        result = activate_shop_order_payment(payment_id="pi_x", amount_cents=100, metadata={"kind": "shop_order"})
        assert result == "missing_refs"

    def test_order_that_no_longer_exists(self):
        result = activate_shop_order_payment(
            payment_id="pi_x", amount_cents=100,
            metadata={"kind": "shop_order", "order_id": str(uuid.uuid4())},
        )
        assert result == "missing_refs"

    def test_no_payment_id(self, school, student, product):
        order = ShopOrder.objects.create(
            student=student, school=school, items=_order_items(product, qty=1),
            subtotal=Decimal("20.00"), total=Decimal("20.00"), status="pending",
        )
        result = activate_shop_order_payment(payment_id="", amount_cents=2000, metadata=_meta(order, student))
        assert result == "no_payment_id"
        order.refresh_from_db()
        assert order.status == "pending"
