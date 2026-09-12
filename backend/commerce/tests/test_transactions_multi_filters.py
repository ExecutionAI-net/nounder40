"""R4-L6 / I18N-R4-14 (Carlo's rule: filters are multi-select): the HQ
transactions endpoint took one `status` and one `school`; the page now sends
comma-separated lists."""
import uuid
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import HQMember, Role
from commerce.models import Transaction
from schools.models import School

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def hq_client():
    user = User.objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role="owner"
    )
    HQMember.objects.create(user=user, email=user.email, name="QA", sub_role="owner", active=True)
    api = APIClient()
    api.force_authenticate(user)
    return api


def _school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True)


def _rows(resp):
    body = resp.json()
    return body["results"] if isinstance(body, dict) and "results" in body else body


def test_status_accepts_a_comma_separated_list(hq_client):
    school = _school()
    done = Transaction.objects.create(school=school, amount=Decimal("10"), status="completed")
    pend = Transaction.objects.create(school=school, amount=Decimal("10"), status="pending")
    Transaction.objects.create(school=school, amount=Decimal("10"), status="failed")

    resp = hq_client.get("/api/hq/transactions/", {"status": "completed,pending", "school": str(school.id)})

    assert resp.status_code == 200, resp.content
    assert {r["id"] for r in _rows(resp)} == {str(done.id), str(pend.id)}


def test_school_accepts_a_comma_separated_list(hq_client):
    a, b, c = _school(), _school(), _school()
    ta = Transaction.objects.create(school=a, amount=Decimal("10"), status="completed")
    tb = Transaction.objects.create(school=b, amount=Decimal("10"), status="completed")
    Transaction.objects.create(school=c, amount=Decimal("10"), status="completed")

    resp = hq_client.get("/api/hq/transactions/", {"school": f"{a.id},{b.id}"})

    assert resp.status_code == 200, resp.content
    ids = {r["id"] for r in _rows(resp)}
    assert {str(ta.id), str(tb.id)} <= ids and str(c.id) not in {r.get("school") for r in _rows(resp)}


def test_a_single_value_still_works(hq_client):
    school = _school()
    done = Transaction.objects.create(school=school, amount=Decimal("10"), status="completed")
    Transaction.objects.create(school=school, amount=Decimal("10"), status="pending")
    resp = hq_client.get("/api/hq/transactions/", {"status": "completed", "school": str(school.id)})
    assert [r["id"] for r in _rows(resp)] == [str(done.id)]


def test_a_bad_school_id_in_the_list_is_a_400(hq_client):
    assert hq_client.get("/api/hq/transactions/", {"school": f"{uuid.uuid4()},nope"}).status_code == 400
