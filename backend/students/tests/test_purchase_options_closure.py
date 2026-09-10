"""ST-R3-09: the booking modal must know the school is closed that day.

`book_lesson()` refuses a closure-day booking with `school_closed`, and the
drop-in checkout is refused before anyone reaches Stripe -- but nothing said
so until the student had already pressed "Si, prenota ora". The modal already
asks `purchase-options` before deciding what to show (the same hook R2-H13
used for the free first lesson), so the answer belongs in that response.
"""
import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from bookings.services import BookingError, book_lesson
from catalog.models import Course, Lesson
from schools.models import School, SchoolClosure
from students.models import Student

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def lesson(school):
    course = Course.objects.create(school=school, credit_cost=Decimal("1"), min_booking_notice_hours=0)
    when = timezone.localtime(timezone.now()) + timedelta(days=3)
    return Lesson.objects.create(
        school=school, course=course, date=when.date(), start_time=when.time(),
        end_time=(when + timedelta(hours=1)).time(), max_capacity=5, current_bookings=0,
    )


def _options(lesson):
    return APIClient().get(f"/api/student/lessons/{lesson.id}/purchase-options/").json()


def test_an_open_day_is_not_flagged(lesson):
    assert _options(lesson)["school_closed"] is False


def test_a_single_day_closure_is_flagged(school, lesson):
    SchoolClosure.objects.create(school=school, date=lesson.date)
    assert _options(lesson)["school_closed"] is True


def test_a_closure_range_covering_the_day_is_flagged(school, lesson):
    SchoolClosure.objects.create(
        school=school, date=lesson.date - timedelta(days=2), end_date=lesson.date + timedelta(days=2),
    )
    assert _options(lesson)["school_closed"] is True


def test_another_school_closure_does_not_flag_this_lesson(lesson):
    other = School.objects.create(name="O", slug=f"s-{uuid.uuid4().hex[:8]}", email="o@example.com")
    SchoolClosure.objects.create(school=other, date=lesson.date)
    assert _options(lesson)["school_closed"] is False


def test_the_flag_agrees_with_what_booking_actually_does(school, lesson):
    """The whole point: the modal must not offer an action the booking rule
    is going to refuse. Same day, both answers."""
    SchoolClosure.objects.create(school=school, date=lesson.date)
    assert _options(lesson)["school_closed"] is True

    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Stu")
    with pytest.raises(BookingError) as exc:
        book_lesson(student, lesson)
    assert str(exc.value) == "school_closed"
