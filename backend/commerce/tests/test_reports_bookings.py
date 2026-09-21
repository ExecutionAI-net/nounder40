"""The Reports page's Bookings tab (GET /api/school/reports/bookings/): one
row per booking made at the school, newest first, with the student and the
lesson. Cancellations keep their row and say whether the credit came back."""
import uuid
from datetime import date, datetime, time, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from bookings.models import Booking
from bookings.services import book_lesson, cancel_booking
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolStudent
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()
URL = "/api/school/reports/bookings/"


def _school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome", cancellation_policy_hours=24,
    )


def _student(school, name):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name=name, school=school)
    SchoolStudent.objects.create(school=school, student=student)
    pkg = Package.objects.create(school=school, credits=Decimal("10.0"), name_it="Dieci lezioni", name_en="Ten lessons")
    StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=Decimal("10.0"), credits_remaining=Decimal("10.0"),
        expires_at=datetime(2028, 1, 1, tzinfo=dt_timezone.utc),
    )
    return student


def _lesson(school, day, course_name=""):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre", name_it="Sbarra")
    course = Course.objects.create(school=school, lesson_type=lt, name=course_name, credit_cost=Decimal("1.5"), min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt, date=day, start_time=time(12, 0), end_time=time(13, 0),
        max_capacity=10, status="scheduled",
    )


def _hq_client():
    hq = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role="hq", roles=["hq"])
    client = APIClient()
    client.force_authenticate(hq)
    return client


def test_rows_newest_first_with_student_and_lesson():
    school = _school()
    anna, bea = _student(school, "Anna"), _student(school, "Bea")
    first = _lesson(school, date(2027, 12, 1), course_name="Classico base")
    second = _lesson(school, date(2027, 12, 2))
    b1 = book_lesson(anna, first, now=datetime(2027, 11, 1, 9, 0, tzinfo=dt_timezone.utc))
    b2 = book_lesson(bea, second, now=datetime(2027, 11, 2, 9, 0, tzinfo=dt_timezone.utc))
    cancel_booking(b2, now=datetime(2027, 11, 20, tzinfo=dt_timezone.utc))  # inside the policy: refunded

    # someone else's school never shows up
    other = _school()
    book_lesson(_student(other, "Zoe"), _lesson(other, date(2027, 12, 5)), now=datetime(2027, 11, 3, tzinfo=dt_timezone.utc))

    res = _hq_client().get(URL, {"school": str(school.id)})
    assert res.status_code == 200, res.content
    rows = res.json()["rows"]
    assert [r["id"] for r in rows] == [str(b2.id), str(b1.id)]

    cancelled, kept = rows
    assert kept["student_name"] == "Anna" and kept["course_name"] == "Classico base"
    assert kept["lesson_date"] == "2027-12-01" and kept["start_time"] == "12:00:00"
    assert kept["status"] == Booking.Status.CONFIRMED and kept["access_source"] == "package"
    assert Decimal(kept["credits_deducted"]) == Decimal("1.5")
    # the package that paid: its id opens the usage modal, its name replaces "Package"
    assert kept["student_package_id"] == str(anna.packages.get().id)
    assert kept["package_name"] == {"name_en": "Ten lessons", "name_it": "Dieci lezioni", "name_fr": "", "name_es": ""}

    assert cancelled["student_name"] == "Bea" and cancelled["course_name"] == ""
    assert cancelled["lesson_type"] == {"name_en": "Barre", "name_it": "Sbarra", "name_fr": "", "name_es": ""}
    assert cancelled["status"] == Booking.Status.CANCELLED
    assert cancelled["cancellation_type"] == Booking.CancellationType.WITHIN_POLICY and cancelled["credit_refunded"] is True
    assert cancelled["cancelled_at"] is not None


def test_school_admin_sees_her_own_school():
    school = _school()
    anna = _student(school, "Anna")
    book_lesson(anna, _lesson(school, date(2027, 12, 1)), now=datetime(2027, 11, 1, tzinfo=dt_timezone.utc))
    admin = User.objects.create(email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role="school", roles=["school"], active_school=school)
    client = APIClient()
    client.force_authenticate(admin)
    res = client.get(URL)
    assert res.status_code == 200, res.content
    assert len(res.json()["rows"]) == 1


# ── server-side filters, sorting, paging ─────────────────────────────────────

def _many(school, n):
    """n confirmed bookings, one student each, booked one day apart."""
    out = []
    for i in range(n):
        student = _student(school, f"Stu{i:02d}")
        lesson = _lesson(school, date(2027, 12, 1 + i))
        out.append(book_lesson(student, lesson, now=datetime(2027, 11, 1 + i, 9, 0, tzinfo=dt_timezone.utc)))
    return out


def test_paging_carries_count_and_keeps_order():
    school = _school()
    bookings = _many(school, 7)
    client = _hq_client()

    res = client.get(URL, {"school": str(school.id), "page_size": 3, "page": 1}).json()
    assert res["count"] == 7 and res["page"] == 1 and res["page_size"] == 3
    assert [r["id"] for r in res["rows"]] == [str(b.id) for b in reversed(bookings)][:3]

    last = client.get(URL, {"school": str(school.id), "page_size": 3, "page": 3}).json()
    assert [r["id"] for r in last["rows"]] == [str(bookings[0].id)]

    # default page is 25, and page_size is capped at 100
    assert client.get(URL, {"school": str(school.id)}).json()["page_size"] == 25
    assert client.get(URL, {"school": str(school.id), "page_size": 500}).json()["page_size"] == 100
    assert client.get(URL, {"school": str(school.id), "page": 0}).status_code == 400


def test_kpis_cover_every_match_not_just_the_page():
    school = _school()
    bookings = _many(school, 5)
    cancel_booking(bookings[0], now=datetime(2027, 11, 20, tzinfo=dt_timezone.utc))  # refunded
    res = _hq_client().get(URL, {"school": str(school.id), "page_size": 2}).json()
    assert len(res["rows"]) == 2 and res["count"] == 5
    assert res["kpis"]["confirmed"] == 4 and res["kpis"]["cancelled"] == 1
    # the refunded cancellation does not count as used credit: 4 x 1.5
    assert Decimal(str(res["kpis"]["credits"])) == Decimal("6.0")


def test_filters_status_student_and_booked_dates():
    school = _school()
    bookings = _many(school, 4)
    cancel_booking(bookings[1], now=datetime(2027, 11, 20, tzinfo=dt_timezone.utc))
    client = _hq_client()
    def get(**q):
        return client.get(URL, {"school": str(school.id), **q}).json()

    assert get(status="cancelled")["count"] == 1
    assert {r["status"] for r in get(status="confirmed,cancelled")["rows"]} == {"confirmed", "cancelled"}
    assert get(student=str(bookings[2].student_id))["count"] == 1
    # booked on 2027-11-02 and 2027-11-03 only (school timezone Europe/Rome)
    assert get(booked_from="2027-11-02", booked_to="2027-11-03")["count"] == 2
    assert get(source="package")["count"] == 4
    assert get(source="subscription")["count"] == 0
    assert client.get(URL, {"school": str(school.id), "student": "nope"}).status_code == 400


def test_period_window_is_relative_to_now():
    school = _school()
    student = _student(school, "Anna")
    lesson = _lesson(school, date(2099, 1, 1))
    recent = Booking.objects.create(student=student, lesson=lesson, school=school, credits_deducted=Decimal("1.5"))
    old = Booking.objects.create(
        student=student, lesson=_lesson(school, date(2099, 1, 2)), school=school,
        credits_deducted=Decimal("1.5"), booked_at=datetime(2020, 1, 1, tzinfo=dt_timezone.utc),
    )
    client = _hq_client()
    def ids(**q):
        return {r["id"] for r in client.get(URL, {"school": str(school.id), **q}).json()["rows"]}
    assert ids(period="24h") == {str(recent.id)}
    assert ids(period="all") == {str(recent.id), str(old.id)}
    assert client.get(URL, {"school": str(school.id), "period": "1y"}).status_code == 400


def test_sort_by_student_and_lesson_date_and_direction():
    school = _school()
    _many(school, 3)
    client = _hq_client()
    def get(**q):
        return [r["student_name"] for r in client.get(URL, {"school": str(school.id), **q}).json()["rows"]]
    assert get(sort="student", dir="asc") == ["Stu00", "Stu01", "Stu02"]
    assert get(sort="student", dir="desc") == ["Stu02", "Stu01", "Stu00"]
    assert get(sort="lesson_date", dir="desc") == ["Stu02", "Stu01", "Stu00"]
    assert client.get(URL, {"school": str(school.id), "sort": "bogus"}).status_code == 400


def test_options_and_export():
    school = _school()
    _many(school, 3)
    client = _hq_client()
    opts = client.get(URL, {"school": str(school.id), "options": 1}).json()
    assert [o["label"] for o in opts["students"]] == ["Stu00", "Stu01", "Stu02"]
    assert opts["teachers"] == [] and opts["locations"] == []

    full = client.get(URL, {"school": str(school.id), "export": 1, "page_size": 1}).json()
    assert len(full["rows"]) == 3 and full["count"] == 3
