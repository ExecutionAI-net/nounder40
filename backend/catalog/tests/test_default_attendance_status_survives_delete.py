"""SCH-R3-09: a school must always have exactly one default attendance status.

PR #112 gave the serializer the "at most one" half -- creating or updating a
default unsets the others. Deleting the default was the other half nobody
wrote: the school was left with none, and the register's prefill (which picks
the school's first status by sort order) then had no defined answer.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from catalog.models import AttendanceStatus
from schools.models import School, SchoolMembership

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def owner_client(school):
    user = User.objects.create(
        email=f"own-{uuid.uuid4().hex[:8]}@example.com", role="school", roles=["school"], active_school=school,
    )
    SchoolMembership.objects.create(school=school, profile=user, sub_role="owner")
    client = APIClient()
    client.force_authenticate(user)
    return client


def _status(school, name, *, default=False, order=0, burns=False):
    return AttendanceStatus.objects.create(
        school=school, name=name, is_default=default, sort_order=order, burns_credit=burns,
    )


def _defaults(school):
    return list(
        AttendanceStatus.objects.filter(school=school, is_default=True).values_list("name", flat=True)
    )


def test_deleting_the_default_promotes_the_next_one(school, owner_client):
    present = _status(school, "Presente", default=True, order=0)
    _status(school, "Assente", order=1, burns=True)
    _status(school, "Giustificata", order=2)

    assert owner_client.delete(f"/api/school/attendance-statuses/{present.id}/").status_code == 204
    assert _defaults(school) == ["Assente"]


def test_the_promoted_one_is_the_first_in_the_school_s_own_order(school, owner_client):
    default = _status(school, "Presente", default=True, order=5)
    _status(school, "Terzo", order=3)
    _status(school, "Secondo", order=2)

    owner_client.delete(f"/api/school/attendance-statuses/{default.id}/")
    assert _defaults(school) == ["Secondo"]


def test_deleting_a_non_default_leaves_the_default_alone(school, owner_client):
    _status(school, "Presente", default=True, order=0)
    other = _status(school, "Assente", order=1)

    owner_client.delete(f"/api/school/attendance-statuses/{other.id}/")
    assert _defaults(school) == ["Presente"]


def test_deleting_the_last_status_is_allowed_and_leaves_nothing(school, owner_client):
    """Nothing to promote. Refusing here would trap a school that wants to
    rebuild its list from scratch."""
    only = _status(school, "Presente", default=True)
    assert owner_client.delete(f"/api/school/attendance-statuses/{only.id}/").status_code == 204
    assert not AttendanceStatus.objects.filter(school=school).exists()


def test_another_school_s_statuses_are_not_promoted(school, owner_client):
    other_school = School.objects.create(name="O", slug=f"s-{uuid.uuid4().hex[:8]}", email="o@example.com")
    _status(other_school, "Loro", order=0)
    mine = _status(school, "Presente", default=True, order=0)
    _status(school, "Assente", order=1)

    owner_client.delete(f"/api/school/attendance-statuses/{mine.id}/")
    assert _defaults(school) == ["Assente"]
    assert _defaults(other_school) == []
