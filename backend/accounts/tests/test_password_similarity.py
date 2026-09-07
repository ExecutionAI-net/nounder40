"""QA R2-M17: `AUTH_PASSWORD_VALIDATORS` had no similarity check at all, so
`qa-r2-student-s2` was a valid password for qa-r2-student-s2@uberip.com.

Django's own `UserAttributeSimilarityValidator` was not the answer: 89e9059
had removed it on purpose after a production complaint (name+digits, see
accounts/tests/test_password_reset.py), and putting it back would refuse
"Alina1812" all over again. `accounts.validators.EmailSimilarityValidator`
closes the reported hole without reopening that one — it compares against the
e-mail only, and only for equality once case and punctuation are normalised.

Wiring it into settings was only half the fix: `RegisterSerializer`
and `ChangePasswordSerializer` passed `validate_password` as a bare DRF field
validator, which calls it with `user=None` — the similarity check silently
does nothing without a user. Both now run it against the identity in play.
`password_reset_confirm_view` and `complete_invite_view` already passed
`user=`, so they only needed the settings entry.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient

from accounts.models import Role
from accounts.serializers import RegisterSerializer

pytestmark = pytest.mark.django_db
User = get_user_model()

GOOD_PASSWORD = "Bq4!lantern-Studio"


def _payload(local_part, password):
    return {
        "email": f"{local_part}@example.com", "password": password,
        "first_name": "Qa", "last_name": "Tester", "phone": "+390123456789",
    }


# --- register --------------------------------------------------------------

# RegisterView is throttled at 5/hour and the throttle history is shared by
# the whole suite, so these go through the serializer -- as accounts/tests/
# test_register.py already does. The HTTP path was verified by hand
# (POST /api/auth/register/ -> 400 {"password": ["The password is too
# similar to the email."]}).

def test_register_rejects_a_password_equal_to_the_email_local_part():
    local = f"qa-sim-{uuid.uuid4().hex[:8]}"
    serializer = RegisterSerializer(data=_payload(local, local))
    assert not serializer.is_valid()
    assert "password" in serializer.errors
    assert not User.objects.filter(email=f"{local}@example.com").exists()


def test_register_rejects_the_email_local_part_however_it_is_punctuated():
    # Uppercase and separators add no secret: "Qa-Sim-1a2b3c4d" is the same
    # thing as the local part it copies.
    local = f"qa-sim-{uuid.uuid4().hex[:8]}"
    serializer = RegisterSerializer(data=_payload(local, local.replace("-", "").upper()))
    assert not serializer.is_valid()
    assert "password" in serializer.errors


def test_register_still_accepts_a_name_based_password():
    # 89e9059's case: the surname is never compared, so name+digits passes.
    local = f"qa-sim-{uuid.uuid4().hex[:8]}"
    serializer = RegisterSerializer(data=_payload(local, "Tester2026"))
    assert serializer.is_valid(), serializer.errors


def test_register_still_accepts_an_unrelated_password():
    local = f"qa-sim-{uuid.uuid4().hex[:8]}"
    serializer = RegisterSerializer(data=_payload(local, GOOD_PASSWORD))
    assert serializer.is_valid(), serializer.errors
    assert serializer.save().check_password(GOOD_PASSWORD)


# --- password reset confirm ------------------------------------------------

def _reset_link(user):
    return urlsafe_base64_encode(force_bytes(user.pk)), default_token_generator.make_token(user)


def test_password_reset_confirm_rejects_a_password_similar_to_the_email():
    local = f"qa-sim-{uuid.uuid4().hex[:8]}"
    user = User.objects.create(email=f"{local}@example.com", role=Role.STUDENT, roles=[Role.STUDENT])
    user.set_password(GOOD_PASSWORD)
    user.save()
    uid, token = _reset_link(user)

    resp = APIClient().post(
        "/api/auth/password-reset-confirm/",
        {"uid": uid, "token": token, "new_password": local}, format="json",
    )
    assert resp.status_code == 400, resp.content
    body = resp.json()
    # The reset page translates these codes; `password_too_similar` could
    # never fire before this fix.
    assert body["error"] == "weak_password"
    assert "password_too_similar" in body["codes"]


def test_password_reset_confirm_still_accepts_an_unrelated_password():
    user = User.objects.create(
        email=f"qa-sim-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT]
    )
    user.set_password("Zt7#waltz-Perimeter")
    user.save()
    uid, token = _reset_link(user)

    resp = APIClient().post(
        "/api/auth/password-reset-confirm/",
        {"uid": uid, "token": token, "new_password": GOOD_PASSWORD}, format="json",
    )
    assert resp.status_code == 200, resp.content
    user.refresh_from_db()
    assert user.check_password(GOOD_PASSWORD)


# --- change password -------------------------------------------------------

def _authed(user):
    api = APIClient()
    api.force_authenticate(user=user)
    return api


def test_change_password_rejects_a_password_similar_to_the_email():
    local = f"qa-sim-{uuid.uuid4().hex[:8]}"
    user = User.objects.create(email=f"{local}@example.com", role=Role.STUDENT, roles=[Role.STUDENT])
    user.set_password(GOOD_PASSWORD)
    user.save()

    resp = _authed(user).post(
        "/api/auth/change-password/",
        {"current_password": GOOD_PASSWORD, "new_password": local}, format="json",
    )
    assert resp.status_code == 400, resp.content
    assert "new_password" in resp.json()
    user.refresh_from_db()
    assert user.check_password(GOOD_PASSWORD)


def test_change_password_still_accepts_an_unrelated_password():
    user = User.objects.create(
        email=f"qa-sim-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT]
    )
    user.set_password(GOOD_PASSWORD)
    user.save()

    resp = _authed(user).post(
        "/api/auth/change-password/",
        {"current_password": GOOD_PASSWORD, "new_password": "Kx9$meadow-Tramway"}, format="json",
    )
    assert resp.status_code == 200, resp.content
    user.refresh_from_db()
    assert user.check_password("Kx9$meadow-Tramway")
