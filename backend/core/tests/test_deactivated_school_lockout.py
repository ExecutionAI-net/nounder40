"""R2-M19b — disattivare una scuola deve chiudere anche le sue porte interne.

Nel giro 2 di QA la scuola A e' stata disattivata da HQ: sono spariti la
vetrina pubblica e le prenotazioni, ma il suo admin ha continuato a fare
login e a fare PATCH su `/api/school/profile/` (200). "Disattivata" valeva
solo verso l'esterno.

Adesso: il guard di sezione rilegge `School.active` a ogni richiesta e chiude
tutto `/api/school/*` (tranne `memberships`, l'unica via d'uscita per chi
appartiene anche a un'altra scuola), la disattivazione manda in blacklist i
refresh token dei membri, e chi ha come unico ruolo `school` su scuole tutte
spente non riceve nemmeno i token al login. Riattivare rimette tutto a posto
senza toccare ruoli o membership.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import HQMember, HQRole, Role
from schools.models import School, SchoolMembership, SchoolRole

pytestmark = pytest.mark.django_db

PASSWORD = "QaSuite!2026"


def _user(password=None, **kwargs):
    user = get_user_model()(email=f"u-{uuid.uuid4().hex[:8]}@example.com", **kwargs)
    if password:
        user.set_password(password)
    else:
        user.set_unusable_password()
    user.save()
    return user


def _client(user):
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


@pytest.fixture
def school():
    return School.objects.create(
        name="Scuola A", slug=f"s-{uuid.uuid4().hex[:8]}", email="a@example.com", active=True
    )


@pytest.fixture(autouse=True)
def roles():
    SchoolRole.objects.update_or_create(
        key="owner", defaults={"label": "Titolare", "builtin": True, "permissions": ["settings", "students", "team"]}
    )
    SchoolRole.objects.update_or_create(
        key="admin", defaults={"label": "Admin", "builtin": True, "permissions": ["settings", "students", "team"]}
    )
    HQRole.objects.update_or_create(
        key="owner", defaults={"label": "Owner", "builtin": True,
                               "permissions": ["schools_view", "schools_create_edit", "schools_activate"]}
    )


@pytest.fixture
def admin(school):
    user = _user(password=PASSWORD, role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school)
    SchoolMembership.objects.create(profile=user, school=school, sub_role="admin")
    return user


@pytest.fixture
def hq_owner():
    user = _user(role=Role.HQ, roles=[Role.HQ], hq_sub_role="owner")
    HQMember.objects.create(user=user, email=user.email, name="HQ", sub_role="owner", active=True)
    return user


def _deactivate(hq_owner, school):
    return _client(hq_owner).post(f"/api/hq/schools/{school.id}/deactivate/")


def _activate(hq_owner, school):
    return _client(hq_owner).post(f"/api/hq/schools/{school.id}/activate/")


def test_deactivating_the_school_closes_the_school_panel_for_its_members(admin, hq_owner, school):
    api = _client(admin)
    assert api.get("/api/school/profile/").status_code == 200
    assert api.patch("/api/school/profile/", {"phone": "123"}, format="json").status_code == 200

    assert _deactivate(hq_owner, school).status_code == 200

    # Stesso token di prima: ora ogni endpoint della scuola e' chiuso.
    for path in ("/api/school/profile/", "/api/school/students/", "/api/school/team/"):
        response = api.get(path)
        assert response.status_code == 403, path
        assert response.json()["error"] == "school_deactivated"
    assert api.patch("/api/school/profile/", {"phone": "999"}, format="json").status_code == 403


def test_memberships_stays_open_so_a_multi_school_member_can_move(admin, hq_owner, school):
    other = School.objects.create(
        name="Scuola B", slug=f"b-{uuid.uuid4().hex[:8]}", email="b@example.com", active=True
    )
    SchoolMembership.objects.create(profile=admin, school=other, sub_role="admin")
    _deactivate(hq_owner, school)

    api = _client(admin)
    assert api.get("/api/school/memberships/").status_code == 200


def test_reactivating_the_school_restores_access(admin, hq_owner, school):
    _deactivate(hq_owner, school)
    assert _client(admin).get("/api/school/profile/").status_code == 403

    assert _activate(hq_owner, school).status_code == 200

    admin.refresh_from_db()
    assert admin.roles == [Role.SCHOOL]  # ruolo e membership intatti
    assert SchoolMembership.objects.filter(profile=admin, school=school).exists()
    assert _client(admin).get("/api/school/profile/").status_code == 200


def test_deactivation_blacklists_the_members_refresh_tokens(admin, hq_owner, school):
    refresh = RefreshToken.for_user(admin)
    assert APIClient().post("/api/auth/refresh/", {"refresh": str(refresh)}, format="json").status_code == 200

    _deactivate(hq_owner, school)

    assert APIClient().post("/api/auth/refresh/", {"refresh": str(refresh)}, format="json").status_code == 401


def test_login_is_refused_when_every_school_of_the_user_is_deactivated(admin, hq_owner, school):
    api = APIClient()
    assert api.post(
        "/api/auth/login/", {"email": admin.email, "password": PASSWORD}, format="json"
    ).status_code == 200

    _deactivate(hq_owner, school)

    response = api.post("/api/auth/login/", {"email": admin.email, "password": PASSWORD}, format="json")
    assert response.status_code == 401
    assert response.data["detail"].code == "school_deactivated"


def test_a_member_of_another_active_school_can_still_log_in(admin, hq_owner, school):
    other = School.objects.create(
        name="Scuola B", slug=f"b-{uuid.uuid4().hex[:8]}", email="b@example.com", active=True
    )
    SchoolMembership.objects.create(profile=admin, school=other, sub_role="admin")

    _deactivate(hq_owner, school)

    assert APIClient().post(
        "/api/auth/login/", {"email": admin.email, "password": PASSWORD}, format="json"
    ).status_code == 200


def test_a_multi_role_user_keeps_the_other_role(hq_owner, school):
    """Una scuola spenta non deve cancellare il resto della vita di un
    account multi-ruolo (RoleSwitcher)."""
    user = _user(password=PASSWORD, role=Role.SCHOOL, roles=[Role.SCHOOL, Role.TEACHER], active_school=school)
    SchoolMembership.objects.create(profile=user, school=school, sub_role="admin")

    _deactivate(hq_owner, school)

    login = APIClient().post("/api/auth/login/", {"email": user.email, "password": PASSWORD}, format="json")
    assert login.status_code == 200
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    assert api.get("/api/school/profile/").status_code == 403
    assert api.get("/api/auth/me/").status_code == 200
    user.refresh_from_db()
    assert set(user.roles) == {Role.SCHOOL, Role.TEACHER}
