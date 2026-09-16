"""One credits-to-lessons rule for both sides (catalog.services
.student_package_lessons): what the student reads on /api/student/packages/
is what the school reads in the usage modal — including a package too small
to pay one lesson, which both tell in credits (None), never as "0 of 0"."""
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


def _lessons(row):
    return row["lesson_credit_cost"], row["lessons_total"], row["lessons_remaining"]


def test_student_reads_the_same_lessons_as_the_school():
    school = School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna", school=school)
    SchoolStudent.objects.create(school=school, student=student)
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    Course.objects.create(school=school, lesson_type=lt, name="Sbarra", credit_cost=Decimal("1.5"), min_booking_notice_hours=0)
    pkg = Package.objects.create(school=school, credits=Decimal("10.0"), allowed_lesson_types=[str(lt.id)])
    six = StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=Decimal("10.0"), credits_remaining=Decimal("8.5"),
    )
    tiny = StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=Decimal("1.0"), credits_remaining=Decimal("1.0"),
    )
    used_up = StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=Decimal("3.0"), credits_remaining=Decimal("0"),
    )

    api = APIClient()
    api.force_authenticate(user)
    rows = {r["id"]: r for r in api.get("/api/student/packages/").json()}
    assert _lessons(rows[str(six.id)]) == ("1.5", 6, 5)
    assert _lessons(rows[str(tiny.id)]) == (None, None, None)  # in credits, not "0 of 0 lessons"
    assert _lessons(rows[str(used_up.id)]) == ("1.5", 2, 0)  # zero REMAINING is real information
