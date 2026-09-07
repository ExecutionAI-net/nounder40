"""QA M-5: `DiscountCode.value` had no range check tied to `type`. A
"percentage" code could be saved with e.g. value=500, which `resolve_discount`
would then treat as a 500% discount before clamping the *result* to the line
total -- functionally harmless per-purchase, but wrong data and confusing
everywhere it's displayed as "% off". Fixed in DiscountCodeSerializer.validate()."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from commerce.models import DiscountCode
from schools.models import School

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def hq_client():
    user = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ])
    api = APIClient()
    api.force_authenticate(user=user)
    return api


def test_percentage_over_100_is_rejected(hq_client):
    resp = hq_client.post("/api/hq/discount-codes/", {
        "name": "Bad", "code": f"BAD{uuid.uuid4().hex[:4]}", "type": "percentage", "value": "150",
    }, format="json")
    assert resp.status_code == 400
    assert "value" in resp.json()
    assert not DiscountCode.objects.filter(code__startswith="BAD").exists()


def test_percentage_of_zero_is_rejected(hq_client):
    resp = hq_client.post("/api/hq/discount-codes/", {
        "name": "Bad", "code": f"BAD{uuid.uuid4().hex[:4]}", "type": "percentage", "value": "0",
    }, format="json")
    assert resp.status_code == 400
    assert "value" in resp.json()


def test_percentage_of_100_is_accepted(hq_client):
    resp = hq_client.post("/api/hq/discount-codes/", {
        "name": "Full", "code": f"FULL{uuid.uuid4().hex[:4]}", "type": "percentage", "value": "100",
    }, format="json")
    assert resp.status_code == 201, resp.content
    assert float(DiscountCode.objects.get(pk=resp.json()["id"]).value) == 100.0


def test_negative_fixed_value_is_rejected(hq_client):
    resp = hq_client.post("/api/hq/discount-codes/", {
        "name": "Bad", "code": f"BAD{uuid.uuid4().hex[:4]}", "type": "fixed", "value": "-5",
    }, format="json")
    assert resp.status_code == 400
    assert "value" in resp.json()


def test_positive_fixed_value_still_works(hq_client):
    resp = hq_client.post("/api/hq/discount-codes/", {
        "name": "Ok", "code": f"OK{uuid.uuid4().hex[:4]}", "type": "fixed", "value": "20",
    }, format="json")
    assert resp.status_code == 201, resp.content


def test_percentage_over_100_rejected_on_patch(hq_client):
    code = DiscountCode.objects.create(name="Promo", code="PROMO1", type="percentage", value=10)
    resp = hq_client.patch(f"/api/hq/discount-codes/{code.id}/", {"value": "200"}, format="json")
    assert resp.status_code == 400
    code.refresh_from_db()
    assert float(code.value) == 10.0
