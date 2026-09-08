"""R3-M6 (QA_REGRESSION_ROUND3_SCHOOL.md SCH-R3-04 + SCH-R3-08):
re-posting a compensation payment replaced a settled record.

`POST /api/school/compensation-summary/` was a blind `update_or_create` whose
defaults read every field off the body with `or ""` / `or 0` / `or None`. A
second POST for the same teacher and month therefore *replaced* the record:

    POST {amount: 44, status: pending, payment_method: bank_transfer,
          note: "QA R3 settembre"}          -> 201
    PATCH .../compensation-payments/<id>/ {status: paid}  -> 200
    POST {amount: 50, status: paid}         -> 201, same id,
                                               amount 50, note "", method ""

— a settled financial record altered and its metadata wiped, with no trace.
`paid_at` stayed `null` even on a `paid` row: the one field that makes it an
accounting entry was the one nobody wrote. And `amount: -5` / `amount: 0`
were both accepted (SCH-R3-08).

The UI legitimately re-posts here (correct an amount, flip a row back to
pending), so refusing outright would break the product. The write is explicit
instead: fields the caller did not send keep the value they had.
"""
import uuid
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from schools.models import School, SchoolMembership, SchoolRole
from teachers.models import Teacher, TeacherCompensationPayment, TeacherSchool

pytestmark = pytest.mark.django_db
User = get_user_model()
MONTH = "2026-09"


@pytest.fixture
def school():
    for key, label in (("owner", "Titolare"), ("admin", "Amministratore"), ("staff", "Staff")):
        SchoolRole.objects.update_or_create(
            key=key, defaults={"label": label, "builtin": True, "permissions": ["compensation"]}
        )
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com", active=True
    )


@pytest.fixture
def owner_client(school):
    user = User.objects.create(
        email=f"own-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


@pytest.fixture
def teacher(school):
    email = f"t-{uuid.uuid4().hex[:8]}@example.com"
    user = User.objects.create(email=email, role=Role.TEACHER, roles=[Role.TEACHER])
    obj = Teacher.objects.create(user=user, name="QA Teacher", email=email)
    TeacherSchool.objects.create(teacher=obj, school=school, active=True)
    return obj


def _post(client, teacher, **body):
    return client.post(
        "/api/school/compensation-summary/",
        {"teacher_id": str(teacher.id), "month": MONTH, **body},
        format="json",
    )


# --- SCH-R3-04: a re-post must not wipe the record ---------------------------


def test_a_second_post_keeps_the_note_and_method_it_was_not_given(owner_client, teacher):
    """The exact live sequence."""
    first = _post(owner_client, teacher, amount=44, status="pending",
                  payment_method="bank_transfer", note="QA R3 settembre")
    assert first.status_code == 201, first.content

    second = _post(owner_client, teacher, amount=50, status="paid")

    assert second.status_code == 200, second.content
    payment = TeacherCompensationPayment.objects.get(teacher=teacher)
    assert payment.amount == Decimal("50.00")
    assert payment.note == "QA R3 settembre"
    assert payment.payment_method == "bank_transfer"


def test_an_explicitly_sent_empty_note_still_clears_it(owner_client, teacher):
    """Keeping what wasn't sent must not mean "you can never clear a field"."""
    _post(owner_client, teacher, amount=44, status="pending", note="typo")

    _post(owner_client, teacher, amount=44, status="pending", note="")

    payment = TeacherCompensationPayment.objects.get(teacher=teacher)
    assert payment.note == ""


def test_the_first_post_creates_and_a_second_updates(owner_client, teacher):
    assert _post(owner_client, teacher, amount=10, status="pending").status_code == 201
    assert _post(owner_client, teacher, amount=20, status="pending").status_code == 200
    assert TeacherCompensationPayment.objects.filter(teacher=teacher).count() == 1


# --- paid_at ------------------------------------------------------------------


def test_marking_paid_records_when(owner_client, teacher):
    """`paid_at` stayed null on a `paid` row — the field that makes it an
    accounting entry."""
    resp = _post(owner_client, teacher, amount=44, status="paid")

    assert resp.status_code == 201, resp.content
    payment = TeacherCompensationPayment.objects.get(teacher=teacher)
    assert payment.paid_at is not None


def test_an_explicit_paid_date_wins(owner_client, teacher):
    resp = _post(owner_client, teacher, amount=44, status="paid", paid_date="2026-09-03")

    assert resp.status_code == 201, resp.content
    payment = TeacherCompensationPayment.objects.get(teacher=teacher)
    assert payment.paid_at.date().isoformat() == "2026-09-03"


def test_a_malformed_paid_date_is_a_400_not_a_500(owner_client, teacher):
    resp = _post(owner_client, teacher, amount=44, status="paid", paid_date="not-a-date")
    assert resp.status_code == 400, resp.content


def test_flipping_back_to_pending_clears_the_settlement_date(owner_client, teacher):
    _post(owner_client, teacher, amount=44, status="paid")

    _post(owner_client, teacher, amount=44, status="pending")

    payment = TeacherCompensationPayment.objects.get(teacher=teacher)
    assert payment.status == "pending"
    assert payment.paid_at is None


def test_re_marking_paid_keeps_the_original_settlement_date(owner_client, teacher):
    _post(owner_client, teacher, amount=44, status="paid", paid_date="2026-09-03")

    _post(owner_client, teacher, amount=50, status="paid")

    payment = TeacherCompensationPayment.objects.get(teacher=teacher)
    assert payment.paid_at.date().isoformat() == "2026-09-03"


# --- SCH-R3-08: amount range --------------------------------------------------


def test_a_negative_amount_is_refused(owner_client, teacher):
    resp = _post(owner_client, teacher, amount=-5, status="pending")
    assert resp.status_code == 400, resp.content
    assert resp.json()["error"] == "amount_negative"
    assert not TeacherCompensationPayment.objects.filter(teacher=teacher).exists()


def test_a_zero_paid_amount_is_refused(owner_client, teacher):
    resp = _post(owner_client, teacher, amount=0, status="paid")
    assert resp.status_code == 400, resp.content
    assert resp.json()["error"] == "amount_required"


def test_a_zero_pending_placeholder_is_still_allowed(owner_client, teacher):
    """A teacher with no lessons this month computes to 0; the row must still
    be markable pending, which is what the UI does on every load."""
    resp = _post(owner_client, teacher, amount=0, status="pending")
    assert resp.status_code == 201, resp.content


def test_a_nan_amount_is_refused(owner_client, teacher):
    """`Decimal("NaN")` compares False against every bound, so a plain
    `amount <= 0` check waves it straight through."""
    resp = _post(owner_client, teacher, amount="NaN", status="paid")
    assert resp.status_code == 400, resp.content
    assert not TeacherCompensationPayment.objects.filter(teacher=teacher).exists()


def test_a_non_numeric_amount_is_a_400_not_a_500(owner_client, teacher):
    resp = _post(owner_client, teacher, amount="abc", status="pending")
    assert resp.status_code == 400, resp.content


# --- unchanged guards ---------------------------------------------------------


def test_a_teacher_from_another_school_is_still_refused(owner_client):
    other = School.objects.create(
        name="O", slug=f"o-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com"
    )
    email = f"x-{uuid.uuid4().hex[:8]}@example.com"
    user = User.objects.create(email=email, role=Role.TEACHER, roles=[Role.TEACHER])
    stranger = Teacher.objects.create(user=user, name="Stranger", email=email)
    TeacherSchool.objects.create(teacher=stranger, school=other, active=True)

    resp = _post(owner_client, stranger, amount=10, status="pending")

    assert resp.status_code == 404, resp.content
