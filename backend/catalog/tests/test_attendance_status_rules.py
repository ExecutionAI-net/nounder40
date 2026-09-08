"""SCH-R2-23: AttendanceStatus allowed two school-scoped bugs:

- duplicate names within the same school (two rows both called "Presente"),
  making the UI's status picker ambiguous;
- multiple rows with is_default=True at once, leaving "the" default
  undefined.

(a) adds a (school, name) UniqueConstraint so a duplicate name is rejected
with a clean 400 (mirrors commerce.DiscountCode's (school, code) constraint).
(b) has AttendanceStatusSerializer unset is_default on the school's other
rows whenever a new one is saved with is_default=True.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from catalog.models import AttendanceStatus
from schools.models import School

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def setup():
    school = School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")
    staff = User.objects.create(
        email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    client = APIClient()
    client.force_authenticate(staff)
    return client, school


def test_duplicate_name_within_school_rejected(setup):
    client, school = setup
    AttendanceStatus.objects.create(school=school, name="Presente", burns_credit=False)

    resp = client.post("/api/school/attendance-statuses/", {"name": "Presente", "burns_credit": False}, format="json")

    assert resp.status_code == 400, resp.content
    assert AttendanceStatus.objects.filter(school=school, name="Presente").count() == 1


def test_same_name_allowed_in_different_school(setup):
    client, school = setup
    other_school = School.objects.create(name="Other", slug=f"s-{uuid.uuid4().hex[:8]}", email="o@example.com")
    AttendanceStatus.objects.create(school=other_school, name="Presente", burns_credit=False)

    resp = client.post("/api/school/attendance-statuses/", {"name": "Presente", "burns_credit": False}, format="json")

    assert resp.status_code == 201, resp.content


def test_creating_new_default_unsets_previous_default(setup):
    client, school = setup
    first = AttendanceStatus.objects.create(school=school, name="Presente", burns_credit=False, is_default=True)

    resp = client.post(
        "/api/school/attendance-statuses/",
        {"name": "Assente", "burns_credit": True, "is_default": True},
        format="json",
    )

    assert resp.status_code == 201, resp.content
    first.refresh_from_db()
    assert first.is_default is False
    assert AttendanceStatus.objects.filter(school=school, is_default=True).count() == 1


def test_patching_existing_status_to_default_unsets_previous_default(setup):
    client, school = setup
    first = AttendanceStatus.objects.create(school=school, name="Presente", burns_credit=False, is_default=True)
    second = AttendanceStatus.objects.create(school=school, name="Assente", burns_credit=True, is_default=False)

    resp = client.patch(f"/api/school/attendance-statuses/{second.id}/", {"is_default": True}, format="json")

    assert resp.status_code == 200, resp.content
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.is_default is False
    assert second.is_default is True
