"""Password reset confirm: the contract the reset page relies on. A fresh
password signs the user in (tokens + profile in the response, no extra
/auth/me/ round-trip), and every failure carries a machine-readable `error`
so the page can say what actually went wrong."""
import pytest
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient

from accounts.models import User

pytestmark = pytest.mark.django_db

URL = "/api/auth/password-reset-confirm/"


def _link_for(user):
    return {"uid": urlsafe_base64_encode(force_bytes(user.pk)), "token": default_token_generator.make_token(user)}


@pytest.fixture
def user():
    return User.objects.create_user("alina@example.com", "Old-passw0rd", full_name="Alina Test")


def test_new_password_signs_the_user_in(user):
    res = APIClient().post(URL, {**_link_for(user), "new_password": "Danza-2026"}, format="json")
    assert res.status_code == 200, res.data
    assert res.data["access"] and res.data["refresh"]
    assert res.data["user"]["email"] == "alina@example.com"
    assert "roles" in res.data["user"]
    user.refresh_from_db()
    assert user.check_password("Danza-2026")


def test_link_is_single_use(user):
    link = _link_for(user)
    assert APIClient().post(URL, {**link, "new_password": "Danza-2026"}, format="json").status_code == 200
    res = APIClient().post(URL, {**link, "new_password": "Other-pass1"}, format="json")
    assert res.status_code == 400
    assert res.data["error"] == "invalid_or_expired_token"


def test_garbled_uid_is_an_invalid_link(user):
    res = APIClient().post(URL, {"uid": "not-a-uid", "token": "x-y", "new_password": "Alina1812"}, format="json")
    assert res.status_code == 400
    assert res.data["error"] == "invalid_link"


def test_rejected_password_says_why_and_keeps_the_old_one(user):
    res = APIClient().post(URL, {**_link_for(user), "new_password": "12345678"}, format="json")
    assert res.status_code == 400
    assert res.data["error"] == "weak_password"
    assert "password_entirely_numeric" in res.data["codes"]
    assert res.data["detail"]  # English fallback when the page knows no code
    user.refresh_from_db()
    assert user.check_password("Old-passw0rd")


def test_name_plus_digits_is_refused_as_too_similar(user):
    # The production case: Alina chose "Alina1812", the page said nothing and
    # sent her to log in with a password that was never saved.
    res = APIClient().post(URL, {**_link_for(user), "new_password": "Alina1812"}, format="json")
    assert res.status_code == 400
    assert res.data["error"] == "weak_password"
    assert res.data["codes"] == ["password_too_similar"]
