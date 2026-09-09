"""ST-R3-07: the reset page can ask whether the link is still good.

Reopening an already-used link re-drew the "choose a new password" form and
the person only learned it was dead after typing one in and pressing save.
Nothing could answer that question without also spending the link.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db
User = get_user_model()

VALIDATE = "/api/auth/password-reset-validate/"
CONFIRM = "/api/auth/password-reset-confirm/"


@pytest.fixture
def user():
    return User.objects.create_user(
        email=f"reset-{uuid.uuid4().hex[:8]}@example.com", password="OldPassw0rd!2026",
    )


def _link(user):
    return urlsafe_base64_encode(force_bytes(user.pk)), default_token_generator.make_token(user)


def test_a_fresh_link_is_valid(user):
    uid, token = _link(user)
    resp = APIClient().post(VALIDATE, {"uid": uid, "token": token}, format="json")
    assert (resp.status_code, resp.data) == (200, {"valid": True})


def test_asking_does_not_spend_the_link(user):
    """The page asks on every load; the link has to survive being looked at."""
    uid, token = _link(user)
    client = APIClient()
    for _ in range(3):
        assert client.post(VALIDATE, {"uid": uid, "token": token}, format="json").status_code == 200
    assert client.post(
        CONFIRM, {"uid": uid, "token": token, "new_password": "QaRound3!2027"}, format="json",
    ).status_code == 200


def test_a_used_link_is_refused(user):
    uid, token = _link(user)
    client = APIClient()
    assert client.post(
        CONFIRM, {"uid": uid, "token": token, "new_password": "QaRound3!2027"}, format="json",
    ).status_code == 200

    resp = client.post(VALIDATE, {"uid": uid, "token": token}, format="json")
    assert resp.status_code == 400
    assert resp.data["error"] == "invalid_or_expired_token"


def test_the_two_endpoints_agree_on_a_broken_link(user):
    """Same verdict from the same helper — the page must not draw a form the
    submit is going to refuse, nor refuse one the submit would accept."""
    client = APIClient()
    uid, token = _link(user)
    for payload in (
        {"uid": "not-base64!!", "token": token},
        {"uid": urlsafe_base64_encode(force_bytes(uuid.uuid4())), "token": token},
        {"uid": uid, "token": "wrong-token"},
    ):
        validate = client.post(VALIDATE, payload, format="json")
        confirm = client.post(CONFIRM, {**payload, "new_password": "QaRound3!2027"}, format="json")
        assert validate.status_code == confirm.status_code == 400
        assert validate.data["error"] == confirm.data["error"]


def test_a_missing_uid_or_token_is_a_broken_link(user):
    client = APIClient()
    uid, token = _link(user)
    assert client.post(VALIDATE, {"uid": uid}, format="json").data["error"] == "invalid_link"
    assert client.post(VALIDATE, {"token": token}, format="json").data["error"] == "invalid_link"
