"""QA report Critical #4: `profile` is deliberately absent from
`core.section_guard.SECTION_BY_SEGMENT` (GET must stay open to every school
member), which left every PATCH to /api/school/profile/ completely
unchecked — a `staff` member with no `settings` permission could rewrite
*any* School field via `SchoolSerializer`'s `fields = "__all__"`, including
`cancellation_policy_hours`, `platform_fee_percentage`, `active` and Stripe
fields. These tests pin the field-level guard added to `SchoolProfileView`.
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
def school():
    for key, label, perms in (
        ("owner", "Titolare", ["dashboard", "settings"]),
        ("staff", "Staff", ["dashboard"]),
    ):
        SchoolRole.objects.update_or_create(
            key=key, defaults={"label": label, "builtin": True, "permissions": perms}
        )
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", cancellation_policy_hours=24,
    )


def _member_client(school, sub_role):
    user = get_user_model().objects.create(
        email=f"{sub_role}-{uuid.uuid4().hex[:8]}@example.com",
        role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role=sub_role)
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


def test_staff_can_edit_basic_profile_fields(school):
    resp = _member_client(school, "staff").patch("/api/school/profile/", {"phone": "+39 000"}, format="json")
    assert resp.status_code == 200
    school.refresh_from_db()
    assert school.phone == "+39 000"


def test_staff_cannot_change_settings_fields(school):
    resp = _member_client(school, "staff").patch(
        "/api/school/profile/", {"cancellation_policy_hours": 999}, format="json"
    )
    assert resp.status_code == 403
    school.refresh_from_db()
    assert school.cancellation_policy_hours == 24


def test_staff_cannot_touch_hq_only_fields(school):
    resp = _member_client(school, "staff").patch(
        "/api/school/profile/", {"active": True, "platform_fee_percentage": 0}, format="json"
    )
    assert resp.status_code == 403
    school.refresh_from_db()
    assert school.active is False


def test_owner_can_change_settings_fields(school):
    resp = _member_client(school, "owner").patch(
        "/api/school/profile/", {"cancellation_policy_hours": 48}, format="json"
    )
    assert resp.status_code == 200
    school.refresh_from_db()
    assert school.cancellation_policy_hours == 48


def test_owner_cannot_touch_hq_only_fields_either(school):
    resp = _member_client(school, "owner").patch("/api/school/profile/", {"active": True}, format="json")
    assert resp.status_code == 403
