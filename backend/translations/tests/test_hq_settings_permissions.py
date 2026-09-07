"""QA R2-M18 / X-R2-05: the five HQ settings endpoints checked `is_hq` on
POST only, so any authenticated student/teacher/school token could GET the
HQ namespace (`/hq/brand-settings/` returned the whole platform_settings
dump). The values non-HQ clients legitimately need are served by the public
`PlatformStatsView` (`/api/platform-stats/`), which is what the student
layout, BrandLogo, lib/brand.ts and the landing page actually call — so the
`/api/hq/*` twins can be HQ-only without touching the student or public UI.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from schools.models import School
from translations.models import PlatformSetting

pytestmark = pytest.mark.django_db
User = get_user_model()

ENDPOINTS = [
    "/api/hq/homepage-settings/",
    "/api/hq/brand-settings/",
    "/api/hq/homepage-real-stats/",
    "/api/hq/student-shop-visibility/",
    "/api/hq/student-credits-visibility/",
]


def _client(role):
    user = User.objects.create(
        email=f"{role}-{uuid.uuid4().hex[:8]}@example.com", role=role, roles=[role]
    )
    api = APIClient()
    api.force_authenticate(user=user)
    return api


@pytest.mark.parametrize("url", ENDPOINTS)
@pytest.mark.parametrize("role", [Role.STUDENT, Role.TEACHER, Role.SCHOOL])
def test_non_hq_roles_cannot_read_hq_settings(url, role):
    assert _client(role).get(url).status_code == 403


@pytest.mark.parametrize("url", ENDPOINTS)
def test_hq_can_still_read_hq_settings(url):
    assert _client(Role.HQ).get(url).status_code == 200


@pytest.mark.parametrize("url", ENDPOINTS)
def test_anonymous_is_still_unauthorized(url):
    assert APIClient().get(url).status_code in (401, 403)


def test_the_values_students_need_are_still_public_on_platform_stats():
    School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True)
    PlatformSetting.objects.create(key="student_shop_enabled", value="false")
    PlatformSetting.objects.create(key="student_credits_visible", value="false")
    PlatformSetting.objects.create(key="brand_color_primary", value="#6B1F3A")

    data = APIClient().get("/api/platform-stats/").json()

    assert data["student_shop_enabled"] == "false"
    assert data["student_credits_visible"] == "false"
    assert data["brand_color_primary"] == "#6B1F3A"
