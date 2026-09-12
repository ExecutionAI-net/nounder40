"""Found while verifying R4-H2 live on dev: the school-side cancellation
(`DELETE /api/school/classes/<id>/`) answered `{"cancelled": true,
"refunded": 1}` and the credit went back into the package -- but the package
had been flipped to `exhausted` when that booking consumed its last credit,
and `refund_bookings()` never flipped it back. `/api/student/credits/` and
`_active_package()` only count `active` packages, so the refund was true on
the booking row and invisible everywhere else: the balance stayed the same
and the credit could not be spent again. `cancel_booking()` (the student's
own cancellation) already re-activates the package; the school path now does
the same, and gives a free first lesson back as well.
"""
import uuid
from datetime import date, datetime, time, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from bookings.models import Booking
from bookings.services import book_lesson
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolMembership, SchoolStudent
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()

NOW = datetime(2027, 4, 1, tzinfo=dt_timezone.utc)


@pytest.fixture
def school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        timezone="Europe/Rome", cancellation_policy_hours=24,
    )


@pytest.fixture
def owner_client(school):
    user = User.objects.create(
        email=f"own-{uuid.uuid4().hex[:8]}@example.com", role="school", roles=["school"], active_school=school,
    )
    SchoolMembership.objects.create(school=school, profile=user, sub_role="owner")
    client = APIClient()
    client.force_authenticate(user)
    return client


def _lesson(school, day=date(2027, 5, 10)):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(
        school=school, lesson_type=lt, credit_cost=Decimal("1.0"), min_booking_notice_hours=0
    )
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt,
        date=day, start_time=time(12, 0), end_time=time(13, 0), max_capacity=10, status="scheduled",
    )


def _student(school, credits):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role="student", roles=["student"])
    student = Student.objects.create(user=user, name="Anna", school=school)
    ss = SchoolStudent.objects.create(school=school, student=student)
    sp = None
    if credits:
        pkg = Package.objects.create(school=school, credits=Decimal(credits))
        sp = StudentPackage.objects.create(
            student=student, school=school, package=pkg,
            credits_total=Decimal(credits), credits_remaining=Decimal(credits),
            expires_at=datetime(2028, 1, 1, tzinfo=dt_timezone.utc),
        )
    return student, ss, sp


def _student_client(student):
    client = APIClient()
    client.force_authenticate(student.user)
    return client


def test_school_cancellation_reactivates_a_package_the_booking_had_exhausted(school, owner_client):
    lesson = _lesson(school)
    student, _, sp = _student(school, "1.0")
    book_lesson(student, lesson, now=NOW)
    sp.refresh_from_db()
    assert (sp.credits_remaining, sp.status) == (Decimal("0.0"), "exhausted")

    resp = owner_client.delete(f"/api/school/classes/{lesson.pk}/")

    assert resp.status_code == 200, resp.content
    assert resp.json() == {"cancelled": True, "refunded": 1}
    sp.refresh_from_db()
    assert (sp.credits_remaining, sp.status) == (Decimal("1.0"), "active")
    # ...and the balance the student sees agrees with the booking row.
    balance = _student_client(student).get("/api/student/credits/").json()
    assert Decimal(str(balance[0]["credits"])) == Decimal("1.0")


def test_the_refunded_credit_can_be_spent_again(school, owner_client):
    lesson = _lesson(school)
    student, _, sp = _student(school, "1.0")
    book_lesson(student, lesson, now=NOW)
    owner_client.delete(f"/api/school/classes/{lesson.pk}/")

    second = _lesson(school, day=date(2027, 5, 17))
    booking = book_lesson(student, second, now=NOW)

    assert booking.access_source == Booking.AccessSource.PACKAGE
    assert booking.credits_deducted == Decimal("1.0")
    sp.refresh_from_db()
    assert (sp.credits_remaining, sp.status) == (Decimal("0.0"), "exhausted")


def test_a_package_with_credits_left_is_not_touched_by_the_status_rule(school, owner_client):
    lesson = _lesson(school)
    student, _, sp = _student(school, "10.0")
    book_lesson(student, lesson, now=NOW)
    owner_client.delete(f"/api/school/classes/{lesson.pk}/")
    sp.refresh_from_db()
    assert (sp.credits_remaining, sp.status) == (Decimal("10.0"), "active")


def test_school_cancellation_gives_a_free_first_lesson_back(school, owner_client):
    school.free_first_lesson = True
    school.save(update_fields=["free_first_lesson"])
    lesson = _lesson(school)
    student, ss, _ = _student(school, None)
    booking = book_lesson(student, lesson, now=NOW)
    assert booking.access_source == Booking.AccessSource.FREE_LESSON
    ss.refresh_from_db()
    assert ss.free_lesson_used is True

    resp = owner_client.delete(f"/api/school/classes/{lesson.pk}/")

    assert resp.status_code == 200, resp.content
    ss.refresh_from_db()
    assert ss.free_lesson_used is False
