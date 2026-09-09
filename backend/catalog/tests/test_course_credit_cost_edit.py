"""R3-M9 (QA_REGRESSION_ROUND3_CROSSCUT.md X-R3-03): the course-edit page
could still set a negative credit cost.

PR #99 (R2-H9) taught `catalog/course_views.py` that a course cannot cost
zero or less — but only the wizard (`courses-create`) and the full-edit
path. `PATCH /api/school/courses/{id}/` goes through the plain
`CourseSerializer` (`fields="__all__"`), which had no validation at all:

    PATCH {"credit_cost": -1}    -> 200, stored -1
    PATCH {"credit_cost": 0}     -> 200, stored 0
    PATCH {"credit_cost": -0.5}  -> 200, stored -0.5

That is the R2-H9 bug again, reachable from the ordinary edit form: booking a
lesson on a negative-cost course *adds* credits to the wallet instead of
deducting them.
"""
import uuid
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from catalog.models import Course, LessonType
from schools.models import School, SchoolMembership, SchoolRole

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    for key in ("owner", "admin", "staff"):
        SchoolRole.objects.update_or_create(
            key=key, defaults={"label": key.title(), "builtin": True, "permissions": ["courses"]}
        )
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com", active=True
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


@pytest.fixture
def course(school):
    lesson_type = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    return Course.objects.create(school=school, lesson_type=lesson_type, credit_cost=Decimal("1"), name="QA Course")


@pytest.mark.parametrize("value", [-1, 0, "-0.5", "0"])
def test_a_non_positive_credit_cost_is_refused(owner_client, course, value):
    resp = owner_client.patch(f"/api/school/courses/{course.id}/", {"credit_cost": value}, format="json")

    assert resp.status_code == 400, (value, resp.content)
    course.refresh_from_db()
    assert course.credit_cost == Decimal("1")


def test_a_non_half_step_credit_cost_is_refused(owner_client, course):
    """The same rule the wizard applies: 1.25 is not a credit cost, and the
    column would silently round it to 1.3 on save."""
    resp = owner_client.patch(f"/api/school/courses/{course.id}/", {"credit_cost": "1.25"}, format="json")

    assert resp.status_code == 400, resp.content
    course.refresh_from_db()
    assert course.credit_cost == Decimal("1")


def test_a_non_numeric_credit_cost_is_refused(owner_client, course):
    resp = owner_client.patch(f"/api/school/courses/{course.id}/", {"credit_cost": "abc"}, format="json")
    assert resp.status_code == 400, resp.content


@pytest.mark.parametrize("value,expected", [(2, Decimal("2")), ("1.5", Decimal("1.5")), ("0.5", Decimal("0.5"))])
def test_a_valid_credit_cost_still_saves(owner_client, course, value, expected):
    resp = owner_client.patch(f"/api/school/courses/{course.id}/", {"credit_cost": value}, format="json")

    assert resp.status_code == 200, resp.content
    course.refresh_from_db()
    assert course.credit_cost == expected


def test_an_edit_that_does_not_touch_the_cost_is_unaffected(owner_client, course):
    """`validate_credit_cost` only runs when the field is sent — a PATCH of
    the name must not start demanding one."""
    resp = owner_client.patch(f"/api/school/courses/{course.id}/", {"name": "Renamed"}, format="json")

    assert resp.status_code == 200, resp.content
    course.refresh_from_db()
    assert course.name == "Renamed"
    assert course.credit_cost == Decimal("1")


def test_the_wizard_path_still_enforces_the_same_rule(owner_client, school):
    """The rule moved to catalog/services.py — the original call sites must
    still be wired to it."""
    from datetime import date, timedelta

    lesson_type = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    resp = owner_client.post(
        "/api/school/courses-create/",
        {
            "lesson_type_id": str(lesson_type.id), "name": "Negative", "credit_cost": -1,
            "schedules": [{
                "start_date": (date.today() + timedelta(days=1)).isoformat(),
                "start_time": "10:00", "duration_minutes": 60, "frequency": "single",
            }],
        },
        format="json",
    )

    assert resp.status_code == 400, resp.content
    assert not Course.objects.filter(school=school, name="Negative").exists()
