"""The school's package-usage views: GET /api/school/students/usage/ (one
student's ACTIVE packages, nothing else) and
GET /api/school/students/packages/<id>/usage/ (one package and every booking
paid with it — the package's credit ledger, refunds included)."""
import uuid
from datetime import date, datetime, time, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from bookings.models import Booking
from bookings.services import book_lesson, cancel_booking
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolMembership, SchoolRole, SchoolStudent
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()
STUDENT_URL = "/api/school/student-usage/"


def _school():
    from core import section_guard

    # A real role holding the "students" section: the section guard is
    # middleware that reads the JWT itself, so these requests go through the
    # matrix. Its 30s cache may hold another module's snapshot of "admin".
    SchoolRole.objects.update_or_create(key="admin", defaults={"label": "Admin", "builtin": True, "permissions": ["students"]})
    section_guard._matrix_cache["expires"] = 0.0
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome",
        cancellation_policy_hours=24, active=True,
    )


def _student(school, name="Anna"):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name=name, school=school)
    SchoolStudent.objects.create(school=school, student=student)
    return student


def _package(student, school, *, name_it="Dieci lezioni", status="active", purchased=None):
    pkg = Package.objects.create(school=school, credits=Decimal("10.0"), name_it=name_it, name_en="Ten lessons")
    return StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=Decimal("10.0"), credits_remaining=Decimal("10.0"),
        status=status, purchased_at=purchased or datetime(2027, 1, 1, tzinfo=dt_timezone.utc),
        expires_at=datetime(2028, 1, 1, tzinfo=dt_timezone.utc),
    )


def _lesson(school, day, course_name=""):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre", name_it="Sbarra")
    course = Course.objects.create(school=school, lesson_type=lt, name=course_name, credit_cost=Decimal("1.5"), min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt, date=day, start_time=time(12, 0), end_time=time(13, 0),
        max_capacity=10, status="scheduled",
    )


def _school_client(school, sub_role="admin"):
    user = User.objects.create(
        email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role=sub_role)
    client = APIClient()  # a real JWT: force_authenticate would slip past the section guard
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _package_url(sp):
    return f"/api/school/student-usage/packages/{sp.id}/"


def test_student_usage_lists_active_packages_only_newest_first():
    school = _school()
    anna = _student(school)
    old = _package(anna, school, name_it="Vecchio", purchased=datetime(2027, 1, 1, tzinfo=dt_timezone.utc))
    new = _package(anna, school, name_it="Nuovo", purchased=datetime(2027, 3, 1, tzinfo=dt_timezone.utc))
    _package(anna, school, name_it="Finito", status="exhausted")
    _package(anna, school, name_it="Scaduto", status="expired")
    # her wallet at another school is that school's business
    other = _school()
    SchoolStudent.objects.create(school=other, student=anna)
    _package(anna, other, name_it="Altrove")

    res = _school_client(school).get(STUDENT_URL, {"student_id": str(anna.id)})
    assert res.status_code == 200, res.content
    body = res.json()
    assert body["student"] == {"id": str(anna.id), "name": "Anna"}
    assert [p["id"] for p in body["packages"]] == [str(new.id), str(old.id)]
    assert body["packages"][0]["name"] == {"name_en": "Ten lessons", "name_it": "Nuovo", "name_fr": "", "name_es": ""}
    assert body["packages"][0]["status"] == "active"
    assert Decimal(body["packages"][0]["credits_remaining"]) == Decimal("10.0")


def test_student_usage_404_for_a_student_not_enrolled_here():
    school, other = _school(), _school()
    zoe = _student(other, "Zoe")
    res = _school_client(school).get(STUDENT_URL, {"student_id": str(zoe.id)})
    assert res.status_code == 404


def test_package_usage_is_the_ledger_of_that_package():
    school = _school()
    anna = _student(school)
    sp = _package(anna, school)
    first = _lesson(school, date(2027, 12, 1), course_name="Classico base")
    second = _lesson(school, date(2027, 12, 2))
    kept = book_lesson(anna, first, now=datetime(2027, 11, 1, 9, 0, tzinfo=dt_timezone.utc))
    refunded = book_lesson(anna, second, now=datetime(2027, 11, 2, 9, 0, tzinfo=dt_timezone.utc))
    cancel_booking(refunded, now=datetime(2027, 11, 20, tzinfo=dt_timezone.utc))  # inside the policy: credit back
    # a booking paid with her OTHER package is not this package's business
    other_pkg = _package(anna, school, name_it="Altro")
    Booking.objects.create(
        student=anna, lesson=_lesson(school, date(2027, 12, 3)), school=school, student_package=other_pkg,
        access_source=Booking.AccessSource.PACKAGE, credits_deducted=Decimal("1.5"),
    )

    res = _school_client(school).get(_package_url(sp))
    assert res.status_code == 200, res.content
    body = res.json()
    assert body["student"] == {"id": str(anna.id), "name": "Anna"}
    assert body["package"]["id"] == str(sp.id)
    assert body["package"]["name"]["name_it"] == "Dieci lezioni"
    assert Decimal(body["package"]["credits_remaining"]) == Decimal("8.5")  # 10 − 1.5; the refunded one came back

    rows = body["bookings"]
    assert [r["id"] for r in rows] == [str(refunded.id), str(kept.id)]  # latest lesson first
    assert rows[1]["course_name"] == "Classico base" and rows[1]["status"] == Booking.Status.CONFIRMED
    assert rows[1]["lesson_date"] == "2027-12-01" and rows[1]["start_time"] == "12:00:00"
    assert Decimal(rows[1]["credits_deducted"]) == Decimal("1.5") and rows[1]["credit_refunded"] is False
    assert rows[0]["status"] == Booking.Status.CANCELLED and rows[0]["credit_refunded"] is True
    assert rows[0]["course_name"] == ""
    assert rows[0]["lesson_type"] == {"name_en": "Barre", "name_it": "Sbarra", "name_fr": "", "name_es": ""}


def test_credits_come_back_as_lessons_when_the_package_has_one_lesson_cost():
    school = _school()
    anna = _student(school)
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    Course.objects.create(school=school, lesson_type=lt, name="Sbarra", credit_cost=Decimal("1.5"), min_booking_notice_hours=0)
    pkg = Package.objects.create(school=school, credits=Decimal("10.0"), name_it="Sei lezioni", allowed_lesson_types=[str(lt.id)])
    sp = StudentPackage.objects.create(
        student=anna, school=school, package=pkg, credits_total=Decimal("10.0"), credits_remaining=Decimal("8.5"),
    )
    plain = _package(anna, school, name_it="Generico")  # no allowed types → no single lesson cost → credits only
    tiny = StudentPackage.objects.create(  # 1 credit at 1.5 a lesson pays no lesson at all → credits, not "0 of 0"
        student=anna, school=school, package=pkg, credits_total=Decimal("1.0"), credits_remaining=Decimal("1.0"),
    )

    res = _school_client(school).get(STUDENT_URL, {"student_id": str(anna.id)})
    assert res.status_code == 200, res.content
    by_id = {p["id"]: p for p in res.json()["packages"]}
    six = by_id[str(sp.id)]
    assert six["lesson_credit_cost"] == "1.5"
    assert (six["lessons_total"], six["lessons_remaining"]) == (6, 5)  # 8.5 // 1.5: the leftover credit is never rounded up
    for credits_only in (by_id[str(plain.id)], by_id[str(tiny.id)]):
        assert credits_only["lesson_credit_cost"] is None
        assert credits_only["lessons_total"] is None and credits_only["lessons_remaining"] is None

    detail = _school_client(school).get(_package_url(sp)).json()["package"]
    assert (detail["lesson_credit_cost"], detail["lessons_total"], detail["lessons_remaining"]) == ("1.5", 6, 5)


def test_package_usage_404_for_another_schools_package():
    school, other = _school(), _school()
    zoe = _student(other, "Zoe")
    sp = _package(zoe, other)
    assert _school_client(school).get(_package_url(sp)).status_code == 404


def test_hq_reads_both_with_the_school_param():
    school = _school()
    anna = _student(school)
    sp = _package(anna, school)
    hq = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role="hq", roles=["hq"])
    client = APIClient()
    client.force_authenticate(hq)
    assert client.get(STUDENT_URL, {"student_id": str(anna.id), "school": str(school.id)}).status_code == 200
    assert client.get(_package_url(sp), {"school": str(school.id)}).status_code == 200
