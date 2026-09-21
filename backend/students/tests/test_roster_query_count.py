"""GET /api/school/students/ used to run two queries per student (active
packages + subscriptions): ~1,800 for a 900-student school. The count must
not grow with the roster, and the rows must stay exactly as they were --
wallets are per school, so another school's package must never leak in."""
import uuid
from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from catalog.models import Package
from schools.models import School, SchoolStudent
from students.models import Student, StudentPackage
from students.tests.test_school_students_list_names import (
    ROSTER_URL, User, _bought, _school, _school_client, _student,
)

pytestmark = pytest.mark.django_db


def _queries(client):
    with CaptureQueriesContext(connection) as ctx:
        res = client.get(ROSTER_URL)
    assert res.status_code == 200, res.content
    return len(ctx), res.json()


def _enroll(school, n):
    pkg = Package.objects.filter(school=school).first() or Package.objects.create(
        school=school, credits=Decimal("10.0"), name_en="Ten"
    )
    for _ in range(n):
        _bought(_student(school), school, pkg, total="10.0", remaining="5.0")


def test_query_count_does_not_grow_with_the_roster():
    school = _school()
    client = _school_client(school)
    _enroll(school, 2)
    _queries(client)  # warm the one-off caches (section guard, ...) so the counts compare
    small, rows = _queries(client)
    assert len(rows) == 2
    _enroll(school, 30)
    large, rows = _queries(client)
    assert len(rows) == 32
    assert large == small


def test_only_this_schools_active_packages_are_listed():
    school = _school()
    other = School.objects.create(name="O", slug=f"o-{uuid.uuid4().hex[:8]}", email="o@example.com")
    anna = _student(school)
    SchoolStudent.objects.create(school=other, student=anna)
    mine = Package.objects.create(school=school, credits=Decimal("10.0"), name_en="Mine")
    theirs = Package.objects.create(school=other, credits=Decimal("10.0"), name_en="Theirs")
    _bought(anna, school, mine, total="10.0", remaining="4.0")
    _bought(anna, other, theirs, total="10.0", remaining="9.0")
    expired = _bought(anna, school, mine, total="10.0", remaining="0.0")
    StudentPackage.objects.filter(pk=expired.pk).update(status="expired")

    (row,) = _school_client(school).get(ROSTER_URL).json()
    assert [p["name"]["name_en"] for p in row["packages"]] == ["Mine"]
    assert Decimal(row["packages"][0]["credits"]) == Decimal("4.0")
    assert row["subscriptions"] == []
