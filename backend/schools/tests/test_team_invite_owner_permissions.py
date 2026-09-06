"""Invitare un nuovo membro come titolare è la stessa autorità di
promuoverne uno esistente — la PATCH lo controllava già
(`only_owner_assigns_owner`), la POST no: un admin poteva invitare un membro
mai visto prima direttamente con `school_sub_role: "owner"` e ottenere un
secondo titolare senza alcuna approvazione del primo (QA #6, Alto)."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from schools.models import School, SchoolMembership, SchoolRole

pytestmark = pytest.mark.django_db


@pytest.fixture
def school():
    for key, label in (("owner", "Titolare"), ("admin", "Amministratore"), ("staff", "Staff")):
        SchoolRole.objects.update_or_create(
            key=key, defaults={"label": label, "builtin": True, "permissions": ["team"]}
        )
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


def _member(school, sub_role):
    user = get_user_model().objects.create(
        email=f"{sub_role}-{uuid.uuid4().hex[:8]}@example.com",
        role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    return SchoolMembership.objects.create(profile=user, school=school, sub_role=sub_role)


def _client(user):
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


def _invite(caller, sub_role, email=None):
    email = email or f"invitee-{uuid.uuid4().hex[:8]}@example.com"
    return _client(caller.profile).post(
        "/api/school/team/",
        {"email": email, "name": "New Person", "school_sub_role": sub_role},
        format="json",
    ), email


def test_admin_cannot_invite_a_new_owner(school):
    admin = _member(school, "admin")

    response, email = _invite(admin, "owner")

    assert response.status_code == 403
    assert response.json()["error"] == "only_owner_assigns_owner"
    assert not get_user_model().objects.filter(email__iexact=email).exists()
    assert not SchoolMembership.objects.filter(school=school, sub_role="owner").exclude(
        profile=admin.profile
    ).exists()


def test_owner_can_invite_a_new_owner(school):
    owner = _member(school, "owner")

    response, email = _invite(owner, "owner")

    assert response.status_code == 201
    user = get_user_model().objects.get(email__iexact=email)
    membership = SchoolMembership.objects.get(profile=user, school=school)
    assert membership.sub_role == "owner"


def test_admin_can_still_invite_staff_and_admin(school):
    admin = _member(school, "admin")

    for sub_role in ("staff", "admin"):
        response, email = _invite(admin, sub_role)
        assert response.status_code == 201
        assert SchoolMembership.objects.get(
            profile__email__iexact=email, school=school
        ).sub_role == sub_role


# Nota: lo staff non arriva nemmeno a questa view. In produzione (matrice
# seed in schools/migrations/0004_schoolrole.py, STAFF_SECTIONS) il ruolo
# "staff" non ha la sezione "team", quindi core/section_guard.py risponde
# 403 "section_forbidden" su QUALSIASI metodo di /api/school/team/ prima
# ancora di autenticare la richiesta contro questa view — già coperto da
# core/tests/test_section_guard.py::test_staff_is_still_closed_out_of_foreign_sections
# (parametrizzato anche su "/api/school/team/"). Non serve duplicarlo qui:
# la fixture `school` sopra dà a "staff" il permesso "team" solo per poter
# testare, come fa già test_team_delete_permissions.py, la gerarchia
# owner/admin/staff *dentro* la view — cosa che in produzione lo staff non
# raggiunge mai.
