"""HQ-R3-06: a homepage counter can be a valid integer and still be nonsense.

HQ-R2-04 taught this endpoint to reject a non-integer. `-5` is an integer,
so it went through, was stored as "-5" and shown on the public homepage
whenever real-stats is off.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from translations.models import PlatformSetting

pytestmark = pytest.mark.django_db
User = get_user_model()

URL = "/api/hq/homepage-settings/"
GOOD = {"teachers": 12, "students": 340, "lessonsMonthly": 88, "schools": 4}


@pytest.fixture
def hq_client():
    hq = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role="hq", roles=["hq"])
    client = APIClient()
    client.force_authenticate(hq)
    return client


def _stat(key):
    row = PlatformSetting.objects.filter(key=key).first()
    return None if row is None else row.value


def test_positive_counters_are_stored(hq_client):
    assert hq_client.post(URL, GOOD, format="json").status_code == 200
    assert (_stat("stat_students"), _stat("stat_schools")) == ("340", "4")


def test_zero_is_allowed(hq_client):
    assert hq_client.post(URL, {**GOOD, "students": 0}, format="json").status_code == 200
    assert _stat("stat_students") == "0"


@pytest.mark.parametrize("field", ["teachers", "students", "lessonsMonthly", "schools"])
def test_a_negative_counter_is_refused(hq_client, field):
    hq_client.post(URL, GOOD, format="json")
    before = {k: _stat(k) for k in ("stat_teachers", "stat_students", "stat_lessons_monthly", "stat_schools")}

    resp = hq_client.post(URL, {**GOOD, field: -5}, format="json")
    assert resp.status_code == 400, resp.data
    assert field in str(resp.data)
    after = {k: _stat(k) for k in before}
    assert after == before  # nothing partially written


def test_a_non_integer_is_still_refused(hq_client):
    """HQ-R2-04 must keep working: the bound is added, not swapped in."""
    assert hq_client.post(URL, {**GOOD, "students": "abc"}, format="json").status_code == 400
