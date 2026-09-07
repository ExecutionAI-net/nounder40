"""QA_REGRESSION_ROUND2 R2-H13: `book_lesson()` (bookings/services.py) already
grants a free first lesson per student per school -- it checks
`School.free_first_lesson` / `SchoolStudent.free_lesson_used` before ever
looking at credits or packages, so `POST /api/bookings/` already worked
correctly for this. Nothing on the frontend knew about it though: a student
with no wallet coverage was only ever offered a purchase flow (never a plain
"Book" button), and one WITH coverage saw a misleading "1 credit will be
deducted" for a booking that would actually cost her nothing. This covers
the new `free_lesson_available` field `StudentLessonPurchaseOptionsView`
exposes so the frontend can tell the two cases apart."""
import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from catalog.models import Course, Lesson
from schools.models import School, SchoolStudent
from students.models import Student

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", free_first_lesson=True,
    )


@pytest.fixture
def student():
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name="Stu")


@pytest.fixture
def lesson(school):
    course = Course.objects.create(school=school, credit_cost=Decimal("1"), min_booking_notice_hours=0)
    when = timezone.localtime(timezone.now()) + timedelta(days=3)
    return Lesson.objects.create(
        school=school, course=course, date=when.date(), start_time=when.time(),
        end_time=(when + timedelta(hours=1)).time(), max_capacity=5, current_bookings=0,
    )


def _options(client, lesson):
    return client.get(f"/api/student/lessons/{lesson.id}/purchase-options/")


def test_available_when_never_enrolled_at_this_school(school, student, lesson):
    client = APIClient()
    client.force_authenticate(student.user)
    assert _options(client, lesson).json()["free_lesson_available"] is True


def test_available_when_enrolled_but_never_used(school, student, lesson):
    SchoolStudent.objects.create(school=school, student=student, free_lesson_used=False)
    client = APIClient()
    client.force_authenticate(student.user)
    assert _options(client, lesson).json()["free_lesson_available"] is True


def test_not_available_once_used(school, student, lesson):
    SchoolStudent.objects.create(school=school, student=student, free_lesson_used=True)
    client = APIClient()
    client.force_authenticate(student.user)
    assert _options(client, lesson).json()["free_lesson_available"] is False


def test_not_available_when_school_has_not_enabled_it(student, lesson):
    lesson.school.free_first_lesson = False
    lesson.school.save(update_fields=["free_first_lesson"])
    client = APIClient()
    client.force_authenticate(student.user)
    assert _options(client, lesson).json()["free_lesson_available"] is False


def test_not_available_for_an_anonymous_visitor(lesson):
    client = APIClient()
    assert _options(client, lesson).json()["free_lesson_available"] is False


def test_end_to_end_booking_actually_deducts_zero_credits_and_the_flag_agrees(school, student, lesson):
    client = APIClient()
    client.force_authenticate(student.user)
    assert _options(client, lesson).json()["free_lesson_available"] is True

    res = client.post("/api/bookings/", {"lesson": str(lesson.id)}, format="json")
    assert res.status_code == 201, res.content
    assert res.json()["access_source"] == "free_lesson"
    assert float(res.json()["credits_deducted"]) == 0

    # Used up now -- a second lesson at the same school is no longer free.
    assert _options(client, lesson).json()["free_lesson_available"] is False
