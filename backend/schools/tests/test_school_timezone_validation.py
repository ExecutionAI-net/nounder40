"""R3-M11 (QA_REGRESSION_ROUND3_CROSSCUT.md X-R3-05 / SCH-R3-10):
`School.timezone` was never validated.

The field arrived with PR #88 (the R2-H14 fix, which stopped interpreting a
lesson's naive date+time in the server's zone). Nothing ever checked what was
written into it:

    PATCH /school/profile/ {"timezone": "Mars/Olympus"}  -> 200, stored

Both readers fall back to UTC on an unknown zone —
`bookings/services.py::_lesson_datetime` (`except ZoneInfoNotFoundError`) and
`frontend/src/lib/school-time.ts`. That fallback is what makes it invisible:
no error anywhere, just every cancellation and min-notice decision for that
school computed an offset away from its real wall clock — the R2-H14 bug
again, now re-openable by a typo in Settings.
"""
import uuid
from zoneinfo import ZoneInfo

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
    for key in ("owner", "admin", "staff"):
        SchoolRole.objects.update_or_create(
            key=key, defaults={"label": key.title(), "builtin": True, "permissions": ["settings"]}
        )
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com",
        active=True, timezone="Europe/Rome",
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


@pytest.mark.parametrize("value", ["Mars/Olympus", "Europe/Roma", "CEST", "", "   ", "not a zone"])
def test_an_unknown_timezone_is_refused(owner_client, school, value):
    resp = owner_client.patch("/api/school/profile/", {"timezone": value}, format="json")

    assert resp.status_code == 400, (value, resp.content)
    school.refresh_from_db()
    assert school.timezone == "Europe/Rome"


@pytest.mark.parametrize("value", ["Europe/Rome", "Europe/Madrid", "America/New_York", "UTC"])
def test_a_real_iana_timezone_is_accepted(owner_client, school, value):
    resp = owner_client.patch("/api/school/profile/", {"timezone": value}, format="json")

    assert resp.status_code == 200, (value, resp.content)
    school.refresh_from_db()
    assert school.timezone == value


def test_a_stored_timezone_never_needs_the_utc_fallback(owner_client, school):
    """The point of validating here: whatever passes must be loadable by the
    readers, so `ZoneInfoNotFoundError` can no longer be reached through the
    Settings form."""
    resp = owner_client.patch("/api/school/profile/", {"timezone": "Europe/Madrid"}, format="json")
    assert resp.status_code == 200, resp.content

    school.refresh_from_db()
    assert ZoneInfo(school.timezone).key == "Europe/Madrid"


def test_an_edit_that_does_not_touch_the_timezone_is_unaffected(owner_client, school):
    resp = owner_client.patch("/api/school/profile/", {"city": "Milano"}, format="json")

    assert resp.status_code == 200, resp.content
    school.refresh_from_db()
    assert (school.city, school.timezone) == ("Milano", "Europe/Rome")
