"""R2-M19a — rimuovere un membro HQ deve toglierne davvero i permessi.

Il giro 2 di QA ha rimosso il membro `fa788793…` dal team HQ e ha poi
riutilizzato il suo token: `/api/auth/me/` continuava a rispondere con
`role: "hq"`, `/api/chat/` e `/api/school/*?school=` restavano aperti. Anzi:
sparita la riga `HQMember`, `effective_hq_sub_role()` tornava stringa vuota e
ogni guardia HQ — che per un sub-ruolo vuoto va deliberatamente in fail-open —
gli apriva PIU' porte di prima.

Due cose devono succedere alla rimozione: il ruolo `hq` sparisce dall'utente
(gli access token gia' emessi muoiono subito, perche' `JWTAuthentication`
ricarica sempre l'utente dal DB) e i refresh token in circolazione finiscono
in blacklist. Gli altri ruoli di un account multi-ruolo non si toccano.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import HQMember, HQRole, Role
from schools.models import School, SchoolMembership
from students.models import Student

pytestmark = pytest.mark.django_db


def _user(**kwargs):
    return get_user_model().objects.create(email=f"u-{uuid.uuid4().hex[:8]}@example.com", **kwargs)


def _client(user):
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


@pytest.fixture
def hq_roles():
    HQRole.objects.update_or_create(
        key="owner", defaults={"label": "Owner", "builtin": True, "permissions": ["team", "permissions"]}
    )
    HQRole.objects.update_or_create(
        key="support", defaults={"label": "Support", "builtin": True, "permissions": ["dashboard", "inbox"]}
    )


@pytest.fixture
def owner(hq_roles):
    user = _user(role=Role.HQ, roles=[Role.HQ], hq_sub_role="owner")
    HQMember.objects.create(user=user, email=user.email, name="Owner", sub_role="owner", active=True)
    return user


@pytest.fixture
def support(hq_roles):
    user = _user(role=Role.HQ, roles=[Role.HQ])
    HQMember.objects.create(user=user, email=user.email, name="Support", sub_role="support", active=True)
    return user


@pytest.fixture
def school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True
    )


def test_removed_member_loses_the_hq_role_and_its_endpoints(owner, support, school):
    # Il token catturato PRIMA della rimozione: e' esattamente quello che il
    # report QA ha riprodotto in mano al membro rimosso.
    refresh = RefreshToken.for_user(support)
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {refresh.access_token}")
    assert api.get("/api/auth/me/").data["role"] == "hq"
    assert api.get("/api/chat/").status_code == 200

    assert _client(owner).delete(f"/api/hq/team/{support.pk}/").status_code == 204

    support.refresh_from_db()
    assert support.role == ""
    assert support.roles == []
    assert support.is_active is False

    # Stesso access token di prima: ora non apre piu' nulla.
    assert api.get("/api/auth/me/").status_code == 401
    assert api.get("/api/chat/").status_code == 401
    assert api.get(f"/api/school/students/?school={school.id}").status_code == 401

    # E il refresh token non serve a rifarsene uno.
    assert APIClient().post("/api/auth/refresh/", {"refresh": str(refresh)}, format="json").status_code == 401


def test_an_untouched_hq_member_keeps_working(owner, support, school):
    other = _user(role=Role.HQ, roles=[Role.HQ])
    HQMember.objects.create(user=other, email=other.email, name="Other", sub_role="support", active=True)
    api = _client(other)

    assert _client(owner).delete(f"/api/hq/team/{support.pk}/").status_code == 204

    other.refresh_from_db()
    assert other.role == "hq" and other.roles == [Role.HQ] and other.is_active is True
    assert api.get("/api/auth/me/").status_code == 200
    assert api.get("/api/chat/").status_code == 200


def test_multi_role_member_keeps_the_other_role(owner, hq_roles, school):
    """Un account HQ che e' anche membro di una scuola non deve restare
    chiuso fuori dal pannello scuola solo perche' HQ lo ha rimosso dal team."""
    both = _user(role=Role.HQ, roles=[Role.HQ, Role.SCHOOL], active_school=school)
    SchoolMembership.objects.create(profile=both, school=school, sub_role="owner")
    HQMember.objects.create(user=both, email=both.email, name="Both", sub_role="support", active=True)

    assert _client(owner).delete(f"/api/hq/team/{both.pk}/").status_code == 204

    both.refresh_from_db()
    assert both.roles == [Role.SCHOOL]
    assert both.role == Role.SCHOOL
    assert both.is_active is True
    # Nuovo token (i vecchi sono in blacklist): il pannello scuola risponde.
    assert _client(both).get("/api/school/profile/").status_code == 200


def test_removal_blacklists_every_outstanding_refresh_token(owner, support):
    first, second = RefreshToken.for_user(support), RefreshToken.for_user(support)
    assert OutstandingToken.objects.filter(user=support).count() >= 2

    _client(owner).delete(f"/api/hq/team/{support.pk}/")

    blacklisted = set(
        BlacklistedToken.objects.filter(token__user=support).values_list("token__jti", flat=True)
    )
    assert {first["jti"], second["jti"]} <= blacklisted


def test_a_removed_member_who_is_also_a_student_stays_usable(owner, hq_roles):
    """`_has_other_access`: non si disattiva un profilo che ha ancora un
    motivo legittimo di esistere."""
    user = _user(role=Role.HQ, roles=[Role.HQ, Role.STUDENT])
    Student.objects.create(user=user, name="Studentessa")
    HQMember.objects.create(user=user, email=user.email, name="Dual", sub_role="support", active=True)

    _client(owner).delete(f"/api/hq/team/{user.pk}/")

    user.refresh_from_db()
    assert user.is_active is True and user.roles == [Role.STUDENT]
