"""La matrice ruoli scuola chiude le API delle sezioni che un ruolo non ha,
ma le pagine caricano anche dati di supporto di altre sezioni (Calendario →
insegnanti, chiusure, sedi). Un 403 su una di quelle lasciava la pagina in
"Loading..." per sempre: le letture di supporto devono passare, le scritture
e le sezioni estranee no.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from schools.models import School, SchoolMembership, SchoolRole

pytestmark = pytest.mark.django_db

STAFF_SECTIONS = ["dashboard", "calendar", "courses", "lessons", "students", "documents"]


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


def _jwt_client(user):
    # Il middleware autentica da solo col JWT: force_authenticate non basta
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


@pytest.fixture
def staff_client(school):
    SchoolRole.objects.update_or_create(
        key="staff", defaults={"label": "Staff", "builtin": True, "permissions": STAFF_SECTIONS}
    )
    user = get_user_model().objects.create(
        email=f"staff-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school,
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="staff")
    return _jwt_client(user)


@pytest.mark.parametrize("path", [
    "/api/school/teachers/",
    "/api/school/closures/",
    "/api/school/locations/",
    "/api/school/compensation-plans/",
])
def test_staff_can_read_lookup_data_of_its_sections(staff_client, path):
    assert staff_client.get(path).status_code != 403


@pytest.mark.parametrize("path", [
    "/api/school/compensation-payments/",
    "/api/school/transactions/",
    "/api/school/team/",
])
def test_staff_is_still_closed_out_of_foreign_sections(staff_client, path):
    assert staff_client.get(path).status_code == 403


def test_lookup_exception_is_read_only(staff_client):
    assert staff_client.post("/api/school/teachers/", {}, format="json").status_code == 403
    assert staff_client.post("/api/school/locations/", {}, format="json").status_code == 403


def test_inviting_an_existing_account_grants_the_school_role(school):
    """Un'allieva invitata nel team deve poter entrare nel pannello scuola:
    il guard frontend guarda user.roles."""
    admin = get_user_model().objects.create(
        email=f"adm-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school,
    )
    SchoolMembership.objects.create(profile=admin, school=school, sub_role="admin")
    student = get_user_model().objects.create(
        email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT]
    )
    res = _jwt_client(admin).post(
        "/api/school/team/", {"email": student.email, "name": "Stu", "school_sub_role": "staff"}, format="json"
    )
    assert res.status_code == 201, res.content
    student.refresh_from_db()
    assert Role.SCHOOL in student.roles
    assert student.active_school_id == school.id


def test_profile_reports_the_membership_sub_role(school):
    """Il filtro della sidebar gira su `school_sub_role` del profilo. La colonna
    piatta e' un residuo ETL che l'invito dal Team non scrive: restava vuota, il
    frontend non trovava il ruolo in matrice e mostrava TUTTE le sezioni (Sedi
    compresa, a un ruolo che non le ha). Deve arrivare la membership."""
    SchoolRole.objects.update_or_create(
        key="staff", defaults={"label": "Staff", "builtin": True, "permissions": STAFF_SECTIONS}
    )
    user = get_user_model().objects.create(
        email=f"staff-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school, school_sub_role="",
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="staff")

    res = _jwt_client(user).get("/api/auth/me/")
    assert res.status_code == 200, res.content
    assert res.json()["school_sub_role"] == "staff"


def test_a_role_outside_the_matrix_is_now_denied_not_waved_through(school):
    """R2-M3 (QA_REGRESSION_ROUND2_HQ.md / SCH-R2-06): a sub_role that isn't
    a real SchoolRole key used to fail OPEN here -- no restriction at all,
    more access than any real role gets. A member with an invented sub_role
    (e.g. one accepted by an endpoint that didn't validate it, see
    SchoolTeamView.post) must now be denied every gated section."""
    SchoolRole.objects.update_or_create(
        key="staff", defaults={"label": "Staff", "builtin": True, "permissions": STAFF_SECTIONS}
    )
    user = get_user_model().objects.create(
        email=f"ghost-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school,
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="godmode")
    client = _jwt_client(user)

    assert client.get("/api/school/teachers/").status_code == 403
    assert client.get("/api/school/team/").status_code == 403
    assert client.get("/api/school/closures/").status_code == 403


def test_a_freshly_created_custom_role_is_not_penalized_by_the_matrix_cache(school):
    """The fail-closed change must not turn the 30s matrix cache
    (`_matrix_cache` in core/section_guard.py) into a real-world lockout for
    a role created and assigned within that window: `_role_permissions`
    falls back to a direct DB lookup before declaring a role unknown."""
    # Prime the cache with a snapshot that does NOT include the new role yet
    # (mirrors "role created after the last cache refresh").
    from core.section_guard import _role_permissions

    _role_permissions("some-other-role-to-force-a-cache-read")

    SchoolRole.objects.create(
        key=f"brand-new-{uuid.uuid4().hex[:8]}", label="Brand New", builtin=False,
        permissions=STAFF_SECTIONS,
    )
    role = SchoolRole.objects.get(label="Brand New")
    user = get_user_model().objects.create(
        email=f"newrole-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school,
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role=role.key)
    client = _jwt_client(user)

    assert client.get("/api/school/teachers/").status_code != 403
    assert client.get("/api/school/courses/").status_code != 403


def test_builtin_roles_still_work_as_before_the_fail_closed_change(school):
    """Regression guard: every real built-in/custom role must keep exactly
    the access its matrix grants -- the fail-closed change must only affect
    sub_roles genuinely absent from SchoolRole."""
    SchoolRole.objects.update_or_create(
        key="staff", defaults={"label": "Staff", "builtin": True, "permissions": STAFF_SECTIONS}
    )
    SchoolRole.objects.update_or_create(
        key="admin", defaults={"label": "Admin", "builtin": True, "permissions": [*STAFF_SECTIONS, "team", "packages"]},
    )
    staff = get_user_model().objects.create(
        email=f"staff2-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school,
    )
    SchoolMembership.objects.create(profile=staff, school=school, sub_role="staff")
    admin = get_user_model().objects.create(
        email=f"admin2-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school,
    )
    SchoolMembership.objects.create(profile=admin, school=school, sub_role="admin")
    owner = get_user_model().objects.create(
        email=f"owner3-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school,
    )
    SchoolMembership.objects.create(profile=owner, school=school, sub_role="owner")

    assert _jwt_client(staff).get("/api/school/courses/").status_code != 403
    assert _jwt_client(staff).get("/api/school/team/").status_code == 403
    assert _jwt_client(admin).get("/api/school/team/").status_code != 403
    assert _jwt_client(owner).get("/api/school/team/").status_code != 403
    assert _jwt_client(owner).get("/api/school/transactions/").status_code != 403


def test_profile_sub_role_follows_the_active_school(school):
    """Membro di due scuole con ruoli diversi: vale quello della scuola attiva."""
    other = School.objects.create(name="S2", slug=f"s2-{uuid.uuid4().hex[:8]}", email="s2@example.com")
    user = get_user_model().objects.create(
        email=f"multi-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school, school_sub_role="admin",
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="staff")
    SchoolMembership.objects.create(profile=user, school=other, sub_role="admin")

    assert _jwt_client(user).get("/api/auth/me/").json()["school_sub_role"] == "staff"

    user.active_school = other
    user.save(update_fields=["active_school"])
    assert _jwt_client(user).get("/api/auth/me/").json()["school_sub_role"] == "admin"
