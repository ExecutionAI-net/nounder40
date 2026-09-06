"""QA report #9: PackageSerializer.validate() rejects any write where
`allowed_lesson_types` resolves empty ("pick at least one lesson type"),
added deliberately so NEW packages always declare what they cover (mixed
per-credit costs were otherwise impossible to show correctly). But the
frontend sends `allowed_lesson_types` on every PATCH, so this also blocked
re-saving a *legacy* package whose value was already `[]` (the old "valid
for all types" semantics) for ANY edit at all -- even changing just the
price. Fixed by only rejecting empty when it's not a no-op on an
already-empty package."""
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


def test_legacy_all_types_package_can_be_resaved_unchanged(school):
    package = Package.objects.create(
        school=school, name_en="Legacy", credits=10, price=25, validity_days=90, allowed_lesson_types=[],
    )
    resp = _owner_client(school).patch(
        f"/api/school/packages/{package.id}/", {"price": "30", "allowed_lesson_types": []}, format="json"
    )
    assert resp.status_code == 200, resp.content
    package.refresh_from_db()
    assert package.allowed_lesson_types == []
    assert float(package.price) == 30.0


def test_narrowing_an_existing_package_to_specific_types_still_works(school):
    package = Package.objects.create(
        school=school, name_en="Legacy", credits=10, price=25, validity_days=90, allowed_lesson_types=[],
    )
    resp = _owner_client(school).patch(
        f"/api/school/packages/{package.id}/", {"allowed_lesson_types": ["lt-1"]}, format="json"
    )
    assert resp.status_code == 200, resp.content
    package.refresh_from_db()
    assert package.allowed_lesson_types == ["lt-1"]


def test_widening_a_specific_types_package_back_to_empty_is_still_rejected(school):
    """The deliberate rule this validator protects: an already-specific
    package can't be walked back to ambiguous "all types" either."""
    package = Package.objects.create(
        school=school, name_en="Specific", credits=10, price=25, validity_days=90, allowed_lesson_types=["lt-1"],
    )
    resp = _owner_client(school).patch(
        f"/api/school/packages/{package.id}/", {"allowed_lesson_types": []}, format="json"
    )
    assert resp.status_code == 400
    package.refresh_from_db()
    assert package.allowed_lesson_types == ["lt-1"]


def test_creating_a_brand_new_package_still_requires_a_lesson_type(school):
    resp = _owner_client(school).post(
        "/api/school/packages/",
        {"name_en": "New", "credits": "5", "price": "50", "validity_days": "30", "allowed_lesson_types": []},
        format="json",
    )
    assert resp.status_code == 400
    assert not Package.objects.filter(name_en="New").exists()
