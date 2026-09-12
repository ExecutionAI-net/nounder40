"""R3-H4 (QA_REGRESSION_ROUND3_SCHOOL.md SCH-R3-01): the founder was only
protected from admins, not from a peer owner — and an owner's role could not
be changed at all, silently.

R2-M4 made the first membership `owner` and blocked admins from touching it.
Both remaining guards then only asked whether the *caller* was an owner, so a
co-owner the founder had promoted himself could:

- `DELETE /api/school/team/ {id: <founder>}` -> **204**; the founder's
  `/school/*` then answered 403 `not_a_school_member`;
- `PATCH  /api/school/team/ {id: <founder>, school_sub_role: "staff"}` ->
  **200 with `school_sub_role: "owner"`** — the role branch was skipped in
  silence, so nothing said the demotion had not happened;
- and the promotion was one-way: `PATCH {id: <co-owner>, "admin"}` also
  no-op'd 200, so the only way back was DELETE, which strips the account's
  `school` role too.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from schools.models import School, SchoolMembership, SchoolRole

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    for key, label in (("owner", "Titolare"), ("admin", "Amministratore"), ("staff", "Staff")):
        SchoolRole.objects.update_or_create(
            key=key, defaults={"label": label, "builtin": True, "permissions": ["team"]}
        )
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com", active=True
    )


def _member(school, sub_role, *, founder=False):
    user = User.objects.create(
        email=f"{sub_role}-{uuid.uuid4().hex[:8]}@example.com",
        role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    membership = SchoolMembership.objects.create(profile=user, school=school, sub_role=sub_role)
    if founder:
        school.owner = user
        school.save(update_fields=["owner"])
    return membership


def _client(user):
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


def _patch(caller, target, **body):
    return _client(caller.profile).patch("/api/school/team/", {"id": str(target.id), **body}, format="json")


def _delete(caller, target):
    return _client(caller.profile).delete("/api/school/team/", {"id": str(target.id)}, format="json")


# --- the founder is not removable from the school panel ----------------------


def test_a_co_owner_cannot_remove_the_founder(school):
    """The live repro: 204, and the founder lost their own school."""
    founder = _member(school, "owner", founder=True)
    co_owner = _member(school, "owner")

    resp = _delete(co_owner, founder)

    assert resp.status_code == 403, resp.content
    assert resp.json()["error"] == "cannot_remove_founder"
    assert SchoolMembership.objects.filter(pk=founder.pk).exists()


def test_an_admin_still_cannot_remove_the_founder(school):
    founder = _member(school, "owner", founder=True)
    admin = _member(school, "admin")
    assert _delete(admin, founder).status_code == 403
    assert SchoolMembership.objects.filter(pk=founder.pk).exists()


def test_the_founder_cannot_remove_themselves(school):
    founder = _member(school, "owner", founder=True)
    resp = _delete(founder, founder)
    assert resp.status_code in (400, 403), resp.content
    assert SchoolMembership.objects.filter(pk=founder.pk).exists()


def test_an_owner_can_still_remove_a_co_owner(school):
    """The guard is about the founder, not about owners in general."""
    founder = _member(school, "owner", founder=True)
    co_owner = _member(school, "owner")
    assert _delete(founder, co_owner).status_code == 204
    assert not SchoolMembership.objects.filter(pk=co_owner.pk).exists()


def test_an_owner_can_still_remove_an_admin(school):
    founder = _member(school, "owner", founder=True)
    admin = _member(school, "admin")
    assert _delete(founder, admin).status_code == 204


# --- role changes say what happened ------------------------------------------


def test_demoting_the_founder_is_refused_not_silently_ignored(school):
    founder = _member(school, "owner", founder=True)
    co_owner = _member(school, "owner")

    resp = _patch(co_owner, founder, school_sub_role="staff")

    assert resp.status_code == 403, resp.content
    assert resp.json()["error"] == "cannot_change_founder_role"
    founder.refresh_from_db()
    assert founder.sub_role == "owner"


def test_a_promoted_co_owner_can_be_demoted_again(school):
    """The promotion used to be irreversible: PATCH answered 200 and changed
    nothing, so the only way back was DELETE."""
    founder = _member(school, "owner", founder=True)
    co_owner = _member(school, "owner")

    resp = _patch(founder, co_owner, school_sub_role="admin")

    assert resp.status_code == 200, resp.content
    assert resp.json()["school_sub_role"] == "admin"
    co_owner.refresh_from_db()
    assert co_owner.sub_role == "admin"


def test_an_admin_cannot_demote_a_co_owner(school):
    _member(school, "owner", founder=True)
    co_owner = _member(school, "owner")
    admin = _member(school, "admin")
    assert _patch(admin, co_owner, school_sub_role="staff").status_code == 403
    co_owner.refresh_from_db()
    assert co_owner.sub_role == "owner"


def test_an_admin_still_cannot_promote_anyone_to_owner(school):
    _member(school, "owner", founder=True)
    admin = _member(school, "admin")
    staff = _member(school, "staff")
    resp = _patch(admin, staff, school_sub_role="owner")
    assert resp.status_code == 403
    assert resp.json()["error"] == "only_owner_assigns_owner"


def test_editing_the_founders_profile_still_works(school):
    """A PATCH from the edit dialog carries the unchanged `school_sub_role`
    alongside the profile fields — that must not start failing."""
    founder = _member(school, "owner", founder=True)

    resp = _patch(founder, founder, name="Renamed Founder", phone="+391234", school_sub_role="owner")

    assert resp.status_code == 200, resp.content
    founder.profile.refresh_from_db()
    assert founder.profile.first_name == "Renamed"
    assert founder.profile.phone == "+391234"


def test_a_refused_role_change_does_not_half_apply_the_profile_edit(school):
    """The role branch used to sit after `user.save()`; a 4xx there would have
    left the name written and the role not."""
    founder = _member(school, "owner", founder=True)
    co_owner = _member(school, "owner")
    original_first_name = founder.profile.first_name

    resp = _patch(co_owner, founder, name="Hijacked Name", school_sub_role="staff")

    assert resp.status_code == 403, resp.content
    founder.profile.refresh_from_db()
    assert founder.profile.first_name == original_first_name
    assert founder.profile.full_name != "Hijacked Name"


# --- R4-H1 / X-R4-01: the founder's identity fields are not a peer's to edit --


def test_a_co_owner_cannot_rewrite_the_founders_email(school):
    """The round-4 live repro: 200, and the founder's `/auth/me/` carried
    the attacker's address — a password reset away from a takeover."""
    founder = _member(school, "owner", founder=True)
    co_owner = _member(school, "owner")
    original_email = founder.profile.email

    resp = _patch(co_owner, founder, email="hijack@example.com")

    assert resp.status_code == 403, resp.content
    assert resp.json()["error"] == "cannot_edit_founder"
    founder.profile.refresh_from_db()
    assert founder.profile.email == original_email


def test_a_co_owner_cannot_rewrite_the_founders_name_or_phone(school):
    founder = _member(school, "owner", founder=True)
    co_owner = _member(school, "owner")
    original = (founder.profile.first_name, founder.profile.last_name, founder.profile.phone)

    resp = _patch(co_owner, founder, name="Hijacked Name", phone="+39000000000")

    assert resp.status_code == 403, resp.content
    assert resp.json()["error"] == "cannot_edit_founder"
    founder.profile.refresh_from_db()
    assert (founder.profile.first_name, founder.profile.last_name, founder.profile.phone) == original


def test_a_co_owner_demotion_attempt_still_names_the_role_error(school):
    """The role-specific message stays first: the edit dialog maps it."""
    founder = _member(school, "owner", founder=True)
    co_owner = _member(school, "owner")
    resp = _patch(co_owner, founder, school_sub_role="staff", email="hijack@example.com")
    assert resp.status_code == 403
    assert resp.json()["error"] == "cannot_change_founder_role"


def test_an_admin_cannot_rewrite_the_founders_email(school):
    founder = _member(school, "owner", founder=True)
    admin = _member(school, "admin")
    original_email = founder.profile.email
    assert _patch(admin, founder, email="hijack@example.com").status_code == 403
    founder.profile.refresh_from_db()
    assert founder.profile.email == original_email


def test_the_founder_can_still_change_their_own_email(school):
    founder = _member(school, "owner", founder=True)
    resp = _patch(founder, founder, email="new-founder@example.com", school_sub_role="owner")
    assert resp.status_code == 200, resp.content
    founder.profile.refresh_from_db()
    assert founder.profile.email == "new-founder@example.com"


def test_an_owner_can_still_edit_a_co_owners_email(school):
    """The guard is about the founder, not about owners in general."""
    founder = _member(school, "owner", founder=True)
    co_owner = _member(school, "owner")
    resp = _patch(founder, co_owner, email="co-owner-new@example.com")
    assert resp.status_code == 200, resp.content
    co_owner.profile.refresh_from_db()
    assert co_owner.profile.email == "co-owner-new@example.com"
