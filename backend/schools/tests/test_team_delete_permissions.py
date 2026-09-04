"""Cacciare qualcuno dal team è la stessa autorità che modificarlo.

La PATCH controllava il ruolo del chiamante; la DELETE no — chiunque della
scuola poteva togliere chiunque altro, titolare compreso. Da quando la
membership è la porta del pannello, quella DELETE revoca l'accesso davvero.
"""
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


def _delete(caller, target):
    return _client(caller.profile).delete("/api/school/team/", {"id": target.id}, format="json")


def test_staff_cannot_remove_anyone(school):
    staff, victim = _member(school, "staff"), _member(school, "admin")

    assert _delete(staff, victim).status_code == 403
    assert SchoolMembership.objects.filter(pk=victim.pk).exists()


def test_admin_cannot_remove_the_owner(school):
    admin, owner = _member(school, "admin"), _member(school, "owner")

    assert _delete(admin, owner).status_code == 403
    assert SchoolMembership.objects.filter(pk=owner.pk).exists()


def test_admin_can_remove_staff(school):
    admin, staff = _member(school, "admin"), _member(school, "staff")

    assert _delete(admin, staff).status_code == 204
    assert not SchoolMembership.objects.filter(pk=staff.pk).exists()


def test_owner_can_remove_an_admin(school):
    owner, admin = _member(school, "owner"), _member(school, "admin")

    assert _delete(owner, admin).status_code == 204


def test_nobody_can_remove_themselves(school):
    """Ora la rimozione porta via ruolo e scuola attiva: un titolare che si
    togliesse chiuderebbe fuori se stesso e la gestione del team con sé."""
    owner = _member(school, "owner")

    assert _delete(owner, owner).status_code == 400
    assert SchoolMembership.objects.filter(pk=owner.pk).exists()


def test_a_member_of_another_school_is_not_found(school):
    """La ricerca è già limitata alla scuola attiva del chiamante: da fuori
    l'id non esiste nemmeno."""
    owner = _member(school, "owner")
    other = School.objects.create(name="Altra", slug=f"a-{uuid.uuid4().hex[:8]}", email="a@example.com")
    stranger = _member(other, "staff")

    assert _delete(owner, stranger).status_code == 404
    assert SchoolMembership.objects.filter(pk=stranger.pk).exists()
