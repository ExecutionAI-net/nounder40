"""R4-L7 (QA_REGRESSION_ROUND4 SCH-R4-02): the plain compensation-payment
viewset stored `status: "weird2"`, `amount: -3` and a paid row with no
`paid_at`, while the summary endpoint the UI uses refused all three.
"""
import uuid
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from schools.models import School, SchoolMembership, SchoolRole
from teachers.models import Teacher, TeacherCompensationPayment, TeacherSchool

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    SchoolRole.objects.update_or_create(
        key="owner", defaults={"label": "Owner", "builtin": True, "permissions": ["teachers", "payments", "compensation"]}
    )
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True)


@pytest.fixture
def owner_client(school):
    user = User.objects.create(
        email=f"own-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    api = APIClient()
    api.force_authenticate(user)
    return api


@pytest.fixture
def payment(school):
    t = Teacher.objects.create(name="T", first_name="T", last_name="One", email=f"t-{uuid.uuid4().hex[:6]}@example.com")
    TeacherSchool.objects.create(teacher=t, school=school, active=True)
    return TeacherCompensationPayment.objects.create(school=school, teacher=t, month="2026-09", amount=Decimal("44"), status="pending")


def test_viewset_refuses_a_made_up_status(owner_client, payment):
    resp = owner_client.patch(f"/api/school/compensation-payments/{payment.pk}/", {"status": "weird2"}, format="json")
    assert resp.status_code == 400, resp.content
    payment.refresh_from_db()
    assert payment.status == "pending"


def test_viewset_refuses_a_negative_amount(owner_client, payment):
    resp = owner_client.patch(f"/api/school/compensation-payments/{payment.pk}/", {"amount": "-3"}, format="json")
    assert resp.status_code == 400, resp.content
    payment.refresh_from_db()
    assert payment.amount == Decimal("44")


def test_viewset_marking_paid_stamps_paid_at(owner_client, payment):
    resp = owner_client.patch(f"/api/school/compensation-payments/{payment.pk}/", {"status": "paid"}, format="json")
    assert resp.status_code == 200, resp.content
    payment.refresh_from_db()
    assert payment.status == "paid" and payment.paid_at is not None


def test_viewset_back_to_pending_clears_paid_at(owner_client, payment):
    owner_client.patch(f"/api/school/compensation-payments/{payment.pk}/", {"status": "paid"}, format="json")
    resp = owner_client.patch(f"/api/school/compensation-payments/{payment.pk}/", {"status": "pending"}, format="json")
    assert resp.status_code == 200, resp.content
    payment.refresh_from_db()
    assert payment.paid_at is None


def test_summary_post_refuses_a_made_up_status(owner_client, payment):
    resp = owner_client.post(
        "/api/school/compensation-summary/",
        {"teacher_id": str(payment.teacher_id), "month": "2026-09", "amount": 44, "status": "weird"},
        format="json",
    )
    assert resp.status_code == 400, resp.content
    assert resp.json()["error"] == "invalid_status"
    payment.refresh_from_db()
    assert payment.status == "pending"
