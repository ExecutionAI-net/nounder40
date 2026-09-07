"""QA report Critical #4: `profile` is deliberately absent from
`core.section_guard.SECTION_BY_SEGMENT` (GET must stay open to every school
member), which left every PATCH to /api/school/profile/ completely
unchecked — a `staff` member with no `settings` permission could rewrite
*any* School field via `SchoolSerializer`'s `fields = "__all__"`, including
`cancellation_policy_hours`, `platform_fee_percentage`, `active` and Stripe
fields. These tests pin the field-level guard added to `SchoolProfileView`.

QA H-7 (follow-up): the Critical #4 fix above only introduced two allow-lists
(_SCHOOL_SETTINGS_FIELDS, _SCHOOL_HQ_ONLY_FIELDS) — identity fields like
`name`/`email`/`phone`/`address` fell through both with zero permission
check, so `staff` could still rewrite the school's identity. Those fields
are now gated behind the same `settings` permission
(`_SCHOOL_IDENTITY_FIELDS`), and `GET` strips Stripe/platform-fee fields
(`_SCHOOL_SETTINGS_ONLY_READ_FIELDS`) from callers without that permission
(QA L-1).
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from schools.models import School, SchoolMembership, SchoolRole
from schools.views import _SCHOOL_SETTINGS_ONLY_READ_FIELDS

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
        active=True,
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


def test_staff_cannot_edit_identity_fields(school):
    """QA H-7: `staff` (no `settings` permission) could rewrite the school's
    identity — name/email/phone/address/etc — because those fields weren't
    covered by either existing allow-list. Now gated like settings fields."""
    resp = _member_client(school, "staff").patch("/api/school/profile/", {"phone": "+39 000"}, format="json")
    assert resp.status_code == 403
    school.refresh_from_db()
    assert school.phone == ""


@pytest.mark.parametrize(
    "field,value",
    [
        ("name", "Renamed School"),
        ("email", "new@example.com"),
        ("phone", "+39 000"),
        ("address", "Via Roma 1"),
        ("address_line2", "Suite 2"),
        ("city", "Milano"),
        ("province", "MI"),
        ("country", "IT"),
        ("vat_number", "IT12345678901"),
        ("website", "https://example.com"),
        ("logo_url", "https://example.com/logo.png"),
    ],
)
def test_staff_cannot_write_any_identity_field(school, field, value):
    resp = _member_client(school, "staff").patch("/api/school/profile/", {field: value}, format="json")
    assert resp.status_code == 403
    school.refresh_from_db()
    assert getattr(school, field) != value


def test_owner_can_edit_identity_fields(school):
    resp = _member_client(school, "owner").patch("/api/school/profile/", {"phone": "+39 000"}, format="json")
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
        # La scuola nasce attiva nella fixture (R2-M19b: una scuola spenta
        # non e' piu' raggiungibile dal pannello), quindi il tentativo
        # interessante e' SPEGNERLA.
        "/api/school/profile/", {"active": False, "platform_fee_percentage": 0}, format="json"
    )
    assert resp.status_code == 403
    school.refresh_from_db()
    assert school.active is True


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


def test_staff_get_does_not_expose_stripe_or_fee_fields(school):
    """QA L-1: GET returned stripe_account_id/platform_fee_percentage (and
    the sibling billing fields) to every member, including `staff`, who has
    no `settings` permission and no legitimate reason to see them — nothing
    in the school panel's own pages reads them from this endpoint."""
    school.stripe_account_id = "acct_123"
    school.platform_fee_percentage = 12
    school.shop_commission_percentage = 5
    school.stripe_onboarding_complete = True
    school.save()

    resp = _member_client(school, "staff").get("/api/school/profile/")
    assert resp.status_code == 200
    for field in (
        "stripe_account_id", "platform_fee_percentage",
        "shop_commission_percentage", "stripe_onboarding_complete",
    ):
        assert field not in resp.data


def test_owner_get_still_includes_stripe_and_fee_fields(school):
    school.stripe_account_id = "acct_123"
    school.save()

    resp = _member_client(school, "owner").get("/api/school/profile/")
    assert resp.status_code == 200
    assert resp.data["stripe_account_id"] == "acct_123"


def test_staff_get_still_includes_identity_and_settings_fields(school):
    """Read access to identity/settings-tier fields is unchanged — only the
    Stripe/fee fields (and only writes to identity fields) are newly gated."""
    resp = _member_client(school, "staff").get("/api/school/profile/")
    assert resp.status_code == 200
    assert resp.data["name"] == "S"
    assert resp.data["cancellation_policy_hours"] == 24


def test_staff_patch_response_hides_the_same_fields_as_get(school):
    """R2-L11a: the read-side filter was applied to GET only, so `staff`
    could print the Stripe/fee fields it is not allowed to see simply by
    sending an empty PATCH. GET and the PATCH response now go through the
    same `_readable()` helper."""
    school.stripe_account_id = "acct_123"
    school.platform_fee_percentage = 12
    school.shop_commission_percentage = 5
    school.stripe_onboarding_complete = True
    school.save()

    api = _member_client(school, "staff")
    get_resp = api.get("/api/school/profile/")
    patch_resp = api.patch("/api/school/profile/", {}, format="json")

    assert get_resp.status_code == 200
    assert patch_resp.status_code == 200
    assert set(patch_resp.data) == set(get_resp.data)
    for field in _SCHOOL_SETTINGS_ONLY_READ_FIELDS:
        assert field not in patch_resp.data


def test_staff_patch_of_an_allowed_field_still_works(school):
    """The filter must not turn into a write block: `timezone` is in none of
    the three allow-lists, so `staff` may still change it."""
    api = _member_client(school, "staff")
    resp = api.patch("/api/school/profile/", {"timezone": "Europe/Madrid"}, format="json")
    assert resp.status_code == 200
    assert resp.data["timezone"] == "Europe/Madrid"
    school.refresh_from_db()
    assert school.timezone == "Europe/Madrid"
    for field in _SCHOOL_SETTINGS_ONLY_READ_FIELDS:
        assert field not in resp.data


def test_owner_patch_response_still_carries_the_full_record(school):
    school.stripe_account_id = "acct_123"
    school.save()

    api = _member_client(school, "owner")
    get_resp = api.get("/api/school/profile/")
    patch_resp = api.patch("/api/school/profile/", {"phone": "+39 111"}, format="json")

    assert patch_resp.status_code == 200
    assert set(patch_resp.data) == set(get_resp.data)
    for field in _SCHOOL_SETTINGS_ONLY_READ_FIELDS:
        assert field in patch_resp.data
    assert patch_resp.data["stripe_account_id"] == "acct_123"
