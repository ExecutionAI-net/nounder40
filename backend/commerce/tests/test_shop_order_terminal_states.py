"""R2-M14c / ST-R2-18 — un ordine rifiutato o abbandonato non resta `pending`.

Prima esistevano solo due stati, `pending` e `paid`, e nessun handler per gli
eventi di fallimento: la carta rifiutata e il Checkout abbandonato lasciavano
l'ordine "In attesa" per sempre nella pagina "I miei acquisti" (ordine
`7666d20d…` del report). Ora ci sono tre stati terminali, i webhook che li
producono e una scopa periodica per quando l'evento non arriva affatto.

Gli eventi sono payload sintetici passati a `handle_event`, la stessa forma
che `commerce/views.py::stripe_webhook` consegna dopo la verifica della firma:
le chiavi Stripe di questo ambiente sono mascherate, quindi non si puo'
provocare un evento vero.
"""
import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from commerce.models import ShopOrder, ShopProduct
from commerce.services import fail_shop_order
from commerce.tasks import expire_stale_shop_orders_task
from commerce.webhooks import handle_event
from schools.models import School
from students.models import Student

pytestmark = pytest.mark.django_db


@pytest.fixture
def school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True,
        platform_fee_percentage=Decimal("10.00"),
    )


@pytest.fixture
def student(school):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name="Stu", school=school)


@pytest.fixture
def product(school):
    return ShopProduct.objects.create(school=school, name="QA Tee", price=Decimal("20.00"))


def _order(school, student, product, session_id):
    return ShopOrder.objects.create(
        student=student, school=school,
        items=[{"product_id": str(product.id), "name": product.name, "price": "20.00", "qty": 1}],
        subtotal=Decimal("20.00"), shipping=Decimal("0"), total=Decimal("20.00"),
        stripe_payment_id=session_id, status=ShopOrder.Status.PENDING,
    )


def _event(etype, obj):
    return {"type": etype, "data": {"object": obj}}


class TestWebhookTerminalStates:
    def test_checkout_session_expired_expires_the_order(self, school, student, product):
        order = _order(school, student, product, "cs_expired_1")
        assert order.status == "pending"

        result = handle_event(_event("checkout.session.expired", {
            "id": "cs_expired_1",
            "metadata": {"kind": "shop_order", "order_id": str(order.id)},
        }))

        assert result == "shop_order_expired"
        order.refresh_from_db()
        assert order.status == ShopOrder.Status.EXPIRED

    def test_expired_session_without_metadata_is_matched_on_the_session_id(self, school, student, product):
        """Un evento senza metadata (sessione creata prima del fix, o metadata
        persi) deve comunque trovare l'ordine: `stripe_payment_id` porta l'id
        della sessione finche' l'ordine non e' pagato."""
        order = _order(school, student, product, "cs_expired_2")

        result = handle_event(_event("checkout.session.expired", {"id": "cs_expired_2"}))

        assert result == "shop_order_expired"
        order.refresh_from_db()
        assert order.status == ShopOrder.Status.EXPIRED

    def test_payment_intent_failed_fails_the_order(self, school, student, product):
        order = _order(school, student, product, "cs_failed_1")

        result = handle_event(_event("payment_intent.payment_failed", {
            "id": "pi_failed_1",
            "metadata": {"kind": "shop_order", "order_id": str(order.id)},
        }))

        assert result == "shop_order_failed"
        order.refresh_from_db()
        assert order.status == ShopOrder.Status.FAILED

    def test_async_payment_failed_fails_rather_than_expires(self, school, student, product):
        order = _order(school, student, product, "cs_async_1")

        result = handle_event(_event("checkout.session.async_payment_failed", {
            "id": "cs_async_1", "metadata": {"kind": "shop_order", "order_id": str(order.id)},
        }))

        assert result == "shop_order_failed"
        order.refresh_from_db()
        assert order.status == ShopOrder.Status.FAILED

    def test_a_package_payment_failure_never_touches_a_shop_order(self, school, student, product):
        order = _order(school, student, product, "cs_pkg_1")

        result = handle_event(_event("payment_intent.payment_failed", {
            "id": "pi_pkg_1", "metadata": {"kind": "package", "order_id": str(order.id)},
        }))

        assert result == "not_a_shop_order_payment"
        order.refresh_from_db()
        assert order.status == ShopOrder.Status.PENDING

    def test_a_paid_order_is_never_downgraded_by_a_late_failure_event(self, school, student, product):
        """Stripe consegna at-least-once e gli eventi possono arrivare fuori
        ordine: una scadenza che atterra dopo il pagamento non deve annullare
        un ordine gia' incassato."""
        order = _order(school, student, product, "cs_paid_1")
        order.status = ShopOrder.Status.PAID
        order.save(update_fields=["status"])

        result = handle_event(_event("checkout.session.expired", {
            "id": "cs_paid_1", "metadata": {"kind": "shop_order", "order_id": str(order.id)},
        }))

        assert result == "already_paid"
        order.refresh_from_db()
        assert order.status == ShopOrder.Status.PAID

    def test_replaying_the_same_failure_event_is_a_no_op(self, school, student, product):
        order = _order(school, student, product, "cs_replay_1")
        event = _event("checkout.session.expired", {
            "id": "cs_replay_1", "metadata": {"kind": "shop_order", "order_id": str(order.id)},
        })
        assert handle_event(event) == "shop_order_expired"
        assert handle_event(event) == "already_processed"


class TestSuccessStillWorks:
    def test_a_successful_payment_still_reaches_paid(self, school, student, product):
        order = _order(school, student, product, "cs_ok_1")

        result = handle_event(_event("payment_intent.succeeded", {
            "id": "pi_ok_1", "amount": 2000,
            "metadata": {"kind": "shop_order", "order_id": str(order.id), "student_id": str(student.id)},
        }))

        assert result == "shop_order_activated"
        order.refresh_from_db()
        assert order.status == ShopOrder.Status.PAID
        assert order.stripe_payment_id == "pi_ok_1"


class TestSweep:
    def test_the_sweep_expires_only_orders_older_than_the_window(self, school, student, product):
        stale = _order(school, student, product, "cs_stale")
        fresh = _order(school, student, product, "cs_fresh")
        paid = _order(school, student, product, "cs_paid_sweep")
        paid.status = ShopOrder.Status.PAID
        paid.save(update_fields=["status"])
        old = timezone.now() - timedelta(hours=48)
        ShopOrder.objects.filter(pk__in=[stale.pk, paid.pk]).update(created_at=old)

        assert expire_stale_shop_orders_task(hours=36) == 1

        for order in (stale, fresh, paid):
            order.refresh_from_db()
        assert stale.status == ShopOrder.Status.EXPIRED
        assert fresh.status == ShopOrder.Status.PENDING
        assert paid.status == ShopOrder.Status.PAID


def test_fail_shop_order_refuses_a_non_terminal_status(school, student, product):
    order = _order(school, student, product, "cs_bad")
    assert fail_shop_order(order_id=order.id, status="paid") == "invalid_status"
    order.refresh_from_db()
    assert order.status == ShopOrder.Status.PENDING
