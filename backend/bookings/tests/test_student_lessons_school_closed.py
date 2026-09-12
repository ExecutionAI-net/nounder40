"""R4-L14 / ST-R4-05: the booking card said "10 seats · Book" on a closure
day and only the confirm modal knew the school was shut. The student lesson
list now carries `school_closed` per row."""
import uuid
from datetime import date, time, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from catalog.models import Course, Lesson, LessonType
from schools.models import School, SchoolClosure, SchoolStudent
from students.models import Student

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True)


@pytest.fixture
def student_client(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role="student", roles=["student"])
    s = Student.objects.create(user=user, name="Anna", school=school)
    SchoolStudent.objects.create(school=school, student=s)
    api = APIClient()
    api.force_authenticate(user)
    return api


def _lesson(school, day):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(school=school, lesson_type=lt, credit_cost=Decimal("1"), min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt, date=day, start_time=time(10, 0), end_time=time(11, 0),
        max_capacity=10, status="scheduled",
    )


def test_each_listed_lesson_says_whether_the_school_is_closed(school, student_client):
    open_day = date.today() + timedelta(days=20)
    closed_day = date.today() + timedelta(days=21)
    SchoolClosure.objects.create(school=school, date=closed_day)
    a, b = _lesson(school, open_day), _lesson(school, closed_day)

    resp = student_client.get("/api/student/lessons/", {"school_id": str(school.id)})

    assert resp.status_code == 200, resp.content
    rows = resp.json()
    rows = rows["results"] if isinstance(rows, dict) else rows
    by_id = {r["id"]: r for r in rows}
    assert by_id[str(a.id)]["school_closed"] is False
    assert by_id[str(b.id)]["school_closed"] is True
