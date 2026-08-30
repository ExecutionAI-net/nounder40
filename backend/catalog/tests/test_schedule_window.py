"""Shortening a schedule's dates on a course: lessons that fall out of the
window and already have bookings are not dropped silently — the school sees
the count first (409), then they go through the cancel-and-refund path."""
import uuid
from datetime import date, time, timedelta
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role
from bookings.models import Booking
from catalog.course_views import _weekday_name
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def setup():
    school = School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(school=school, lesson_type=lt, credit_cost=1, start_time=time(10, 0), duration_minutes=60)
    first = date.today() + timedelta(days=7)
    lessons = [
        Lesson.objects.create(school=school, course=course, lesson_type=lt, date=first + timedelta(weeks=i),
                              start_time=time(10, 0), end_time=time(11, 0), max_capacity=10, status="scheduled")
        for i in range(4)
    ]
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna", school=school)
    pkg = Package.objects.create(school=school, credits=10)
    sp = StudentPackage.objects.create(student=student, school=school, package=pkg, credits_total=10, credits_remaining=9,
                                       expires_at=timezone.now() + timedelta(days=90))
    booking = Booking.objects.create(student=student, lesson=lessons[3], school=school, access_source="package",
                                     student_package=sp, credits_deducted=1, status="confirmed")
    lessons[3].current_bookings = 1
    lessons[3].save(update_fields=["current_bookings"])
    staff = User.objects.create(email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school)
    client = APIClient()
    client.force_authenticate(staff)
    weekday = _weekday_name(first)
    end_date = (first + timedelta(weeks=1)).isoformat()  # keeps lessons 0-1, drops 2-3
    body = {
        "lesson_type_id": str(lt.id), "start_time": "10:00", "duration_minutes": 60,
        "schedules": [{"weekday": weekday, "start_time": "10:00", "duration_minutes": 60, "end_date": end_date, "is_new": False}],
    }
    return client, course, lessons, booking, sp, body


def test_shortening_with_bookings_stops_and_changes_nothing(setup):
    client, course, lessons, booking, sp, body = setup
    res = client.put(f"/api/school/courses/{course.id}/full/", body, format="json")
    assert res.status_code == 409
    assert res.json() == {"error": "bookings_would_be_cancelled", "lessons": 1, "bookings": 1}
    assert Lesson.objects.get(pk=lessons[2].pk).status == "scheduled"  # rolled back, even the empty one
    booking.refresh_from_db()
    assert booking.status == "confirmed"


def test_confirmed_shortening_refunds_and_emails(setup, django_capture_on_commit_callbacks):
    client, course, lessons, booking, sp, body = setup
    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, django_capture_on_commit_callbacks(execute=True):
        res = client.put(f"/api/school/courses/{course.id}/full/", {**body, "confirm_cancel_bookings": True}, format="json")
    assert res.status_code == 200
    assert {Lesson.objects.get(pk=lessons[i].pk).status for i in (2, 3)} == {"cancelled"}
    assert {Lesson.objects.get(pk=lessons[i].pk).status for i in (0, 1)} == {"scheduled"}
    booking.refresh_from_db()
    sp.refresh_from_db()
    assert booking.status == "cancelled" and booking.credit_refunded is True
    assert sp.credits_remaining == 10
    assert [c.kwargs["key"] for c in delayed.call_args_list] == ["lesson_cancelled_by_school"]
