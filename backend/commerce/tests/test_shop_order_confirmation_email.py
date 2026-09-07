"""R2-M14b — la conferma d'ordine del Negozio.

`student.shop.orderSuccess` prometteva da sempre "riceverai un'email di
conferma" e quell'email non esisteva: nessun template in
`notifications/builtin_templates.py`, nessuna riga in HQ > Emails, niente
arrivato nell'inbox del giro 2 di QA per l'ordine P6.

Qui si verifica che: (1) l'email parte dall'attivazione dell'ordine, (2) parte
DOPO il commit (mai `.delay()` dentro l'atomic, CLAUDE.md §4.7), (3) il
contenuto e' quello dell'ordine, (4) il template esiste in tutte e cinque le
lingue e rende senza buchi.
"""
import uuid
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model

from commerce.models import ShopOrder, ShopProduct
from commerce.services import activate_shop_order_payment
from notifications.emails import get_template, render
from schools.models import School
from students.models import Student

pytestmark = pytest.mark.django_db

LOCALES = ("en", "it", "es", "fr", "de")


@pytest.fixture
def school():
    return School.objects.create(
        name="QA Test School", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        active=True, platform_fee_percentage=Decimal("10.00"),
    )


@pytest.fixture
def student(school):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(
        user=user, name="Maria Rossi", first_name="Maria", last_name="Rossi",
        school=school, language_preference="it",
    )


@pytest.fixture
def order(school, student):
    product = ShopProduct.objects.create(school=school, name="Ballet Shoes", price=Decimal("30.00"))
    return ShopOrder.objects.create(
        student=student, school=school,
        items=[{"product_id": str(product.id), "name": product.name, "price": "30.00",
                "qty": 2, "size": "38", "color": "Pink"}],
        subtotal=Decimal("60.00"), discount_amount=Decimal("5.00"),
        shipping=Decimal("7.00"), total=Decimal("62.00"),
        stripe_payment_id="cs_shop_mail", status=ShopOrder.Status.PENDING,
    )


def test_paid_order_queues_the_confirmation_email(order, student, django_capture_on_commit_callbacks):
    meta = {"kind": "shop_order", "order_id": str(order.id), "student_id": str(student.id)}
    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed:
        with django_capture_on_commit_callbacks(execute=True):
            result = activate_shop_order_payment(payment_id="pi_mail_1", amount_cents=6200, metadata=meta)
            # DENTRO il blocco: l'email non deve essere ancora accodata, o un
            # rollback manderebbe una ricevuta per un ordine mai pagato.
            assert delayed.call_count == 0

    assert result == "shop_order_activated"
    assert delayed.call_count == 1
    kwargs = delayed.call_args.kwargs
    assert kwargs["key"] == "student.shop_order_confirmed"
    assert kwargs["locale"] == "it"
    assert kwargs["to_email"] == student.user.email
    ctx = kwargs["context"]
    assert ctx["order_number"] == str(order.id)[:8]
    assert ctx["order_total"] == "€62.00"
    assert ctx["order_subtotal"] == "€60.00"
    assert ctx["order_discount"] == "€5.00"
    assert ctx["order_shipping"] == "€7.00"
    assert ctx["order_items"] == "2× Ballet Shoes (38 / Pink)"
    assert ctx["school_name"] == "QA Test School"
    assert "/it/student/shop?for=" in ctx["orders_url"]


def test_a_second_delivery_does_not_send_a_second_receipt(order, student, django_capture_on_commit_callbacks):
    meta = {"kind": "shop_order", "order_id": str(order.id), "student_id": str(student.id)}
    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed:
        with django_capture_on_commit_callbacks(execute=True):
            activate_shop_order_payment(payment_id="pi_mail_2", amount_cents=6200, metadata=meta)
            activate_shop_order_payment(payment_id="pi_mail_2", amount_cents=6200, metadata=meta)
    assert delayed.call_count == 1


@pytest.mark.parametrize("locale", LOCALES)
def test_template_exists_and_renders_in_every_locale(locale):
    template = get_template("student.shop_order_confirmed", locale=locale)
    assert template is not None, f"no shop-order template for {locale}"
    context = {
        "student_first_name": "Maria", "order_number": "7666d20d", "order_date": "07-09-2026",
        "order_items": "2× Ballet Shoes", "order_subtotal": "€60.00", "order_discount": "€5.00",
        "order_shipping": "€7.00", "order_total": "€62.00", "orders_url": "https://x/shop",
    }
    subject = render(template.subject, context)
    body = render(template.body_html, context)
    assert "7666d20d" in subject and "€62.00" in subject
    assert "{{" not in body and "}}" not in body
    assert "https://x/shop" in body
