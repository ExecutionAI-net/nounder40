"""QA M-1/M-4: `Package.credits`/`Package.price` had no server-side range
check -- a school could save a package with negative credits (would drain,
not grant, a student's balance) or a negative price (paying the student to
"buy"). `PackageSerializer` already has a `validate()` for the lesson-type
matrix; this adds the missing per-field guards."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from catalog.models import Package
from schools.models import School, SchoolMembership, SchoolRole

pytestmark = pytest.mark.django_db


@pytest.fixture
def school():
    SchoolRole.objects.update_or_create(
        key="owner", defaults={"label": "Owner", "builtin": True, "permissions": ["packages"]}
    )
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


def _owner_client(school):
    user = get_user_model().objects.create(
        email=f"owner-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


def _payload(**overrides):
    payload = {
        "name_en": "Pack", "validity_days": "30",
        "allowed_lesson_types": [], "lesson_type_restriction": "all",
        "credits": "10", "price": "50",
    }
    payload.update(overrides)
    return payload


def test_negative_credits_are_rejected(school):
    resp = _owner_client(school).post("/api/school/packages/", _payload(credits="-5"), format="json")
    assert resp.status_code == 400
    assert "credits" in resp.json()
    assert not Package.objects.filter(name_en="Pack").exists()


def test_zero_credits_are_rejected(school):
    resp = _owner_client(school).post("/api/school/packages/", _payload(credits="0"), format="json")
    assert resp.status_code == 400
    assert "credits" in resp.json()


def test_positive_credits_still_work(school):
    resp = _owner_client(school).post("/api/school/packages/", _payload(credits="0.5"), format="json")
    assert resp.status_code == 201, resp.content
    assert float(Package.objects.get(name_en="Pack").credits) == 0.5


def test_negative_price_is_rejected(school):
    resp = _owner_client(school).post("/api/school/packages/", _payload(price="-1"), format="json")
    assert resp.status_code == 400
    assert "price" in resp.json()
    assert not Package.objects.filter(name_en="Pack").exists()


def test_zero_price_is_a_valid_free_package(school):
    resp = _owner_client(school).post("/api/school/packages/", _payload(price="0"), format="json")
    assert resp.status_code == 201, resp.content
    assert float(Package.objects.get(name_en="Pack").price) == 0.0


def test_negative_credits_rejected_on_patch(school):
    package = Package.objects.create(
        school=school, name_en="Existing", credits=10, price=25, validity_days=90, allowed_lesson_types=[],
    )
    resp = _owner_client(school).patch(
        f"/api/school/packages/{package.id}/", {"credits": "-2"}, format="json"
    )
    assert resp.status_code == 400
    package.refresh_from_db()
    assert float(package.credits) == 10.0
