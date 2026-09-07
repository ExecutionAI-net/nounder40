"""Il titolare della scuola (QA round 2: SCH-R2-07 / R2-M4).

Il primo account creato da HQ (`POST /hq/schools/{id}/resend-invite/`) nasceva
con `SchoolMembership.sub_role = "admin"` e nessun endpoint ha mai assegnato
`owner`: nessuna scuola poteva avere un titolare, `only_owner_assigns_owner`
bloccava chiunque, e la protezione del fondatore — agganciata alla sola
stringa `sub_role == "owner"` — non scattava mai: un admin qualsiasi poteva
declassare o cacciare l'account `School.owner`.

Qui: il primo membro nasce `owner`, `School.owner` resta allineato, e la
protezione guarda anche `School.owner`, non solo il sub_role.
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
def roles():
    from core import section_guard

    for key, label in (("owner", "Titolare"), ("admin", "Amministratore"), ("staff", "Staff")):
        SchoolRole.objects.update_or_create(
            key=key, defaults={"label": label, "builtin": True, "permissions": ["team"]}
        )
    # La matrice e' in cache per 30s a livello di modulo: fra un test e
    # l'altro lo snapshot e' quello del DB gia' rollbackato e il middleware
    # fallirebbe chiuso (403) mascherando il vero motivo della risposta.
    section_guard._matrix_cache.update({"expires": 0.0, "roles": {}})


@pytest.fixture
def school(roles):
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", active=True,
        email=f"school-{uuid.uuid4().hex[:8]}@example.com",
    )


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


def _hq_client():
    user = get_user_model().objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], is_staff=True,
    )
    return _client(user)


# ---- il primo membro e' il titolare ----

def test_hq_resend_invite_creates_the_first_membership_as_owner(school):
    resp = _hq_client().post(f"/api/hq/schools/{school.id}/resend-invite/", {}, format="json")

    assert resp.status_code == 200
    membership = SchoolMembership.objects.get(school=school)
    assert membership.sub_role == "owner"
    school.refresh_from_db()
    assert school.owner_id == membership.profile_id


def test_resend_invite_promotes_a_founder_left_behind_as_admin(school):
    """Le scuole gia' esistenti hanno la membership del fondatore a `admin`:
    un secondo invito la ripara, ma solo se un titolare non c'e' ancora."""
    user = get_user_model().objects.create(
        email=school.email, role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school
    )
    membership = SchoolMembership.objects.create(profile=user, school=school, sub_role="admin")

    _hq_client().post(f"/api/hq/schools/{school.id}/resend-invite/", {}, format="json")

    membership.refresh_from_db()
    assert membership.sub_role == "owner"


def test_resend_invite_does_not_touch_a_school_that_already_has_an_owner(school):
    owner = _member(school, "owner")
    user = get_user_model().objects.create(
        email=school.email, role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school
    )
    founder = SchoolMembership.objects.create(profile=user, school=school, sub_role="admin")

    _hq_client().post(f"/api/hq/schools/{school.id}/resend-invite/", {}, format="json")

    founder.refresh_from_db()
    owner.refresh_from_db()
    assert founder.sub_role == "admin"
    assert owner.sub_role == "owner"


# ---- la protezione segue School.owner, non solo la stringa sub_role ----

def test_admin_cannot_demote_the_school_owner_account(school):
    founder = _member(school, "admin")  # come nasceva prima del fix
    School.objects.filter(pk=school.id).update(owner_id=founder.profile_id)
    admin = _member(school, "admin")

    resp = _client(admin.profile).patch(
        "/api/school/team/", {"id": str(founder.id), "school_sub_role": "staff"}, format="json"
    )

    # 403 dalla view, non dal middleware della matrice: e' la protezione
    # del titolare che ha risposto.
    assert (resp.status_code, resp.json()) == (403, {"error": "forbidden"})
    founder.refresh_from_db()
    assert founder.sub_role == "admin"


def test_admin_cannot_remove_the_school_owner_account(school):
    founder = _member(school, "admin")
    School.objects.filter(pk=school.id).update(owner_id=founder.profile_id)
    admin = _member(school, "admin")

    resp = _client(admin.profile).delete("/api/school/team/", {"id": str(founder.id)}, format="json")

    assert (resp.status_code, resp.json()) == (403, {"error": "forbidden"})
    assert SchoolMembership.objects.filter(pk=founder.id).exists()


def test_admin_cannot_touch_an_owner_sub_role_membership_either(school):
    owner = _member(school, "owner")
    admin = _member(school, "admin")

    patched = _client(admin.profile).patch(
        "/api/school/team/", {"id": str(owner.id), "school_sub_role": "staff"}, format="json"
    )
    deleted = _client(admin.profile).delete("/api/school/team/", {"id": str(owner.id)}, format="json")
    assert (patched.status_code, patched.json()) == (403, {"error": "forbidden"})
    assert (deleted.status_code, deleted.json()) == (403, {"error": "forbidden"})


def test_admin_can_still_manage_non_owner_members(school):
    owner = _member(school, "owner")
    School.objects.filter(pk=school.id).update(owner_id=owner.profile_id)
    admin = _member(school, "admin")
    staff = _member(school, "staff")

    promoted = _client(admin.profile).patch(
        "/api/school/team/", {"id": str(staff.id), "school_sub_role": "admin"}, format="json"
    )
    assert promoted.status_code == 200
    staff.refresh_from_db()
    assert staff.sub_role == "admin"

    removed = _client(admin.profile).delete("/api/school/team/", {"id": str(staff.id)}, format="json")
    assert removed.status_code == 204
    assert not SchoolMembership.objects.filter(pk=staff.id).exists()


# ---- la migrazione di riparazione (schools/0006) ----

def _run_backfill():
    import importlib

    from django.apps import apps

    module = importlib.import_module("schools.migrations.0006_backfill_school_owner_membership")
    module.promote_owner_memberships(apps, None)


def test_backfill_promotes_the_owner_account_and_is_idempotent(school):
    """La data migration 0006 riparata: promuove la membership dell'utente
    `School.owner` e riempie `School.owner` quando manca. Eseguita due volte
    non deve cambiare piu' niente."""
    founder = _member(school, "admin")
    School.objects.filter(pk=school.id).update(owner_id=founder.profile_id)

    _run_backfill()

    founder.refresh_from_db()
    assert founder.sub_role == "owner"

    _run_backfill()  # idempotente
    founder.refresh_from_db()
    assert founder.sub_role == "owner"


def test_backfill_leaves_a_school_that_already_has_an_owner_alone(school):
    owner = _member(school, "owner")
    founder = _member(school, "admin")
    School.objects.filter(pk=school.id).update(owner_id=founder.profile_id)

    _run_backfill()

    founder.refresh_from_db()
    owner.refresh_from_db()
    assert (founder.sub_role, owner.sub_role) == ("admin", "owner")


def test_backfill_fills_school_owner_from_a_lone_owner_membership(school):
    owner = _member(school, "owner")
    _member(school, "admin")
    assert school.owner_id is None

    _run_backfill()

    school.refresh_from_db()
    assert school.owner_id == owner.profile_id
