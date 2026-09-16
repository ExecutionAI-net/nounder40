"""Reports → Packages (GET /api/school/reports/packages/): a package row also
says how many lessons it is worth when every course it covers costs the same
(the student's own Packages page converts the same way); a package with no
single lesson cost stays in credits."""
import uuid
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from catalog.models import Course, LessonType, Package
from schools.models import School, SchoolStudent
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()
URL = "/api/school/reports/packages/"


def _school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome", cancellation_policy_hours=24,
    )


def _student(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna", school=school)
    SchoolStudent.objects.create(school=school, student=student)
    return student


def test_rows_carry_lessons_only_when_the_package_has_one_lesson_cost():
    school = _school()
    anna = _student(school)
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    Course.objects.create(school=school, lesson_type=lt, name="Sbarra", credit_cost=Decimal("2.0"), min_booking_notice_hours=0)
    priced = Package.objects.create(school=school, credits=Decimal("10.0"), allowed_lesson_types=[str(lt.id)])
    generic = Package.objects.create(school=school, credits=Decimal("10.0"))  # covers every type: no single cost
    in_lessons = StudentPackage.objects.create(
        student=anna, school=school, package=priced, credits_total=Decimal("10.0"), credits_remaining=Decimal("7.0"),
    )
    in_credits = StudentPackage.objects.create(
        student=anna, school=school, package=generic, credits_total=Decimal("10.0"), credits_remaining=Decimal("7.0"),
    )

    hq = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role="hq", roles=["hq"])
    client = APIClient()
    client.force_authenticate(hq)
    res = client.get(URL, {"school": str(school.id)})
    assert res.status_code == 200, res.content
    by_id = {r["id"]: r for r in res.json()["rows"]}

    row = by_id[str(in_lessons.id)]
    assert row["lesson_credit_cost"] == "2.0"
    assert (row["lessons_total"], row["lessons_remaining"]) == (5, 3)  # 7 // 2: the odd credit does not make a lesson
    row = by_id[str(in_credits.id)]
    assert row["lesson_credit_cost"] is None and row["lessons_total"] is None and row["lessons_remaining"] is None
