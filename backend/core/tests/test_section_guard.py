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
