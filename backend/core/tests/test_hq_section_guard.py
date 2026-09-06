"""QA report, Alto #5: `IsHQ` controlla solo `role == 'hq'`, mai la matrice
`HQRole.permissions`. Un sub-ruolo minimo (support/tech_support: dashboard +
inbox) poteva leggere E scrivere qualsiasi endpoint /api/hq/*, incluso creare
un pacchetto reale via `POST /api/hq/packages/` (dimostrato dal QA, gruppo 4).

Questi test pinnano `HQSectionGuardMiddleware`: un sub-ruolo senza la chiave
richiesta prende 403, chi ce l'ha passa, owner/super_admin non sono mai
bloccati, e i fixture "HQ senza sub-ruolo" di test_hq_reads.py restano a 200
(fail-open, coerente con il guard scuola per i ruoli fuori matrice)."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import HQMember, Role

pytestmark = pytest.mark.django_db


def _jwt_client(user):
    # Il middleware autentica da solo col JWT: force_authenticate non basta
    # (niente header Authorization => il guard non vede nessun utente).
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


def _hq_client(sub_role):
    user = get_user_model().objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role=sub_role
    )
    HQMember.objects.create(user=user, email=user.email, name="QA", sub_role=sub_role)
    return _jwt_client(user)


@pytest.fixture
def support_client():
    """permissions seed: ["dashboard", "inbox"] — nessun accesso alle sezioni sotto."""
    return _hq_client("support")


@pytest.fixture
def tech_support_client():
    """permissions seed: ["dashboard", "inbox"] — lo stesso sub-ruolo che il QA
    ha usato per creare un pacchetto HQ reale."""
    return _hq_client("tech_support")


@pytest.fixture
def operations_client():
    """permissions seed include "packages" e "schools_create_edit"/"schools_activate"."""
    return _hq_client("operations")


@pytest.fixture
def finance_client():
    """permissions seed: dashboard, schools_view, schools_platform_fee, payments, reports."""
    return _hq_client("finance")


@pytest.fixture
def owner_client():
    return _hq_client("owner")


@pytest.fixture
def super_admin_client():
    return _hq_client("super_admin")


@pytest.mark.parametrize("path", [
    "/api/hq/packages/",
    "/api/hq/shop/",
    "/api/hq/schools/",
    "/api/hq/library/",
    "/api/hq/translations/",
    "/api/hq/reports/",
])
def test_support_is_closed_out_of_sections_it_lacks(support_client, path):
    assert support_client.get(path).status_code == 403


def test_support_cannot_write_a_section_it_lacks(support_client):
    resp = support_client.post("/api/hq/packages/", {"name_en": "X"}, format="json")
    assert resp.status_code == 403


def test_tech_support_can_no_longer_create_an_hq_package(tech_support_client):
    """Pins the exact QA finding: tech_support (no 'packages' permission)
    successfully POSTed /api/hq/packages/ and got a real 201 back."""
    from catalog.models import Package

    before = Package.objects.count()
    resp = tech_support_client.post(
        "/api/hq/packages/",
        {"name_en": "QA Exploit Package", "credits": "10", "price": "100", "validity_days": 30},
        format="json",
    )
    assert resp.status_code == 403
    assert resp.json().get("section") == "packages"
    assert Package.objects.count() == before


def test_role_with_the_permission_reads_and_writes_its_section(operations_client):
    from catalog.models import LessonType

    lesson_type = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:8]}", name_en="Hip Hop")

    assert operations_client.get("/api/hq/packages/").status_code != 403
    resp = operations_client.post(
        "/api/hq/packages/",
        {
            "name_en": "Ops Package", "credits": "10", "price": "100", "validity_days": 30,
            "allowed_lesson_types": [str(lesson_type.id)],
        },
        format="json",
    )
    assert resp.status_code == 201, resp.content


def test_finance_reads_payments_and_reports_but_not_packages(finance_client):
    assert finance_client.get("/api/hq/transactions/").status_code != 403
    assert finance_client.get("/api/hq/reports/").status_code != 403
    assert finance_client.get("/api/hq/packages/").status_code == 403


@pytest.mark.parametrize("path", ["/api/hq/schools/", "/api/hq/packages/", "/api/hq/library/"])
def test_owner_and_super_admin_are_never_blocked(owner_client, super_admin_client, path):
    assert owner_client.get(path).status_code != 403
    assert super_admin_client.get(path).status_code != 403


def test_schools_view_vs_activate_split(operations_client, finance_client):
    """`operations` ha schools_create_edit + schools_activate; `finance` ha solo
    schools_view: può leggere le scuole ma non attivarle."""
    from schools.models import School

    school = School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=False
    )

    assert finance_client.get("/api/hq/schools/").status_code != 403
    resp = finance_client.post(f"/api/hq/schools/{school.id}/activate/", {}, format="json")
    assert resp.status_code == 403
    assert resp.json().get("section") == "schools_activate"

    resp = operations_client.post(f"/api/hq/schools/{school.id}/activate/", {}, format="json")
    assert resp.status_code != 403


def test_hq_without_sub_role_stays_fail_open(path=None):
    """Coerente con test_hq_reads.py: un utente HQ senza hq_sub_role/HQMember
    (fixture storiche) non deve iniziare a prendere 403 per colpa di questo
    nuovo layer — la chiusura di quell'endpoint resta compito di IsHQ."""
    user = get_user_model().objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ]
    )
    client = _jwt_client(user)
    assert client.get("/api/hq/packages/").status_code == 200
