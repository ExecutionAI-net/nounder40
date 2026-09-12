"""R3-M12 (QA_REGRESSION_ROUND3_CROSSCUT.md X-R3-07): the invite endpoints
accepted an address that is not one.

`SchoolTeamView.post` and `SchoolTeacherListView.post` only checked that the
field was non-empty. Live:

    POST /school/team/     {"email": "not-an-email", "name": "x"}
      -> 201 {"id": "39", "existing": false, "email_sent": true}
    POST /school/teachers/ {"email": "not-an-email", "name": "x"}
      -> 201, reusing that same User row and adding a `teacher` role + a
         Teacher record to it

Two invitation e-mails were queued to an unroutable address, the account can
never be onboarded, and nothing in the product can remove the leftover
`User`/`Teacher` rows — the QA run had to leave a ghost user with roles
`[school, teacher]` in the dev database.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from schools.models import School, SchoolMembership, SchoolRole
from teachers.models import Teacher

pytestmark = pytest.mark.django_db
User = get_user_model()

INVALID = ["not-an-email", "a@b", "@example.com", "spaced out@example.com", "no-at-sign.example.com"]


@pytest.fixture
def school():
    for key in ("owner", "admin", "staff"):
        SchoolRole.objects.update_or_create(
            key=key, defaults={"label": key.title(), "builtin": True, "permissions": ["team", "teachers"]}
        )
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com", active=True
    )


@pytest.fixture
def owner_client(school):
    user = User.objects.create(
        email=f"own-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


@pytest.mark.parametrize("email", INVALID)
def test_a_team_invite_with_an_invalid_email_creates_nothing(owner_client, email):
    resp = owner_client.post("/api/school/team/", {"email": email, "name": "QA Ghost"}, format="json")

    assert resp.status_code == 400, (email, resp.content)
    assert not User.objects.filter(email=email).exists()
    assert not SchoolMembership.objects.filter(profile__email=email).exists()


@pytest.mark.parametrize("email", INVALID)
def test_a_teacher_invite_with_an_invalid_email_creates_nothing(owner_client, email):
    resp = owner_client.post("/api/school/teachers/", {"email": email, "name": "QA Ghost"}, format="json")

    assert resp.status_code == 400, (email, resp.content)
    assert not User.objects.filter(email=email).exists()
    assert not Teacher.objects.filter(email=email).exists()


def test_editing_a_member_to_an_invalid_email_is_refused(owner_client, school):
    """Same field, same view — closing the invite and leaving the edit open
    would just move where the unreachable row comes from."""
    member_user = User.objects.create(
        email=f"m-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school
    )
    membership = SchoolMembership.objects.create(profile=member_user, school=school, sub_role="staff")
    original = member_user.email

    resp = owner_client.patch(
        "/api/school/team/", {"id": str(membership.id), "email": "not-an-email"}, format="json"
    )

    assert resp.status_code == 400, resp.content
    member_user.refresh_from_db()
    assert member_user.email == original


def test_a_valid_team_invite_still_works(owner_client):
    email = f"new-{uuid.uuid4().hex[:8]}@example.com"

    resp = owner_client.post("/api/school/team/", {"email": email, "name": "QA Staff"}, format="json")

    assert resp.status_code == 201, resp.content
    assert User.objects.filter(email=email).exists()


def test_a_valid_teacher_invite_still_works(owner_client):
    email = f"new-{uuid.uuid4().hex[:8]}@example.com"

    resp = owner_client.post("/api/school/teachers/", {"email": email, "name": "QA Teacher"}, format="json")

    assert resp.status_code == 201, resp.content
    assert Teacher.objects.filter(email=email).exists()


def test_an_uppercase_address_is_still_normalised(owner_client):
    """The old code lowercased as it read; the shared helper has to keep
    doing that or a school could end up with two rows for one person."""
    local = f"Mixed-{uuid.uuid4().hex[:8]}"

    resp = owner_client.post(
        "/api/school/team/", {"email": f"{local}@Example.COM", "name": "QA Staff"}, format="json"
    )

    assert resp.status_code == 201, resp.content
    assert User.objects.filter(email=f"{local.lower()}@example.com").exists()


def test_a_missing_email_still_says_so(owner_client):
    resp = owner_client.post("/api/school/team/", {"name": "QA Staff"}, format="json")
    assert resp.status_code == 400, resp.content


# --- R4-M10 / X-R4-04: RFC-valid but unroutable addresses are refused too ---

UNROUTABLE = ["a@localhost", '"quoted"@example.com', "a@[127.0.0.1]", "a@example.", "x" * 300 + "@example.com"]


@pytest.mark.parametrize("address", UNROUTABLE)
def test_team_invite_refuses_an_unroutable_address(owner_client, address):
    """Django's `validate_email` accepts all of these; each one created a
    ghost User (and the 300-char local part answered 500)."""
    before = User.objects.count()
    resp = owner_client.post("/api/school/team/", {"email": address, "name": "Ghost"}, format="json")
    assert resp.status_code == 400, resp.content
    assert User.objects.count() == before


@pytest.mark.parametrize("address", UNROUTABLE)
def test_teacher_invite_refuses_an_unroutable_address(owner_client, address):
    before = (User.objects.count(), Teacher.objects.count())
    resp = owner_client.post("/api/school/teachers/", {"email": address, "name": "Ghost"}, format="json")
    assert resp.status_code == 400, resp.content
    assert (User.objects.count(), Teacher.objects.count()) == before


def test_a_plain_dotted_address_is_still_accepted(owner_client):
    resp = owner_client.post(
        "/api/school/team/", {"email": f"fine-{uuid.uuid4().hex[:6]}@example.com", "name": "Fine"}, format="json"
    )
    assert resp.status_code == 201, resp.content
