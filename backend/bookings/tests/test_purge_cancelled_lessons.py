"""Carlo, 13/09/2026: cancelled lessons never leave the calendar. Cancelling
(DELETE /school/classes/<id>/) refunds and keeps the row visible on purpose;
this is the second step that deletes the row for good, from every view.

Guard rails: only a cancelled lesson can be purged, and not while it still
holds a confirmed booking (a `status` PATCH skips the refund) -- so the
credit always went back before the history disappears. The plain
`DELETE /school/lessons/<id>/` rule from R4-H2 is untouched.
"""
import uuid
from datetime import date, datetime, time, timedelta
from datetime import timezone as dt_timezone
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


def _school(name="S"):
    return School.objects.create(
        name=name, slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com",
        timezone="Europe/Rome", cancellation_policy_hours=24,
    )


def _owner_client(school):
    user = User.objects.create(
        email=f"own-{uuid.uuid4().hex[:8]}@example.com", role="school", roles=["school"], active_school=school,
    )
    SchoolMembership.objects.create(school=school, profile=user, sub_role="owner")
    client = APIClient()
    client.force_authenticate(user)
    return client


def _lesson(school, day=date(2027, 5, 10), status="scheduled"):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(school=school, lesson_type=lt, credit_cost=Decimal("1.0"), min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt, date=day, start_time=time(12, 0), end_time=time(13, 0),
        max_capacity=10, status=status,
    )


def _student_with_credits(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna", school=school)
    SchoolStudent.objects.create(school=school, student=student)
    pkg = Package.objects.create(school=school, credits=Decimal("10.0"))
    sp = StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=Decimal("10.0"),
        credits_remaining=Decimal("10.0"), expires_at=datetime(2028, 1, 1, tzinfo=dt_timezone.utc),
    )
    return student, sp


def test_a_scheduled_lesson_cannot_be_purged():
    school = _school()
    lesson = _lesson(school)
    resp = _owner_client(school).delete(f"/api/school/classes/{lesson.pk}/purge/")
    assert resp.status_code == 409
    assert resp.json()["error"] == "not_cancelled"
    assert Lesson.objects.filter(pk=lesson.pk).exists()


def test_cancel_with_refund_then_purge_removes_the_lesson_and_keeps_the_credit():
    school = _school()
    client = _owner_client(school)
    lesson = _lesson(school)
    student, sp = _student_with_credits(school)
    booking = book_lesson(student, lesson, now=NOW)
    sp.refresh_from_db()
    assert sp.credits_remaining == Decimal("9.0")

    # Step 1: cancel + refund (the button the UI already has)
    assert client.delete(f"/api/school/classes/{lesson.pk}/").status_code == 200
    sp.refresh_from_db()
    booking.refresh_from_db()
    assert sp.credits_remaining == Decimal("10.0") and booking.status == "cancelled"

    # Step 2: purge
    resp = client.delete(f"/api/school/classes/{lesson.pk}/purge/")
    assert resp.status_code == 200, resp.content
    assert resp.json() == {"deleted": 1}
    assert not Lesson.objects.filter(pk=lesson.pk).exists()
    assert not Booking.objects.filter(pk=booking.pk).exists()
    sp.refresh_from_db()
    assert sp.credits_remaining == Decimal("10.0")  # the refund is not undone by the purge


def test_a_lesson_flagged_cancelled_by_patch_but_still_booked_is_refused():
    school = _school()
    lesson = _lesson(school)
    student, sp = _student_with_credits(school)
    book_lesson(student, lesson, now=NOW)
    Lesson.objects.filter(pk=lesson.pk).update(status="cancelled")  # no refund happened

    resp = _owner_client(school).delete(f"/api/school/classes/{lesson.pk}/purge/")
    assert resp.status_code == 409
    assert resp.json()["error"] == "has_confirmed_bookings"
    assert Lesson.objects.filter(pk=lesson.pk).exists()
    sp.refresh_from_db()
    assert sp.credits_remaining == Decimal("9.0")


def test_another_schools_lesson_is_not_found():
    mine, theirs = _school("Mine"), _school("Theirs")
    lesson = _lesson(theirs, status="cancelled")
    assert _owner_client(mine).delete(f"/api/school/classes/{lesson.pk}/purge/").status_code == 404
    assert Lesson.objects.filter(pk=lesson.pk).exists()


def test_bulk_purge_deletes_only_cancelled_lessons_in_range_of_this_school():
    school, other = _school("Mine"), _school("Other")
    client = _owner_client(school)
    in_range_cancelled = _lesson(school, date(2027, 5, 10), status="cancelled")
    in_range_cancelled_2 = _lesson(school, date(2027, 5, 12), status="cancelled")
    in_range_scheduled = _lesson(school, date(2027, 5, 11))
    out_of_range_cancelled = _lesson(school, date(2027, 6, 1), status="cancelled")
    other_school_cancelled = _lesson(other, date(2027, 5, 10), status="cancelled")
    still_booked = _lesson(school, date(2027, 5, 13))
    student, _sp = _student_with_credits(school)
    book_lesson(student, still_booked, now=NOW)
    Lesson.objects.filter(pk=still_booked.pk).update(status="cancelled")

    resp = client.post(
        "/api/school/classes/purge-cancelled/", {"from": "2027-05-01", "to": "2027-05-31"}, format="json"
    )

    assert resp.status_code == 200, resp.content
    assert resp.json() == {"deleted": 2}
    gone = {in_range_cancelled.pk, in_range_cancelled_2.pk}
    kept = {in_range_scheduled.pk, out_of_range_cancelled.pk, other_school_cancelled.pk, still_booked.pk}
    assert not Lesson.objects.filter(pk__in=gone).exists()
    assert Lesson.objects.filter(pk__in=kept).count() == len(kept)


def test_bulk_purge_needs_a_range():
    school = _school()
    resp = _owner_client(school).post("/api/school/classes/purge-cancelled/", {"from": "2027-05-01"}, format="json")
    assert resp.status_code == 400
