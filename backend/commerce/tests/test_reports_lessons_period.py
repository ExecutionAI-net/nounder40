"""The Lessons tab's period (GET /api/school/reports/detailed/?tab=lessons
&from=&to=). Without dates it is a consuntivo, the newest lessons up to
today; with them, the lessons of the period, FUTURE ones included, so a
month ahead gives the room and teacher costs to expect (Carlo,
2026-10-08). A future lesson is an estimate: the plan at the students
booked so far, status `scheduled`. `truncated` says when the period holds
more lessons than the cap, which keeps the end of the period the reader is
nearest to."""
import uuid
from datetime import date, time, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from bookings.models import Booking
from catalog.models import Course, Lesson, LessonType
from commerce.report_views import SchoolReportsDetailedView
from schools.models import School, SchoolLocation, SchoolRoom, SchoolStudent
from students.models import Student
from teachers.models import CompensationPlan, Teacher, TeacherSchool

pytestmark = pytest.mark.django_db
User = get_user_model()
URL = "/api/school/reports/detailed/"
TODAY = date.today()


def _school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome", cancellation_policy_hours=24,
    )


def _get(school, **params):
    hq = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role="hq", roles=["hq"])
    client = APIClient()
    client.force_authenticate(hq)
    return client.get(URL, {"school": str(school.id), "tab": "lessons", **params})


def _lessons_tab(school, **params):
    res = _get(school, **params)
    assert res.status_code == 200, res.content
    return res.json()["lessons"]


def _teacher(school, plan=None):
    user = User.objects.create(email=f"t-{uuid.uuid4().hex[:8]}@example.com")
    teacher = Teacher.objects.create(user=user, name="Alina", email=user.email)
    TeacherSchool.objects.create(teacher=teacher, school=school, active=True, compensation_plan=plan)
    return teacher


def _lesson(school, teacher, *, name, day, hour=18, room=None, is_online=False, booked=0):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Ballet", name_it="Classico")
    course = Course.objects.create(
        school=school, lesson_type=lt, name=name, credit_cost=Decimal("1.0"), min_booking_notice_hours=0,
    )
    lesson = Lesson.objects.create(
        school=school, course=course, lesson_type=lt, teacher=teacher, room=room, is_online=is_online,
        date=day, start_time=time(hour, 0), end_time=time(hour + 1, 0), max_capacity=10, status="scheduled",
        current_bookings=booked,
    )
    for i in range(booked):
        user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
        student = Student.objects.create(user=user, name=f"S{i}", school=school)
        SchoolStudent.objects.create(school=school, student=student)
        Booking.objects.create(
            student=student, lesson=lesson, school=school, status="confirmed", credits_deducted=Decimal("1.0"),
        )
    return lesson


def test_without_dates_the_tab_is_a_consuntivo_up_to_today():
    school = _school()
    teacher = _teacher(school)
    for name, day in (("Yesterday", TODAY - timedelta(days=1)), ("Today", TODAY), ("Tomorrow", TODAY + timedelta(days=1))):
        _lesson(school, teacher, name=name, day=day)

    body = _lessons_tab(school)
    assert sorted(r["name"] for r in body["rows"]) == ["Today", "Yesterday"]
    assert body["truncated"] is False


def test_a_period_ahead_lists_the_future_lessons_with_their_estimated_costs():
    school = _school()
    # 30 EUR per class, 5 EUR per student above the second
    plan = CompensationPlan.objects.create(
        school=school, name="Base", base_fee=Decimal("30"), bonus_threshold=2, bonus_per_student=Decimal("5"),
    )
    teacher = _teacher(school, plan)
    studio = SchoolRoom.objects.create(
        location=SchoolLocation.objects.create(school=school, name="Centro"), name="Studio", cost=Decimal("40"),
    )
    first = (TODAY.replace(day=1) + timedelta(days=32)).replace(day=1)  # the first of next month
    last = (first + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    _lesson(school, teacher, name="Next month", day=first + timedelta(days=6), room=studio, booked=4)
    _lesson(school, teacher, name="Held", day=TODAY - timedelta(days=1), room=studio, booked=4)
    _lesson(school, teacher, name="Far ahead", day=last + timedelta(days=1), room=studio)

    body = _lessons_tab(school, **{"from": first.isoformat(), "to": last.isoformat()})
    (row,) = body["rows"]
    assert row["name"] == "Next month" and row["status"] == "scheduled"
    # the room is the cost to expect; the fee is the plan at the 4 booked so far
    # (no attendance yet): 30 + 2 x 5
    assert row["room_cost"] == 40.0 and row["compensation_fee"] == 40.0
    assert row["booked"] == 4 and row["attended"] == 0
    assert row["profit"] == round(row["revenue"] - 40.0 - 40.0, 2)
    assert body["truncated"] is False

    # a `from` alone runs ahead to the end of the schedules
    ahead = _lessons_tab(school, **{"from": first.isoformat()})
    assert sorted(r["name"] for r in ahead["rows"]) == ["Far ahead", "Next month"]
    # a `to` alone is the consuntivo bounded by it
    upto = _lessons_tab(school, to=(TODAY - timedelta(days=1)).isoformat())
    assert [r["name"] for r in upto["rows"]] == ["Held"]


def test_a_future_set_of_concurrent_lessons_is_estimated_on_everyone_booked():
    school = _school()
    plan = CompensationPlan.objects.create(
        school=school, name="Base", base_fee=Decimal("30"), bonus_threshold=2, bonus_per_student=Decimal("5"),
    )
    teacher = _teacher(school, plan)
    studio = SchoolRoom.objects.create(
        location=SchoolLocation.objects.create(school=school, name="Centro"), name="Studio", cost=Decimal("40"),
    )
    day = TODAY + timedelta(days=10)
    _lesson(school, teacher, name="In room", day=day, room=studio, booked=4)
    _lesson(school, teacher, name="On Zoom", day=day, is_online=True, booked=2)

    body = _lessons_tab(school, **{"from": day.isoformat(), "to": day.isoformat()})
    (merged,) = body["concurrent"].values()
    # the plan once on 4 + 2 booked: 30 + 4 x 5; the room once; still ahead
    assert merged["compensation_fee"] == 50.0 and merged["room_cost"] == 40.0
    assert merged["booked"] == 6 and merged["attended"] == 0 and merged["status"] == "scheduled"


def test_the_cap_keeps_the_end_of_the_period_the_reader_is_nearest_to(monkeypatch):
    monkeypatch.setattr(SchoolReportsDetailedView, "MAX_LESSON_ROWS", 2)
    school = _school()
    teacher = _teacher(school)
    for offset in (-3, -2, -1, 1, 2, 3):
        _lesson(school, teacher, name=f"D{offset:+d}", day=TODAY + timedelta(days=offset))

    # no dates: the newest up to today
    body = _lessons_tab(school)
    assert sorted(r["name"] for r in body["rows"]) == ["D-1", "D-2"] and body["truncated"] is True
    # `from` alone: the soonest after it, not the farthest ahead
    ahead = _lessons_tab(school, **{"from": (TODAY + timedelta(days=1)).isoformat()})
    assert sorted(r["name"] for r in ahead["rows"]) == ["D+1", "D+2"] and ahead["truncated"] is True
    # a bounded period: the newest in it
    span = _lessons_tab(school, **{"from": (TODAY - timedelta(days=3)).isoformat(), "to": (TODAY + timedelta(days=3)).isoformat()})
    assert sorted(r["name"] for r in span["rows"]) == ["D+2", "D+3"] and span["truncated"] is True
    # exactly the cap is not truncation
    exact = _lessons_tab(school, **{"from": (TODAY - timedelta(days=2)).isoformat(), "to": (TODAY - timedelta(days=1)).isoformat()})
    assert len(exact["rows"]) == 2 and exact["truncated"] is False


def test_a_lone_date_is_an_open_period_for_lessons_and_a_range_the_wrong_way_round_is_not():
    school = _school()
    assert _get(school, **{"from": (TODAY + timedelta(days=30)).isoformat()}).status_code == 200
    # `to` alone before this month: not compared with the teachers' default `from`
    assert _get(school, to=(TODAY.replace(day=1) - timedelta(days=1)).isoformat()).status_code == 200
    assert _get(school, **{"from": "2026-02-01", "to": "2026-01-01"}).status_code == 400
    # the teachers section still fills `to` with today
    hq = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role="hq", roles=["hq"])
    client = APIClient()
    client.force_authenticate(hq)
    res = client.get(URL, {"school": str(school.id), "tab": "teachers", "from": (TODAY + timedelta(days=30)).isoformat()})
    assert res.status_code == 400
