"""Regression test for QA_REGRESSION_ROUND2 R2-C4 (frontend-wiring half):

The shop's Stripe Checkout success_url carried no `session_id`, so
`frontend/src/app/[locale]/student/shop/page.tsx` had nothing to call
`verify-session` with on return — a paid shop order stayed `pending` forever
unless the webhook happened to fire (measured 0-for-7 on dev). Mirrors how
the package checkout's success_url already worked
(`stripe_views.py::CheckoutView`'s `default_success`).
"""
import uuid
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from commerce.models import ShopProduct
from schools.models import School
from students.models import Student

pytestmark = pytest.mark.django_db


@pytest.fixture
def school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        stripe_account_id="acct_x", stripe_onboarding_complete=True,
        platform_fee_percentage=Decimal("10"),
    )


@pytest.fixture
def product(school):
    return ShopProduct.objects.create(school=school, name="Tights", price=Decimal("12.00"), active=True)


@pytest.fixture
def api_client(school):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    Student.objects.create(user=user, name="Stu", school=school)
    api = APIClient()
    api.force_authenticate(user=user)
    return api


class _FakeSession:
    id = "cs_test_shop_1"
    url = "https://checkout.stripe.com/pay/cs_test_shop_1"


def test_shop_checkout_success_url_carries_session_id_placeholder(api_client, product):
    with patch("stripe.checkout.Session.create", return_value=_FakeSession()) as create:
        res = api_client.post(
            "/api/student/shop/checkout/",
            {"items": [{"product_id": str(product.id), "qty": 1}]},
            format="json",
        )
    assert res.status_code == 201, res.json()
    kwargs = create.call_args.kwargs
    assert "session_id={CHECKOUT_SESSION_ID}" in kwargs["success_url"]
    assert kwargs["success_url"].startswith("http")
    assert "payment=success" in kwargs["success_url"]
