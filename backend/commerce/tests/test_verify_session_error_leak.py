"""R2-L5d: `GET /api/stripe/verify-session/?session_id=x` answered **502**
with the raw exception in the body:

    {"error":"stripe_retrieve_failed",
     "detail":"InvalidRequestError: Request req_…: No such checkout.session: x
               @ _api_requestor.py:367 … — da stripe_views.py:220 in _get"}

which handed the caller Stripe's request id, the Stripe SDK internals and our
own file names and line numbers. The detail now goes to the logger only (and
so to Sentry), the client keeps the stable machine-readable `error` code plus
a `reference` to correlate with the log line, and an unknown/invalid
`session_id` is a 404 (client error) instead of a 502 — 502 stays for Stripe
actually being unreachable.
"""
import uuid
from unittest.mock import patch

import pytest
import stripe
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from schools.models import School
from students.models import Student

pytestmark = pytest.mark.django_db

_LEAKY_MESSAGE = "Request req_HAPWd1JlXuq4X0: No such checkout.session: x"


@pytest.fixture
def api_client():
    school = School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com"
    )
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    Student.objects.create(user=user, name="Stu", school=school)
    api = APIClient()
    api.force_authenticate(user=user)
    return api


def _assert_no_leak(body):
    blob = str(body)
    assert "detail" not in body
    assert "req_" not in blob
    assert ".py:" not in blob
    assert "checkout.session" not in blob
    assert "InvalidRequestError" not in blob


def test_unknown_session_id_is_404_and_leaks_nothing(api_client):
    exc = stripe.error.InvalidRequestError(_LEAKY_MESSAGE, param="session_id")
    with patch("stripe.checkout.Session.retrieve", side_effect=exc):
        res = api_client.get("/api/stripe/verify-session/?session_id=x")

    assert res.status_code == 404
    body = res.json()
    assert body["error"] == "stripe_session_not_found"
    assert body["reference"]
    _assert_no_leak(body)


def test_unknown_session_detail_goes_to_the_server_log(api_client, caplog):
    exc = stripe.error.InvalidRequestError(_LEAKY_MESSAGE, param="session_id")
    with caplog.at_level("ERROR", logger="commerce.stripe_views"):
        with patch("stripe.checkout.Session.retrieve", side_effect=exc):
            res = api_client.get("/api/stripe/verify-session/?session_id=x")

    reference = res.json()["reference"]
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert reference in logged
    assert "req_HAPWd1JlXuq4X0" in logged


def test_stripe_unreachable_is_still_502(api_client):
    exc = stripe.error.APIConnectionError("connection refused")
    with patch("stripe.checkout.Session.retrieve", side_effect=exc):
        res = api_client.get("/api/stripe/verify-session/?session_id=cs_test_1")

    assert res.status_code == 502
    body = res.json()
    assert body["error"] == "stripe_unreachable"
    _assert_no_leak(body)


def test_unexpected_retrieve_failure_is_502_without_detail(api_client):
    with patch("stripe.checkout.Session.retrieve", side_effect=RuntimeError(_LEAKY_MESSAGE)):
        res = api_client.get("/api/stripe/verify-session/?session_id=cs_test_1")

    assert res.status_code == 502
    body = res.json()
    assert body["error"] == "stripe_retrieve_failed"
    _assert_no_leak(body)


def test_activation_failure_does_not_leak_either(api_client):
    """La seconda strada verso l'accredito: stesso trattamento."""
    class _Session:
        status = "complete"
        payment_status = "paid"
        metadata = {}

    with patch("stripe.checkout.Session.retrieve", return_value=_Session()), \
            patch(
                "commerce.stripe_views.VerifySessionView._activate",
                side_effect=RuntimeError(_LEAKY_MESSAGE),
            ):
        res = api_client.get("/api/stripe/verify-session/?session_id=cs_test_1")

    assert res.status_code == 502
    body = res.json()
    assert body["error"] == "activation_failed"
    _assert_no_leak(body)


def test_missing_session_id_still_400(api_client):
    res = api_client.get("/api/stripe/verify-session/")
    assert res.status_code == 400
    assert res.json()["error"] == "session_id required"
