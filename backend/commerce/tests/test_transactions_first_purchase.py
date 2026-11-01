"""Payments: the "first purchase" badges (Carlo, 2026-11-01). Per student and
school, over her whole completed lesson-purchase history: the very first
purchase is "single" (a drop-in package) or "package"; when she started
with a single, her first real package is "package_after_single". Filterable
with ?first=."""
import uuid
from datetime import datetime, timezone as dt_tz
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from catalog.models import Package
from commerce.models import Transaction
from schools.models import School, SchoolMembership
from students.models import Student

pytestmark = pytest.mark.django_db
User = get_user_model()
TX = "/api/school/transactions/"


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def api(school):
    user = User.objects.create(email=f"u-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school)
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    api = APIClient()
    api.force_authenticate(user=user)
    return api


def _student(school, name):
    user = User.objects.create(email=f"{name}-{uuid.uuid4().hex[:6]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT])
    return Student.objects.create(user=user, name=name, school=school)


def _tx(school, student, package, day, status="completed", typ="package"):
    return Transaction.objects.create(
        school=school, student=student, type=typ, product_id=package.id if package else None,
        product_name="x", amount=10, school_amount=10, status=status, payment_method="stripe",
        created_at=datetime(2026, 10, day, 12, tzinfo=dt_tz.utc),
    )


def test_badges_follow_each_student_history(api, school):
    single = Package.objects.create(school=school, credits=Decimal("1.0"), name_en="Single", is_drop_in=True)
    ten = Package.objects.create(school=school, credits=Decimal("10.0"), name_en="Ten")
    anna, bea, cri, dea = _student(school, "anna"), _student(school, "bea"), _student(school, "cri"), _student(school, "dea")
    # Anna: single, single, package, package -> single / - / package_after_single / -
    a1, a2, a3, a4 = (_tx(school, anna, p, d) for p, d in ((single, 1), (single, 3), (ten, 5), (ten, 7)))
    # Bea: package first, then a single -> package / -
    b1, b2 = _tx(school, bea, ten, 2), _tx(school, bea, single, 4)
    # Cri: a pending one does not count, her first completed is the package
    c0, c1 = _tx(school, cri, single, 1, status="pending"), _tx(school, cri, ten, 6)
    # a shop row never carries a badge
    s1 = _tx(school, anna, None, 8, typ="shop")
    # Dea: an event ticket is a drop-in package too, but not a "single"
    from catalog.models import Course
    gala = Course.objects.create(school=school, is_special_event=True, credit_cost=Decimal("1.0"), min_booking_notice_hours=0)
    ticket = Package.objects.create(school=school, credits=Decimal("1.0"), name_en="Gala ticket", is_drop_in=True, event=gala)
    d1, d2 = _tx(school, dea, ticket, 1), _tx(school, dea, ten, 3)

    rows = {r["id"]: r["first_purchase"] for r in api.get(TX).json()}
    assert rows[str(a1.id)] == "single" and rows[str(a2.id)] is None
    assert rows[str(a3.id)] == "package_after_single" and rows[str(a4.id)] is None
    assert rows[str(b1.id)] == "package" and rows[str(b2.id)] is None
    assert rows[str(c0.id)] is None and rows[str(c1.id)] == "package"
    assert rows[str(s1.id)] is None
    assert rows[str(d1.id)] == "package" and rows[str(d2.id)] is None

    # the filter keeps only the badged rows asked for
    ids = {r["id"] for r in api.get(TX, {"first": "single,package_after_single"}).json()}
    assert ids == {str(a1.id), str(a3.id)}
    ids = {r["id"] for r in api.get(TX, {"first": "package"}).json()}
    assert ids == {str(b1.id), str(c1.id), str(d1.id)}
    # the filter and the period filter compose: nothing of Bea before the 2nd
    assert api.get(TX, {"first": "package", "date_from": "2026-10-03"}).json() == [] or all(
        r["id"] != str(b1.id) for r in api.get(TX, {"first": "package", "date_from": "2026-10-03"}).json())
    # an unknown value is ignored: the full (capped) list, badges included
    bogus = api.get(TX, {"first": "bogus"}).json()
    assert len(bogus) == 11 and {r["id"]: r["first_purchase"] for r in bogus}[str(a1.id)] == "single"


def test_history_is_per_school(api, school):
    other = School.objects.create(name="O", slug=f"o-{uuid.uuid4().hex[:8]}", email="o@example.com")
    ten = Package.objects.create(school=school, credits=Decimal("10.0"), name_en="Ten")
    anna = _student(school, "anna")
    _tx(other, anna, ten, 1)  # her first purchase was in another school
    mine = _tx(school, anna, ten, 2)
    rows = {r["id"]: r["first_purchase"] for r in api.get(TX).json()}
    assert rows == {str(mine.id): "package"}


def test_student_filter_is_server_side(api, school):
    ten = Package.objects.create(school=school, credits=Decimal("10.0"), name_en="Ten")
    anna, bea = _student(school, "anna"), _student(school, "bea")
    a1, b1 = _tx(school, anna, ten, 1), _tx(school, bea, ten, 2)
    ids = {r["id"] for r in api.get(TX, {"student": str(anna.id)}).json()}
    assert ids == {str(a1.id)}
    ids = {r["id"] for r in api.get(TX, {"student": f"{anna.id},{bea.id}"}).json()}
    assert ids == {str(a1.id), str(b1.id)}
    assert api.get(TX, {"student": "not-a-uuid"}).status_code == 400
