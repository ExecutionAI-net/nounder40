"""Payments showed "10 Credits Pack (copy)" for a package the school had
renamed "Clase Suelta Presencial": Transaction.product_name froze the
English name at purchase time, whatever the viewer's or the buyer's language
(Barcelona, 16/09/2026). Now the rows carry the package's live translations
and the purchase stores the buyer's own language."""
import uuid
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import HQMember, Role
from catalog.models import Package
from commerce.models import Transaction
from commerce.services import activate_package_payment
from schools.models import School
from students.models import Student

pytestmark = pytest.mark.django_db
User = get_user_model()


def _school():
    return School.objects.create(name="Barcelona", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True)


def _package(school):
    return Package.objects.create(
        school=school, name_en="10 Credits Pack (copy)", name_it="Lezione Sala Singola", name_es="Clase Suelta Presencial",
        credits=Decimal("20"), price=Decimal("18.97"), validity_days=30, active=True,
    )


def _hq_client():
    user = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role="owner")
    HQMember.objects.create(user=user, email=user.email, name="QA", sub_role="owner", active=True)
    api = APIClient()
    api.force_authenticate(user)
    return api


def test_rows_carry_the_live_package_translations(django_assert_num_queries):
    school = _school()
    package = _package(school)
    tx = Transaction.objects.create(school=school, type="package", product_id=package.id, product_name="10 Credits Pack (copy)", amount=Decimal("18.97"), status="completed")
    shop = Transaction.objects.create(school=school, type="shop", product_id=uuid.uuid4(), product_name="T-shirt", amount=Decimal("20"), status="completed")
    for _ in range(3):  # more package rows must not mean more queries
        Transaction.objects.create(school=school, type="subscription", product_id=package.id, product_name="x", amount=Decimal("1"), status="completed")

    res = _hq_client().get("/api/hq/transactions/", {"school": str(school.id)})
    assert res.status_code == 200, res.content
    rows = {r["id"]: r for r in res.json()}
    assert rows[str(tx.id)]["product_names"] == {
        "name_it": "Lezione Sala Singola", "name_en": "10 Credits Pack (copy)", "name_fr": "", "name_es": "Clase Suelta Presencial",
    }
    assert rows[str(tx.id)]["product_name"] == "10 Credits Pack (copy)"  # still there as the fallback
    assert rows[str(shop.id)]["product_names"] is None

    from commerce.report_views import _serialize_transactions

    # the rows, then the packages: one query for every package, not one per row
    with django_assert_num_queries(2):
        _serialize_transactions(Transaction.objects.filter(school=school).select_related("school", "student"))


def test_deleted_package_falls_back_to_the_frozen_name():
    school = _school()
    tx = Transaction.objects.create(school=school, type="package", product_id=uuid.uuid4(), product_name="Old pack", amount=Decimal("10"), status="completed")
    res = _hq_client().get("/api/hq/transactions/", {"school": str(school.id)})
    row = next(r for r in res.json() if r["id"] == str(tx.id))
    assert row["product_names"] is None and row["product_name"] == "Old pack"


def test_purchase_stores_the_name_in_the_buyers_language():
    school = _school()
    package = _package(school)
    user = User.objects.create(email="carol@example.com", role=Role.STUDENT, roles=[Role.STUDENT], language_preference="es")
    student = Student.objects.create(user=user, first_name="Carol", last_name="Salcedo", email=user.email, language_preference="es", school=school)

    with patch("commerce.services.notify_after_purchase", create=True), patch("commerce.services.mark_redeemed", create=True):
        outcome = activate_package_payment(
            payment_id="pi_test_1", amount_cents=1897,
            metadata={"kind": "package", "school_id": str(school.id), "student_id": str(student.id), "item_id": str(package.id)},
        )
    assert outcome not in ("missing_refs", "not_a_package_payment", "no_payment_id"), outcome
    assert Transaction.objects.get(stripe_payment_id="pi_test_1").product_name == "Clase Suelta Presencial"
