"""Both Stripe event destinations post to the same endpoint with their own
signing secret: the platform one (money events) and the Connected accounts one
(account.updated). The view has to accept either signature."""
import hashlib
import hmac
import json
import time

import pytest
from django.urls import reverse

pytestmark = pytest.mark.django_db

PLATFORM_SECRET = "whsec_platform"
CONNECT_SECRET = "whsec_connect"


def _signed(payload: dict, secret: str) -> tuple[bytes, str]:
    body = json.dumps(payload).encode()
    ts = int(time.time())
    signature = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return body, f"t={ts},v1={signature}"


def _post(client, payload, secret):
    body, sig = _signed(payload, secret)
    return client.post(
        reverse("stripe-webhook"), data=body,
        content_type="application/json", HTTP_STRIPE_SIGNATURE=sig,
    )


@pytest.fixture
def both_secrets(settings):
    settings.STRIPE_WEBHOOK_SECRET = PLATFORM_SECRET
    settings.STRIPE_CONNECT_WEBHOOK_SECRET = CONNECT_SECRET


# An unhandled type keeps these tests about signature verification only — the
# per-event handlers have their own tests.
EVENT = {"id": "evt_1", "object": "event", "type": "invoice.upcoming", "data": {"object": {}}}


def test_platform_secret_accepted(client, both_secrets):
    assert _post(client, EVENT, PLATFORM_SECRET).status_code == 200


def test_connect_secret_accepted(client, both_secrets):
    assert _post(client, EVENT, CONNECT_SECRET).status_code == 200


def test_unknown_secret_rejected(client, both_secrets):
    assert _post(client, EVENT, "whsec_someone_else").status_code == 400


def test_connect_destination_not_configured(client, settings):
    """Empty second secret must not become a wildcard that accepts anything."""
    settings.STRIPE_WEBHOOK_SECRET = PLATFORM_SECRET
    settings.STRIPE_CONNECT_WEBHOOK_SECRET = ""
    assert _post(client, EVENT, PLATFORM_SECRET).status_code == 200
    assert _post(client, EVENT, CONNECT_SECRET).status_code == 400


def test_malformed_body_rejected(client, both_secrets):
    ts = int(time.time())
    body = b"not json"
    sig = hmac.new(
        PLATFORM_SECRET.encode(), f"{ts}.".encode() + body, hashlib.sha256
    ).hexdigest()
    response = client.post(
        reverse("stripe-webhook"), data=body,
        content_type="application/json", HTTP_STRIPE_SIGNATURE=f"t={ts},v1={sig}",
    )
    assert response.status_code == 400
