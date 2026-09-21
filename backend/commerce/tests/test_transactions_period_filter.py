"""School → Payments, period filter (Carlo, 2026-09-21): `date_from` /
`date_to` are the school's own days. `created_at__date` truncates in the
current timezone — UTC here — so a card paid at 00:30 on Feb 1 in Rome
(23:30 UTC on Jan 31) used to land in January and the month's totals were
off at both ends."""
import uuid
from datetime import datetime, timezone as dt_tz

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from commerce.models import Transaction
from schools.models import School, SchoolMembership, SchoolRole

pytestmark = pytest.mark.django_db
User = get_user_model()
URL = "/api/school/transactions/"


def _school(tz="Europe/Rome"):
    from core import section_guard

    SchoolRole.objects.update_or_create(
        key="admin", defaults={"label": "Admin", "builtin": True, "permissions": ["payments"]}
    )
    section_guard._matrix_cache["expires"] = 0.0
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone=tz, active=True
    )


def _client(school):
    user = User.objects.create(
        email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="admin")
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _tx(school, at, name):
    return Transaction.objects.create(
        school=school, type="package", product_name=name, amount=50, school_amount=45, platform_fee=5,
        status="completed", created_at=at,
    )


def test_the_period_is_read_in_the_schools_own_days():
    school = _school()
    _tx(school, datetime(2026, 1, 31, 23, 30, tzinfo=dt_tz.utc), "Feb 1 00:30 in Rome")
    _tx(school, datetime(2026, 1, 31, 12, 0, tzinfo=dt_tz.utc), "Jan 31")
    _tx(school, datetime(2026, 2, 28, 23, 30, tzinfo=dt_tz.utc), "Mar 1 00:30 in Rome")
    client = _client(school)

    rows = client.get(URL, {"date_from": "2026-02-01", "date_to": "2026-02-28"}).json()
    assert [r["product_name"] for r in rows] == ["Feb 1 00:30 in Rome"]

    rows = client.get(URL, {"date_from": "2026-01-01", "date_to": "2026-01-31"}).json()
    assert [r["product_name"] for r in rows] == ["Jan 31"]

    rows = client.get(URL, {"date_from": "2026-03-01"}).json()
    assert [r["product_name"] for r in rows] == ["Mar 1 00:30 in Rome"]

    # no period: everything, newest first, product_id carried for the product filter
    rows = client.get(URL).json()
    assert len(rows) == 3 and "product_id" in rows[0]
