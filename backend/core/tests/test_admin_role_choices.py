"""I sub-ruoli nell'admin si scelgono, non si digitano.

Erano campi di testo liberi, ma i valori validi sono le chiavi di HQRole /
SchoolRole: un refuso non dava errore, dava un ruolo che la matrice non
conosce e che il section guard tratta di conseguenza.
"""
import uuid

import pytest
from django.contrib.admin.sites import site
from django.contrib.auth import get_user_model
from django.test import RequestFactory

from accounts.models import HQMember, HQRole
from schools.models import School, SchoolMembership, SchoolRole

pytestmark = pytest.mark.django_db


@pytest.fixture
def request_():
    req = RequestFactory().get("/admin/")
    req.user = get_user_model()(email="su@example.com", is_superuser=True, is_staff=True)
    return req


def _field(model, request_, obj=None):
    admin = site._registry[model]
    form = admin.get_form(request_, obj)(instance=obj)
    return form.fields["sub_role"]


def test_school_sub_role_offers_the_configured_roles(request_):
    SchoolRole.objects.update_or_create(key="admin", defaults={"label": "Amministratore"})
    SchoolRole.objects.update_or_create(key="staff", defaults={"label": "Staff"})

    keys = [key for key, _ in _field(SchoolMembership, request_).choices]
    assert {"admin", "staff"} <= set(keys)
    assert set(keys) == set(SchoolRole.objects.values_list("key", flat=True))


def test_hq_sub_role_offers_the_configured_roles(request_):
    HQRole.objects.update_or_create(key="finance", defaults={"label": "Finance"})

    keys = [key for key, _ in _field(HQMember, request_).choices]
    assert "finance" in keys


def test_a_role_no_longer_in_the_matrix_stays_visible(request_):
    """Se lo nascondessimo, aprire la scheda per cambiare tutt'altro
    riscriverebbe il ruolo di nascosto al primo salvataggio."""
    SchoolRole.objects.update_or_create(key="admin", defaults={"label": "Amministratore"})
    school = School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")
    user = get_user_model().objects.create(email=f"u-{uuid.uuid4().hex[:8]}@example.com")
    membership = SchoolMembership.objects.create(profile=user, school=school, sub_role="sparito")

    choices = dict(_field(SchoolMembership, request_, membership).choices)
    assert "sparito" in choices
    assert "non in matrice" in choices["sparito"]


def test_an_invented_role_is_rejected(request_):
    SchoolRole.objects.update_or_create(key="admin", defaults={"label": "Amministratore"})
    school = School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")
    user = get_user_model().objects.create(email=f"u-{uuid.uuid4().hex[:8]}@example.com")

    form = site._registry[SchoolMembership].get_form(request_)({
        "profile": str(user.pk), "school": str(school.pk), "sub_role": "inventato",
        "created_at_0": "2026-01-01", "created_at_1": "00:00:00",
    })
    assert not form.is_valid()
    assert "sub_role" in form.errors
