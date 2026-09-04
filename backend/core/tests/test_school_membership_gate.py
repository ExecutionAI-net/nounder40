"""L'appartenenza è la porta del pannello scuola.

Prima bastava `profiles.active_school_id`. È una colonna che nessuno ripulisce:
le allieve ce l'hanno (è la loro scuola) e a un membro rimosso resta puntata
addosso. Risultato verificato sul database di prova: un'allieva leggeva
l'elenco delle altre allieve e dello staff e poteva fare PATCH su
/api/school/profile/, e chi veniva cancellato dall'admin continuava a lavorare
come prima.
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
    return School.objects.create(
        name="Scuola", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        cancellation_policy_hours=24,
    )


def _client(user):
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


def _user(**kwargs):
    return get_user_model().objects.create(email=f"u-{uuid.uuid4().hex[:8]}@example.com", **kwargs)


@pytest.fixture
def admin_user(school):
    SchoolRole.objects.update_or_create(
        key="admin",
        defaults={"label": "Admin", "builtin": True, "permissions": ["settings", "students", "team", "locations"]},
    )
    user = _user(role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school)
    SchoolMembership.objects.create(profile=user, school=school, sub_role="admin")
    return user


# --- l'allieva non è staff ------------------------------------------------

@pytest.mark.parametrize("path", [
    "/api/school/students/",
    "/api/school/locations/",
    "/api/school/team/",
    "/api/school/profile/",
])
def test_student_of_the_school_cannot_read_the_school_panel(school, path):
    student = _user(role=Role.STUDENT, roles=[Role.STUDENT], active_school=school)
    res = _client(student).get(path)
    assert res.status_code == 403, f"{path} -> {res.status_code} {res.content[:120]}"


def test_student_cannot_rewrite_the_school_profile(school):
    student = _user(role=Role.STUDENT, roles=[Role.STUDENT], active_school=school)
    res = _client(student).patch(
        "/api/school/profile/", {"cancellation_policy_hours": 999}, format="json"
    )
    assert res.status_code == 403
    school.refresh_from_db()
    assert school.cancellation_policy_hours == 24


# --- il membro rimosso perde l'accesso ------------------------------------

def test_membership_delete_closes_the_panel(admin_user):
    api = _client(admin_user)
    assert api.get("/api/school/students/").status_code == 200

    SchoolMembership.objects.filter(profile=admin_user).delete()

    assert api.get("/api/school/students/").status_code == 403
    assert api.get("/api/school/profile/").status_code == 403


def test_membership_delete_clears_active_school_and_role(admin_user, school):
    SchoolMembership.objects.filter(profile=admin_user).delete()

    admin_user.refresh_from_db()
    assert admin_user.active_school_id is None
    assert Role.SCHOOL not in admin_user.roles
    assert admin_user.role != Role.SCHOOL


def test_removal_from_one_school_leaves_the_other(admin_user, school):
    other = School.objects.create(name="Altra", slug=f"a-{uuid.uuid4().hex[:8]}", email="a@example.com")
    SchoolMembership.objects.create(profile=admin_user, school=other, sub_role="admin")

    SchoolMembership.objects.filter(profile=admin_user, school=school).delete()

    admin_user.refresh_from_db()
    assert admin_user.active_school_id == other.id
    assert Role.SCHOOL in admin_user.roles


def test_the_school_switcher_stays_reachable_without_a_membership(school):
    """L'unico endpoint esente: senza di lui un utente con scuola attiva
    sbagliata non avrebbe modo di accorgersene né di cambiarla."""
    orphan = _user(role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school)
    res = _client(orphan).get("/api/school/memberships/")
    assert res.status_code == 200
    assert res.json()["memberships"] == []


# --- chi ha diritto continua a passare ------------------------------------

def test_a_real_member_is_unaffected(admin_user):
    api = _client(admin_user)
    assert api.get("/api/school/profile/").status_code == 200
    assert api.get("/api/school/students/").status_code == 200


def test_hq_is_not_subject_to_the_membership_gate(school):
    hq = _user(role=Role.HQ, roles=[Role.HQ], active_school=school)
    assert _client(hq).get("/api/school/profile/").status_code == 200


def test_stale_active_school_is_denied(school):
    """Membro di A, scuola attiva B: sta lavorando su una scuola che non è sua.
    Il comando audit_school_memberships lo segnalava soltanto."""
    other = School.objects.create(name="Altra", slug=f"a-{uuid.uuid4().hex[:8]}", email="a@example.com")
    user = _user(role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=other)
    SchoolMembership.objects.create(profile=user, school=school, sub_role="admin")

    assert _client(user).get("/api/school/profile/").status_code == 403
