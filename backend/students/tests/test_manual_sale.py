"""Assign package, reason "sale" (Carlo, 2026-11-01): a package the school
sold in person is a payment too -- one Transaction in Payments / HQ reports,
tied to the credit row; the school can correct or delete it afterwards.
Gifts, corrections and compensations stay credit movements only."""
import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role
from catalog.models import Package
from commerce.models import Transaction
from schools.models import School, SchoolMembership, SchoolStudent
from students.models import ManualCreditGrant, Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()
GRANT = "/api/school/credits/grant/"
TX = "/api/school/transactions/"


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome")


@pytest.fixture
def student(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT])
    s = Student.objects.create(user=user, name="Francesca", school=school, language_preference="it")
    SchoolStudent.objects.get_or_create(school=school, student=s)
    return s


@pytest.fixture
def ten(school):
    return Package.objects.create(school=school, credits=Decimal("10.0"), name_it="Dieci lezioni", name_en="Ten", price=Decimal("150.00"), validity_days=90)


def _client(school, role=Role.SCHOOL):
    user = User.objects.create(email=f"u-{uuid.uuid4().hex[:8]}@example.com", role=role, roles=[role], active_school=school)
    if role == Role.SCHOOL:
        SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    api = APIClient()
    api.force_authenticate(user=user)
    return api


@pytest.fixture
def api(school):
    return _client(school)


def _sale(api, student, ten, **extra):
    body = {
        "student_id": str(student.id), "amount": "10", "reason": "sale", "package_catalog_id": str(ten.id),
        "price": "150", "discount": "10", "payment_method": "cash", "sold_at": "2026-10-20", "note": "pagato in sede",
        **extra,
    }
    return api.post(GRANT, body, format="json")


def test_a_sale_is_a_payment(api, student, ten, school):
    r = _sale(api, student, ten)
    assert r.status_code == 201, r.json()
    tx = Transaction.objects.get(pk=r.json()["transaction_id"])
    grant = ManualCreditGrant.objects.get(student=student)
    assert tx.manual_grant_id == grant.id and tx.school_id == school.id and tx.student_id == student.id
    assert (tx.type, tx.status, tx.payment_method) == ("package", "completed", "cash")
    assert (tx.amount, tx.discount, tx.platform_fee, tx.school_amount) == (Decimal("140.00"), Decimal("10.00"), 0, Decimal("140.00"))
    assert tx.product_id == ten.id and tx.product_name == "Dieci lezioni"
    # dated the day of the sale, in the school's zone
    assert tx.created_at.astimezone(school.tzinfo()).date() == date(2026, 10, 20)
    pkg = StudentPackage.objects.get(student=student)
    assert pkg.purchased_at == tx.created_at
    assert pkg.expires_at.astimezone(school.tzinfo()).date() == date(2026, 10, 20) + timedelta(days=90)
    # the credit row carries what was collected, net of the discount
    assert grant.price == Decimal("140.00") and grant.payment_method == "cash"

    # Payments lists it, with the note and no first-purchase badge missing
    rows = api.get(TX).json()
    assert [row["id"] for row in rows] == [str(tx.id)]
    assert rows[0]["sold_at"] == "2026-10-20"
    assert rows[0]["note"] == "pagato in sede" and rows[0]["manual_grant"] == str(grant.id)
    assert rows[0]["first_purchase"] == "package"


def test_a_sale_needs_price_day_and_method(api, student, ten):
    assert _sale(api, student, ten, price="").json()["error"] == "price_required"
    assert _sale(api, student, ten, price=None).json()["error"] == "price_required"
    assert _sale(api, student, ten, price="12,50").json()["error"] == "price_required"
    assert _sale(api, student, ten, discount="abc").json()["error"] == "invalid_discount"
    assert _sale(api, student, ten, discount="200").json()["error"] == "discount_over_price"
    assert _sale(api, student, ten, payment_method="stripe").json()["error"] == "invalid_payment_method"
    assert _sale(api, student, ten, sold_at="yesterday").json()["error"] == "invalid_sold_at"
    later = (timezone.localdate() + timedelta(days=2)).isoformat()
    assert _sale(api, student, ten, sold_at=later).json()["error"] == "invalid_sold_at"
    # nothing half-written
    assert not StudentPackage.objects.exists() and not ManualCreditGrant.objects.exists() and not Transaction.objects.exists()
    # the day defaults to today
    r = _sale(api, student, ten, sold_at="")
    assert r.status_code == 201, r.json()
    assert Transaction.objects.get().created_at.date() == timezone.localdate()


def test_a_gift_is_not_a_payment(api, student, ten):
    r = api.post(GRANT, {"student_id": str(student.id), "amount": "2", "reason": "gift", "price": "20"}, format="json")
    assert r.status_code == 201, r.json()
    assert "transaction_id" not in r.json()
    assert ManualCreditGrant.objects.count() == 1 and Transaction.objects.count() == 0


def test_the_school_corrects_its_sale(api, student, ten, school):
    tx_id = _sale(api, student, ten).json()["transaction_id"]
    r = api.patch(f"{TX}{tx_id}/", {"sold_at": "2026-10-25", "price": "120", "discount": "0", "payment_method": "bank_transfer", "note": "bonifico"}, format="json")
    assert r.status_code == 200, r.json()
    tx = Transaction.objects.get(pk=tx_id)
    assert (tx.amount, tx.discount, tx.school_amount, tx.payment_method) == (Decimal("120.00"), Decimal("0.00"), Decimal("120.00"), "bank_transfer")
    assert tx.created_at.astimezone(school.tzinfo()).date() == date(2026, 10, 25)
    grant = tx.manual_grant
    assert (grant.price, grant.payment_method, grant.note) == (Decimal("120.00"), "bank_transfer", "bonifico")
    # the package moved with the day: start and expiry five days later, same method
    pkg = StudentPackage.objects.get(student=student)
    assert pkg.purchased_at == tx.created_at and pkg.payment_method == "bank_transfer"
    assert pkg.expires_at.astimezone(school.tzinfo()).date() == date(2026, 10, 25) + timedelta(days=90)
    assert r.json()["note"] == "bonifico" and Decimal(r.json()["amount"]) == Decimal("120.00")

    # only the discount: price and moment stay (the sale keeps its place in
    # the student's history, so her first-purchase badge does not move)
    before = tx.created_at
    api.patch(f"{TX}{tx_id}/", {"discount": "20"}, format="json")
    tx.refresh_from_db()
    assert (tx.amount, tx.discount) == (Decimal("100.00"), Decimal("20.00"))
    assert tx.created_at == before
    assert tx.manual_grant.price == Decimal("100.00")
    assert api.patch(f"{TX}{tx_id}/", {"discount": "500"}, format="json").json()["error"] == "discount_over_price"
    assert api.patch(f"{TX}{tx_id}/", {"payment_method": "paypal"}, format="json").json()["error"] == "invalid_payment_method"


def test_the_school_deletes_its_sale_and_keeps_the_credits(api, student, ten):
    tx_id = _sale(api, student, ten).json()["transaction_id"]
    r = api.delete(f"{TX}{tx_id}/")
    assert r.status_code == 204
    assert not Transaction.objects.filter(pk=tx_id).exists()
    grant = ManualCreditGrant.objects.get(student=student)
    assert grant.price is None  # the credits page stops counting it as revenue
    pkg = StudentPackage.objects.get(student=student)
    assert pkg.status == "active" and pkg.credits_remaining == Decimal("10.0")
    assert api.delete(f"{TX}{tx_id}/").status_code == 404


def test_stripe_payments_and_other_schools_are_locked(api, student, ten, school):
    stripe = Transaction.objects.create(
        school=school, student=student, type="package", product_id=ten.id, product_name="Ten",
        amount=150, school_amount=140, platform_fee=10, payment_method="stripe", status="completed", stripe_payment_id="pi_1",
    )
    assert api.patch(f"{TX}{stripe.id}/", {"price": "1"}, format="json").status_code == 409
    assert api.delete(f"{TX}{stripe.id}/").status_code == 409
    assert Transaction.objects.filter(pk=stripe.id).exists()

    tx_id = _sale(api, student, ten).json()["transaction_id"]
    other = School.objects.create(name="O", slug=f"o-{uuid.uuid4().hex[:8]}", email="o@example.com")
    assert _client(other).delete(f"{TX}{tx_id}/").status_code == 404
    assert Transaction.objects.filter(pk=tx_id).exists()


def test_a_deleted_student_leaves_the_payment_in_the_books(api, student, ten):
    tx_id = _sale(api, student, ten).json()["transaction_id"]
    student.user.delete()  # the student and her credit rows go
    tx = Transaction.objects.get(pk=tx_id)
    assert tx.student_id is None and tx.manual_grant_id is None and tx.amount == Decimal("140.00")
    # no longer editable, like a Stripe row
    assert api.patch(f"{TX}{tx_id}/", {"price": "1"}, format="json").status_code == 409
