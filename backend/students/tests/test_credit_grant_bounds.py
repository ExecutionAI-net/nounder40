"""QA M-3: POST /api/school/credits/grant/ let an `amount` past what
StudentPackage.credits_total/credits_remaining and ManualCreditGrant.amount
(both DecimalField(max_digits=6, decimal_places=1), max representable value
99999.9) can hold, so anything >= 100000 hit the DB and surfaced as an
unhandled 500 instead of a clean validation error."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from schools.models import School, SchoolMembership, SchoolStudent
from students.models import ManualCreditGrant, Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def student(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT])
    student = Student.objects.create(user=user, name="Allieva", school=school)
    SchoolStudent.objects.get_or_create(school=school, student=student)
    return student


@pytest.fixture
def admin_client(school):
    admin = User.objects.create(
        email=f"adm-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    SchoolMembership.objects.create(profile=admin, school=school, sub_role="owner")
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


def test_amount_at_100000_is_rejected_cleanly(admin_client, student):
    resp = admin_client.post("/api/school/credits/grant/", {
        "student_id": str(student.id), "amount": "100000", "reason": "test",
    }, format="json")
    assert resp.status_code == 400
    assert resp.json()["error"] == "amount_too_large"
    assert not StudentPackage.objects.filter(student=student).exists()
    assert not ManualCreditGrant.objects.filter(student=student).exists()


def test_amount_far_above_the_field_limit_is_rejected_cleanly(admin_client, student):
    resp = admin_client.post("/api/school/credits/grant/", {
        "student_id": str(student.id), "amount": "999999999", "reason": "test",
    }, format="json")
    assert resp.status_code == 400
    assert resp.json()["error"] == "amount_too_large"


def test_amount_at_the_field_boundary_still_works(admin_client, student):
    # 99999.9 is what the DecimalField can hold, but it is not a half-credit
    # multiple (QA R2-L11c), so the largest grantable amount is 99999.5.
    resp = admin_client.post("/api/school/credits/grant/", {
        "student_id": str(student.id), "amount": "99999.5", "reason": "test",
    }, format="json")
    assert resp.status_code == 201, resp.content
    pkg = StudentPackage.objects.get(student=student)
    assert float(pkg.credits_total) == 99999.5


def test_half_credits_are_accepted(admin_client, student):
    resp = admin_client.post("/api/school/credits/grant/", {
        "student_id": str(student.id), "amount": "0.5", "reason": "test",
    }, format="json")
    assert resp.status_code == 201, resp.content
    assert float(StudentPackage.objects.get(student=student).credits_total) == 0.5


@pytest.mark.parametrize("amount", ["0.3", "0.7", "1.2", "2.9"])
def test_an_amount_off_the_half_credit_step_is_refused(admin_client, student, amount):
    # QA R2-L11c: the DecimalField keeps one decimal place, so the DB would
    # happily store 0.3. The half-credit rule (CLAUDE.md 4.2) lives in the view.
    resp = admin_client.post("/api/school/credits/grant/", {
        "student_id": str(student.id), "amount": amount, "reason": "test",
    }, format="json")
    assert resp.status_code == 400
    assert resp.json()["error"] == "amount_not_half_credit_step"
    assert not StudentPackage.objects.filter(student=student).exists()
    assert not ManualCreditGrant.objects.filter(student=student).exists()
