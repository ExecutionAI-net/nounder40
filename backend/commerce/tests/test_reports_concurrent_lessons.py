"""The Lessons tab's "merge concurrent lessons" switch (GET
/api/school/reports/detailed/?tab=lessons). A class held in the room and
streamed on Zoom at the same time, by the same teacher, is two Lesson rows
but one hour of work: the answer marks them with a shared `concurrent_key`
and carries one merged row per set in `concurrent` -- the room paid once,
the in-room lesson's plan computed once on everyone's students, counts and
revenue added up. The real payout (teachers.services.monthly_compensation)
is not touched by any of this."""
import uuid
from datetime import date, time, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from bookings.models import Attendance, Booking
from catalog.models import Course, Lesson, LessonType
from commerce.report_views import SchoolReportsDetailedView
from schools.models import School, SchoolLocation, SchoolRoom, SchoolStudent
from students.models import Student
from teachers.models import CompensationPlan, CompensationPlanRate, Teacher, TeacherSchool

pytestmark = pytest.mark.django_db
User = get_user_model()
URL = "/api/school/reports/detailed/"
YESTERDAY = date.today() - timedelta(days=1)


def _school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome", cancellation_policy_hours=24,
    )


def _lessons_tab(school):
    hq = User.objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role="hq", roles=["hq"])
    client = APIClient()
    client.force_authenticate(hq)
    res = client.get(URL, {"school": str(school.id), "tab": "lessons"})
    assert res.status_code == 200, res.content
    return res.json()["lessons"]


def _teacher(school, plan):
    user = User.objects.create(email=f"t-{uuid.uuid4().hex[:8]}@example.com")
    teacher = Teacher.objects.create(user=user, name="Alina", email=user.email)
    TeacherSchool.objects.create(teacher=teacher, school=school, active=True, compensation_plan=plan)
    return teacher


def _type():
    return LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Ballet", name_it="Classico")


def _lesson(school, teacher, lesson_type, *, name, hour=18, room=None, is_online=False, status="scheduled", plan=None):
    course = Course.objects.create(
        school=school, lesson_type=lesson_type, name=name, credit_cost=Decimal("1.0"), min_booking_notice_hours=0,
    )
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type, teacher=teacher, room=room, is_online=is_online,
        compensation_plan=plan, date=YESTERDAY, start_time=time(hour, 0), end_time=time(hour + 1, 0),
        max_capacity=10, status=status,
    )


def _present(school, lesson, teacher, n):
    for i in range(n):
        user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
        student = Student.objects.create(user=user, name=f"S{i}", school=school)
        SchoolStudent.objects.create(school=school, student=student)
        booking = Booking.objects.create(
            student=student, lesson=lesson, school=school, status="attended", credits_deducted=Decimal("1.0"),
        )
        Attendance.objects.create(lesson=lesson, student=student, teacher=teacher, booking=booking, status="present")


def test_room_and_zoom_lessons_merge_into_one_row_paid_once():
    school = _school()
    # 30 EUR per class, 5 EUR per student above the fourth
    plan = CompensationPlan.objects.create(
        school=school, name="Base", base_fee=Decimal("30"), bonus_threshold=4, bonus_per_student=Decimal("5"),
    )
    teacher = _teacher(school, plan)
    wagner = SchoolRoom.objects.create(
        location=SchoolLocation.objects.create(school=school, name="Centro"), name="Wagner", cost=Decimal("20"),
    )
    lt = _type()
    # the Zoom twin is created first: the in-room lesson still leads
    on_zoom = _lesson(school, teacher, lt, name="Classico online", is_online=True)
    in_room = _lesson(school, teacher, lt, name="Classico", room=wagner)
    alone = _lesson(school, teacher, lt, name="Punte", hour=19, room=wagner)
    _present(school, in_room, teacher, 4)
    _present(school, on_zoom, teacher, 2)
    _present(school, alone, teacher, 1)

    body = _lessons_tab(school)
    rows = {r["name"]: r for r in body["rows"]}
    assert set(rows) == {"Classico", "Classico online", "Punte"}

    # each row on its own is as before, plus its time, its type and the online flag
    assert rows["Classico"]["start_time"] == "18:00:00" and rows["Classico"]["is_online"] is False
    assert rows["Classico"]["lesson_type_id"] == str(lt.id) and rows["Classico"]["lesson_type"]["name_it"] == "Classico"
    assert rows["Classico"]["compensation_fee"] == 30.0  # 4 students: no bonus yet
    assert rows["Classico online"]["compensation_fee"] == 30.0 and rows["Classico online"]["is_online"] is True
    assert rows["Classico online"]["room_cost"] is None
    assert rows["Punte"]["compensation_fee"] == 30.0

    key = f"{YESTERDAY.isoformat()}|18:00:00|{teacher.id}"
    assert rows["Classico"]["concurrent_key"] == rows["Classico online"]["concurrent_key"] == key
    assert rows["Punte"]["concurrent_key"] is None  # another hour: alone

    (merged,) = body["concurrent"].values()
    assert merged["id"] == key
    assert merged["lesson_ids"] == [str(in_room.id), str(on_zoom.id)]
    assert merged["name"] == "Classico + Classico online"
    assert merged["date"] == YESTERDAY.isoformat() and merged["start_time"] == "18:00:00"
    assert merged["teacher_id"] == str(teacher.id) and merged["is_online"] is False
    # the in-room lesson leads: its room, paid once
    assert merged["room"] == "Wagner" and merged["room_cost"] == 20.0
    # its plan, computed once on 4 + 2 students: 30 + 2 x 5
    assert merged["compensation_plan"] == "Base" and merged["compensation_fee"] == 40.0
    # the students add up; no package paid for these bookings, so no revenue
    assert merged["capacity"] == 20 and merged["attended"] == 6 and merged["no_shows"] == 0
    assert merged["revenue"] == 0.0 and merged["profit"] == -60.0
    assert merged["status"] == "completed"


def test_cancelled_twin_both_cancelled_and_no_teacher():
    school = _school()
    plan = CompensationPlan.objects.create(school=school, name="Base", base_fee=Decimal("30"))
    teacher = _teacher(school, plan)
    lt = _type()
    held = _lesson(school, teacher, lt, name="A")
    _lesson(school, teacher, lt, name="B", is_online=True, status="cancelled")
    # no teacher: nothing to merge on, whatever the hour
    _lesson(school, None, lt, name="C")
    _lesson(school, None, lt, name="D")

    body = _lessons_tab(school)
    rows = {r["name"]: r for r in body["rows"]}
    assert rows["C"]["concurrent_key"] is None and rows["D"]["concurrent_key"] is None
    (merged,) = body["concurrent"].values()
    # the held lesson still pays its fee; the cancelled twin adds nothing
    assert merged["compensation_fee"] == 30.0 and merged["status"] == "completed"
    assert merged["profit"] == -30.0

    # both cancelled: no fee, no profit, a cancelled row
    held.status = "cancelled"
    held.save(update_fields=["status"])
    (merged,) = _lessons_tab(school)["concurrent"].values()
    assert merged["compensation_fee"] is None and merged["profit"] is None and merged["status"] == "cancelled"


def test_the_held_room_lesson_leads_over_a_cancelled_one():
    """Two room lessons at the same hour, one cancelled: the merged row takes
    the held one's name, room and plan first, whatever their ids say."""
    school = _school()
    teacher = _teacher(school, CompensationPlan.objects.create(school=school, name="Base", base_fee=Decimal("30")))
    location = SchoolLocation.objects.create(school=school, name="Centro")
    studio = SchoolRoom.objects.create(location=location, name="Studio", cost=Decimal("10"))
    plena = SchoolRoom.objects.create(location=location, name="Plena", cost=Decimal("40"))
    lt = _type()
    for _ in range(3):  # ids are random: the status must decide every time
        Lesson.objects.filter(school=school).delete()
        _lesson(school, teacher, lt, name="Gone", room=studio, status="cancelled")
        _lesson(school, teacher, lt, name="Held", room=plena)
        (merged,) = _lessons_tab(school)["concurrent"].values()
        assert merged["name"] == "Held + Gone" and merged["room"] == "Plena"
        # the cancelled lesson's room stays out of the cost, as its own row
        # keeps it out of the profit: the switch never moves the totals' profit
        assert merged["room_cost"] == 40.0 and merged["compensation_fee"] == 30.0
        assert merged["profit"] == -70.0


def test_a_held_zoom_lesson_leads_over_its_cancelled_room_twin():
    """The room class was called off and only its Zoom stream ran: the row is
    the Zoom lesson's -- its plan, no room, online -- not the plan and room
    of a class that never took place."""
    school = _school()
    teacher = _teacher(school, CompensationPlan.objects.create(school=school, name="Base", base_fee=Decimal("30")))
    zoom_plan = CompensationPlan.objects.create(school=school, name="Zoom", base_fee=Decimal("12"))
    wagner = SchoolRoom.objects.create(
        location=SchoolLocation.objects.create(school=school, name="Centro"), name="Wagner", cost=Decimal("20"),
    )
    lt = _type()
    _lesson(school, teacher, lt, name="In room", room=wagner, status="cancelled")
    on_zoom = _lesson(school, teacher, lt, name="On Zoom", is_online=True, plan=zoom_plan)
    _present(school, on_zoom, teacher, 2)

    (merged,) = _lessons_tab(school)["concurrent"].values()
    assert merged["name"] == "On Zoom + In room" and merged["is_online"] is True
    assert merged["room"] == "—" and merged["room_cost"] is None
    assert merged["compensation_plan"] == "Zoom" and merged["compensation_fee"] == 12.0
    assert merged["attended"] == 2 and merged["profit"] == -12.0 and merged["status"] == "completed"


def test_per_type_rates_are_read_once_and_the_query_count_does_not_grow_with_pairs():
    school = _school()
    plan = CompensationPlan.objects.create(school=school, name="Base", base_fee=Decimal("30"))
    lt = _type()
    CompensationPlanRate.objects.create(plan=plan, lesson_type=lt, base_fee=Decimal("25"))  # this type pays 25
    teacher = _teacher(school, plan)
    room = SchoolRoom.objects.create(
        location=SchoolLocation.objects.create(school=school, name="Centro"), name="Wagner", cost=Decimal("20"),
    )

    def pair(hour):
        in_room = _lesson(school, teacher, lt, name=f"Room {hour}", hour=hour, room=room)
        on_zoom = _lesson(school, teacher, lt, name=f"Zoom {hour}", hour=hour, is_online=True)
        _present(school, in_room, teacher, 1)
        _present(school, on_zoom, teacher, 1)

    def queries():
        with CaptureQueriesContext(connection) as ctx:
            body = _lessons_tab(school)
        return len(ctx), body

    pair(9), pair(10)
    small, body = queries()
    assert {g["compensation_fee"] for g in body["concurrent"].values()} == {25.0}  # the type's rate, not the base
    assert {r["compensation_fee"] for r in body["rows"]} == {25.0}
    pair(11), pair(12), pair(13), pair(14)
    large, body = queries()
    assert len(body["concurrent"]) == 6 and large == small


def test_the_row_cap_never_splits_a_set_of_concurrent_lessons(monkeypatch):
    """Newest first, the cap could cut inside a set (same date and time): the
    rest of that set is fetched too, so the merged row is whole."""
    monkeypatch.setattr(SchoolReportsDetailedView, "MAX_LESSON_ROWS", 4)
    school = _school()
    teacher = _teacher(school, None)
    lt = _type()
    for name in ("A", "B"):
        _lesson(school, teacher, lt, name=name, hour=18)
    for name in ("C", "D", "E"):  # the cap of 4 falls inside this set
        _lesson(school, teacher, lt, name=name, hour=17)
    _lesson(school, teacher, lt, name="F", hour=16)  # beyond the cap: out, whole

    body = _lessons_tab(school)
    assert sorted(r["name"] for r in body["rows"]) == ["A", "B", "C", "D", "E"]
    assert sorted(len(g["lesson_ids"]) for g in body["concurrent"].values()) == [2, 3]
