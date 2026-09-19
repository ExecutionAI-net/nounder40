"""DELETE /api/school/credits/packages/<id>/ — the school takes a package
out of a student's wallet (assigned by mistake, or bought and to be
undone by hand). A soft delete: the row stays with status "deleted", who
did it and when; the student sees it as "deleted by the school" and it
counts for nothing any more. Refused while lessons were paid with it."""
import uuid
from datetime import date, datetime, time, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from bookings.services import BookingError, book_lesson
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolMembership, SchoolRole, SchoolStudent
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()


def _school():
    from core import section_guard

    SchoolRole.objects.update_or_create(
        key="admin", defaults={"label": "Admin", "builtin": True, "permissions": ["students", "manualCredits"]}
    )
    SchoolRole.objects.update_or_create(key="staff", defaults={"label": "Staff", "builtin": True, "permissions": ["students"]})
    section_guard._matrix_cache["expires"] = 0.0
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome", active=True,
        cancellation_policy_hours=24,
    )


def _student(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT])
    student = Student.objects.create(user=user, name="Anna", school=school)
    SchoolStudent.objects.create(school=school, student=student)
    return student


def _package(student, school):
    pkg = Package.objects.create(school=school, credits=Decimal("10.0"), name_en="Ten")
    return StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=Decimal("10.0"), credits_remaining=Decimal("10.0"),
        status="active", expires_at=datetime(2028, 1, 1, tzinfo=dt_timezone.utc),
    )


def _lesson(school):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(school=school, lesson_type=lt, credit_cost=Decimal("1.5"), min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt, date=date(2027, 6, 1), start_time=time(12, 0), end_time=time(13, 0),
        max_capacity=10, status="scheduled",
    )


def _client_for(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _school_client(school, sub_role="admin"):
    user = User.objects.create(
        email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
        first_name="Marta", last_name="Staff",
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role=sub_role)
    return _client_for(user), user


def _url(sp):
    return f"/api/school/credits/packages/{sp.id}/"


def test_a_deleted_package_counts_for_nothing_and_the_student_sees_why():
    school = _school()
    anna = _student(school)
    sp = _package(anna, school)
    client, marta = _school_client(school)

    res = client.delete(_url(sp))
    assert res.status_code == 200, res.content
    sp.refresh_from_db()
    assert sp.status == "deleted" and sp.deleted_by_id == marta.id and sp.deleted_at is not None
    assert sp.credits_remaining == Decimal("10.0")  # kept: the student's history says what was taken away

    # Out of the wallet and out of booking
    wallet = _client_for(anna.user).get("/api/student/credits/").json()
    assert all(Decimal(str(r["credits"])) == 0 for r in wallet)
    with pytest.raises(BookingError) as exc:
        book_lesson(anna, _lesson(school), now=datetime(2027, 5, 1, tzinfo=dt_timezone.utc))
    assert str(exc.value) == "no_valid_access"

    # Still listed to her, told as deleted, with the movement in her history
    mine = _client_for(anna.user).get("/api/student/packages/").json()
    assert [p["status"] for p in mine] == ["deleted"]
    hist = _client_for(anna.user).get("/api/student/credit-history/").json()
    (row,) = [e for e in hist if e["type"] == "package_deleted"]
    assert Decimal(row["credits"]) == Decimal("-10.0") and row["student_package_id"] == str(sp.id)

    # The school's ledger and Reports keep the row with its status
    assert client.get(f"/api/school/student-usage/packages/{sp.id}/").json()["package"]["status"] == "deleted"
    res = client.delete(_url(sp))
    assert res.status_code == 400 and res.json()["error"] == "already_deleted"


def test_a_package_that_paid_for_lessons_cannot_be_deleted():
    school = _school()
    anna = _student(school)
    sp = _package(anna, school)
    book_lesson(anna, _lesson(school), now=datetime(2027, 5, 1, tzinfo=dt_timezone.utc))
    client, _ = _school_client(school)

    res = client.delete(_url(sp))
    assert res.status_code == 400 and res.json()["error"] == "package_in_use"
    sp.refresh_from_db()
    assert sp.status == "active"


def test_only_the_credits_permission_and_the_own_school():
    school = _school()
    anna = _student(school)
    sp = _package(anna, school)

    staff, _ = _school_client(school, sub_role="staff")  # students section, no manualCredits
    assert staff.delete(_url(sp)).status_code == 403

    other = School.objects.create(
        name="O", slug=f"o-{uuid.uuid4().hex[:8]}", email="o@example.com", timezone="Europe/Rome", active=True,
    )
    elsewhere, _ = _school_client(other)
    assert elsewhere.delete(_url(sp)).status_code == 404
    sp.refresh_from_db()
    assert sp.status == "active"
