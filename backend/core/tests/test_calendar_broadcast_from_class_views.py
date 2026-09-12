"""R4-M5 (QA_REGRESSION_ROUND4 TCH-R4-07): the calendar WebSocket never fired
for the writes the UI actually makes. `broadcast_calendar_change` was called
only from the plain `/api/school/lessons/` viewset; the calendar and course
pages create, move and cancel classes through `/api/school/classes/*` and the
course wizard, so a teacher with her calendar open saw nothing until reload.
"""
import uuid
from datetime import date, time, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from catalog.models import Course, Lesson, LessonType
from schools.models import School, SchoolMembership, SchoolRole
from teachers.models import Teacher, TeacherSchool

pytestmark = pytest.mark.django_db
User = get_user_model()

FAR = date.today() + timedelta(days=60)


@pytest.fixture
def school():
    SchoolRole.objects.update_or_create(
        key="owner", defaults={"label": "Owner", "builtin": True, "permissions": ["courses", "lessons"]}
    )
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True)


@pytest.fixture
def owner_client(school):
    user = User.objects.create(
        email=f"own-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    api = APIClient()
    api.force_authenticate(user)
    return api


@pytest.fixture
def teacher(school):
    t = Teacher.objects.create(name="T One", first_name="T", last_name="One", email=f"t-{uuid.uuid4().hex[:6]}@example.com")
    TeacherSchool.objects.create(teacher=t, school=school, active=True)
    return t


@pytest.fixture
def course(school, teacher):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    return Course.objects.create(
        school=school, lesson_type=lt, teacher=teacher, credit_cost=Decimal("1"), min_booking_notice_hours=0
    )


def _lesson(course, day=FAR):
    return Lesson.objects.create(
        school=course.school, course=course, lesson_type=course.lesson_type, teacher=course.teacher,
        date=day, start_time=time(10, 0), end_time=time(11, 0), max_capacity=10, status="scheduled",
    )


def test_creating_a_class_broadcasts_a_refresh(owner_client, course, teacher):
    with patch("catalog.course_views.broadcast_calendar_refresh") as refresh:
        resp = owner_client.post(
            "/api/school/classes/",
            {"course_id": str(course.id), "date": FAR.isoformat(), "start_time": "11:00", "duration_minutes": 60},
            format="json",
        )
    assert resp.status_code == 200, resp.content
    refresh.assert_called_once()
    school_id, teacher_ids = refresh.call_args.args
    assert school_id == course.school_id
    assert teacher.id in set(teacher_ids)


def test_moving_a_class_broadcasts_the_lesson(owner_client, course):
    lesson = _lesson(course)
    with patch("catalog.course_views.broadcast_calendar_change") as change:
        resp = owner_client.patch(f"/api/school/classes/{lesson.pk}/", {"start_time": "12:00", "duration_minutes": 60}, format="json")
    assert resp.status_code == 200, resp.content
    change.assert_called_once()
    assert change.call_args.args[0].pk == lesson.pk


def test_cancelling_a_class_broadcasts_the_lesson(owner_client, course):
    lesson = _lesson(course)
    with patch("catalog.course_views.broadcast_calendar_change") as change:
        resp = owner_client.delete(f"/api/school/classes/{lesson.pk}/")
    assert resp.status_code == 200, resp.content
    change.assert_called_once()
    sent = change.call_args.args[0]
    assert sent.pk == lesson.pk and sent.status == "cancelled"


def test_the_refresh_helper_hits_the_school_and_each_teacher_group():
    from catalog.realtime import broadcast_calendar_refresh

    sent = []

    class Layer:
        async def group_send(self, group, message):
            sent.append((group, message))

    school_id, t1, t2 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with patch("catalog.realtime.get_channel_layer", return_value=Layer()):
        broadcast_calendar_refresh(school_id, [t1, t2, t1, None])

    groups = sorted(g for g, _ in sent)
    assert groups == sorted([f"calendar_school_{school_id}", f"calendar_teacher_{t1}", f"calendar_teacher_{t2}"])
    assert all(m["type"] == "calendar_event" and m["refresh"] is True for _, m in sent)
