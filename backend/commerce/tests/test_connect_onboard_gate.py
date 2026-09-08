"""R3-H2 (QA_REGRESSION_ROUND3_CROSSCUT.md X-R3-02): Stripe Connect
onboarding had no role gate and was not idempotent.

`POST /api/stripe/onboard/` lives under `/api/stripe/`, not `/api/school/`,
so `SchoolSectionGuardMiddleware` never sees it — the only checks were
`IsAuthenticated` and a non-null `active_school_id`. Live, a `staff` member
(403 `section_forbidden: payments` on `/school/transactions/`) got a
`connect.stripe.com/setup/e/acct_…` link: the KYC/bank-details flow that
decides where the school's money lands.

And `start_connect_onboarding()` read `school.stripe_account_id`, found it
empty and called `stripe.Account.create()` with no lock. Two calls in the
same second created two Express accounts; the last `save()` won and the
other was orphaned inside Stripe (on one QA tenant the school ended up bound
to the account the *staff* call had opened).
"""
import threading
import time
import uuid
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.db import connections
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import HQMember, Role
from commerce.stripe_service import start_connect_onboarding
from schools.models import School, SchoolMembership

pytestmark = pytest.mark.django_db
User = get_user_model()


def _school(**kwargs):
    kwargs.setdefault("country", "Italy")
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com", **kwargs
    )


def _member(school, sub_role):
    user = User.objects.create(
        email=f"m-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role=sub_role)
    return user


def _client(user):
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


def _stripe_patches():
    account = patch("commerce.stripe_service.stripe.Account.create")
    link = patch("commerce.stripe_service.stripe.AccountLink.create")
    return account, link


# --- the role gate ----------------------------------------------------------


def test_staff_cannot_start_connect_onboarding():
    """The live repro: staff has no `payments` section, yet got the link."""
    school = _school()
    account, link = _stripe_patches()
    with account as create, link as account_link:
        create.return_value = type("A", (), {"id": "acct_staff"})()
        account_link.return_value = type("L", (), {"url": "https://stripe.test/onboard"})()
        resp = _client(_member(school, "staff")).post("/api/stripe/onboard/", {}, format="json")
    assert resp.status_code == 403, resp.content
    assert resp.json() == {"error": "section_forbidden", "section": "payments"}
    create.assert_not_called()
    school.refresh_from_db()
    assert school.stripe_account_id == ""


@pytest.mark.parametrize("sub_role", ["owner", "admin"])
def test_owner_and_admin_can_still_start_connect_onboarding(sub_role):
    school = _school()
    account, link = _stripe_patches()
    with account as create, link as account_link:
        create.return_value = type("A", (), {"id": f"acct_{sub_role}"})()
        account_link.return_value = type("L", (), {"url": "https://stripe.test/onboard"})()
        resp = _client(_member(school, sub_role)).post("/api/stripe/onboard/", {}, format="json")
    assert resp.status_code == 200, resp.content
    assert resp.json()["url"] == "https://stripe.test/onboard"


def test_a_non_member_with_a_stale_active_school_cannot_onboard():
    """`active_school_id` is a column nobody clears; membership is the door."""
    school = _school()
    outsider = User.objects.create(
        email=f"o-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT], active_school=school,
    )
    resp = _client(outsider).post("/api/stripe/onboard/", {}, format="json")
    assert resp.status_code == 403, resp.content


def test_narrow_hq_role_cannot_onboard_a_school():
    """Same predicate as everywhere else: only cross-school HQ authority."""
    school = _school()
    hq = User.objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ],
        hq_sub_role="support", active_school=school,
    )
    HQMember.objects.create(user=hq, email=hq.email, name="QA", sub_role="support")
    resp = _client(hq).post("/api/stripe/onboard/", {}, format="json")
    assert resp.status_code == 403, resp.content


# --- idempotency ------------------------------------------------------------


def test_a_second_call_reuses_the_existing_account():
    school = _school(stripe_account_id="acct_existing")
    account, link = _stripe_patches()
    with account as create, link as account_link:
        account_link.return_value = type("L", (), {"url": "https://stripe.test/onboard"})()
        start_connect_onboarding(school, refresh_url="http://r", return_url="http://x")
    create.assert_not_called()
    assert account_link.call_args.kwargs["account"] == "acct_existing"


@pytest.mark.django_db(transaction=True)
def test_concurrent_onboarding_creates_exactly_one_account():
    """The live race: owner and staff called within the same second and Stripe
    got two `Account.create` calls, leaving an orphan Express account.

    The first caller is made slow *inside* the critical section, then the
    second starts while it is still there. Without the row lock the second
    reads an empty `stripe_account_id` and creates a second account; with it,
    the second blocks until the first commits and then finds the id already
    written. Stripe is patched from this thread, not from the workers: two
    workers patching the same module attribute would restore it under each
    other's feet.
    """
    school = _school()
    created = []
    append_lock = threading.Lock()

    def fake_create(**kwargs):
        account_id = f"acct_{uuid.uuid4().hex[:8]}"
        with append_lock:
            created.append(account_id)
        time.sleep(1.5)
        return type("A", (), {"id": account_id})()

    def run():
        try:
            start_connect_onboarding(
                School.objects.get(pk=school.pk), refresh_url="http://r", return_url="http://x"
            )
        finally:
            connections.close_all()

    with patch("commerce.stripe_service.stripe.Account.create", side_effect=fake_create),          patch("commerce.stripe_service.stripe.AccountLink.create") as account_link:
        account_link.return_value = type("L", (), {"url": "https://stripe.test/onboard"})()
        first = threading.Thread(target=run)
        first.start()
        time.sleep(0.4)  # the first caller is now inside the locked section
        second = threading.Thread(target=run)
        second.start()
        for t in (first, second):
            t.join(timeout=30)
            assert not t.is_alive(), "a thread is still blocked on the school row lock"

    school.refresh_from_db()
    assert len(created) == 1, f"Stripe was asked for {len(created)} accounts: {created}"
    assert school.stripe_account_id == created[0]
