"""GET /api/school/students/ hands each row's package and subscription
names as the four name_* columns, so the Students page can show them in
the viewer's language. It used to send name_en only, and the page stayed
in English whatever language the school user had picked."""
import uuid
from datetime import datetime, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from catalog.models import Package
from schools.models import School, SchoolMembership, SchoolRole, SchoolStudent
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()


def _school():
    from core import section_guard

    # A real role holding the "students" section: the section guard is
    # middleware that reads the JWT itself (see test_student_usage.py).
    SchoolRole.objects.update_or_create(key="admin", defaults={"label": "Admin", "builtin": True, "permissions": ["students"]})
    section_guard._matrix_cache["expires"] = 0.0
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome", active=True,
    )


def _school_client(school):
    user = User.objects.create(
        email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="admin")
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def test_the_roster_carries_the_package_names_in_every_language():
    school = _school()
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    anna = Student.objects.create(user=user, name="Anna", school=school)
    SchoolStudent.objects.create(school=school, student=anna)
    pkg = Package.objects.create(
        school=school, credits=Decimal("10.0"),
        name_en="10 Studio Lessons", name_it="10 Lezioni Sala", name_es="10 Clases Sala", name_fr="10 Cours Salle",
    )
    StudentPackage.objects.create(
        student=anna, school=school, package=pkg, credits_total=Decimal("10.0"), credits_remaining=Decimal("7.0"),
        status="active", expires_at=datetime(2028, 1, 1, tzinfo=dt_timezone.utc),
    )

    res = _school_client(school).get("/api/school/students/")
    assert res.status_code == 200, res.content
    rows = res.json()
    assert len(rows) == 1
    (row_pkg,) = rows[0]["packages"]
    assert row_pkg["name"] == {
        "name_en": "10 Studio Lessons", "name_it": "10 Lezioni Sala", "name_fr": "10 Cours Salle", "name_es": "10 Clases Sala",
    }
    assert Decimal(row_pkg["credits"]) == Decimal("7.0")
