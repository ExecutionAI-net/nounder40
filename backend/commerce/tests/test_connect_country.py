"""Il paese dell'account Stripe Connect viene dalla scuola, non da un default.

Il codice apriva ogni account Express con country="IT". Barcelona e' spagnola,
e il paese di un account Stripe NON e' modificabile dopo la creazione: un
account aperto sbagliato va cancellato e la KYC rifatta da zero. Quindi o il
paese si risolve, o l'onboarding si ferma prima di chiamare Stripe.
"""
import uuid
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from commerce.stripe_service import CheckoutError, start_connect_onboarding
from geography.models import HQCountry
from geography.services import country_code_for
from schools.models import School, SchoolMembership

pytestmark = pytest.mark.django_db


def _school(**kwargs):
    return School.objects.create(
        name=kwargs.pop("name", "S"), slug=f"s-{uuid.uuid4().hex[:8]}",
        email="s@example.com", **kwargs,
    )


@pytest.mark.parametrize("written,expected", [
    ("Spain", "ES"),
    ("Spagna", "ES"),
    ("España", "ES"),
    ("Italy", "IT"),
    ("Italia", "IT"),
    ("IT", "IT"),
    ("  es  ", "ES"),
    ("Deutschland", "DE"),
    ("Türkiye", "TR"),
])
def test_country_is_resolved_from_free_text(written, expected):
    assert country_code_for(written) == expected


@pytest.mark.parametrize("written", ["", "   ", None, "Atlantide", "Nowhere"])
def test_unresolvable_country_returns_none(written):
    assert country_code_for(written) is None


def test_hq_country_table_wins_over_the_alias_list():
    HQCountry.objects.create(name="Paese Inventato", code="XX")
    assert country_code_for("Paese Inventato") == "XX"


def test_barcelona_opens_a_spanish_account_not_an_italian_one():
    school = _school(name="Danza Clásica Barcelona", country="Spain")
    with patch("commerce.stripe_service.stripe.Account.create") as create, \
         patch("commerce.stripe_service.stripe.AccountLink.create") as link:
        create.return_value = type("A", (), {"id": "acct_test"})()
        link.return_value = type("L", (), {"url": "https://stripe.test/onboard"})()
        start_connect_onboarding(school, refresh_url="http://r", return_url="http://x")
    assert create.call_args.kwargs["country"] == "ES"
    school.refresh_from_db()
    assert school.stripe_account_id == "acct_test"


def test_unknown_country_stops_before_calling_stripe():
    school = _school(country="Atlantide")
    with patch("commerce.stripe_service.stripe.Account.create") as create:
        with pytest.raises(CheckoutError) as exc:
            start_connect_onboarding(school, refresh_url="http://r", return_url="http://x")
    assert str(exc.value) == "school_country_unknown"
    create.assert_not_called()
    school.refresh_from_db()
    assert school.stripe_account_id == ""


def test_missing_country_stops_before_calling_stripe():
    school = _school(country="")
    with patch("commerce.stripe_service.stripe.Account.create") as create:
        with pytest.raises(CheckoutError) as exc:
            start_connect_onboarding(school, refresh_url="http://r", return_url="http://x")
    assert str(exc.value) == "school_country_missing"
    create.assert_not_called()


def test_onboard_endpoint_answers_400_not_500():
    """La scuola deve leggere il motivo, non un errore generico."""
    school = _school(country="Atlantide")
    user = get_user_model().objects.create(
        email=f"adm-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school,
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    api = APIClient()
    api.force_authenticate(user=user)

    res = api.post("/api/stripe/onboard/", {}, format="json")
    assert res.status_code == 400
    assert res.json() == {"error": "school_country_unknown", "country": "Atlantide"}
