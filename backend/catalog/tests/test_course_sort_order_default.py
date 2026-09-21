"""Carlo, 2026-09-21: a course must always have a position. The Courses page
assigns positions only when the school drags to reorder; a course created
afterwards had none and sat at the bottom, and the calendar's tie-break (see
test_lesson_feed_order) needed a rule for it. Now `Course.save` gives a new
course the next position at its school, so page and calendar agree without a
drag; an explicit position is kept."""
import uuid

import pytest

from catalog.models import Course
from schools.models import School

pytestmark = pytest.mark.django_db


def _school(name="Danza"):
    return School.objects.create(name=name, slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com")


def test_a_new_course_takes_the_next_position_at_its_school():
    school = _school()
    first = Course.objects.create(school=school, name="Sala")
    second = Course.objects.create(school=school, name="Online")
    assert (first.sort_order, second.sort_order) == (1, 2)


def test_the_position_counts_per_school_and_after_a_gap():
    school, other = _school("A"), _school("B")
    Course.objects.create(school=school, name="Sala", sort_order=7)
    assert Course.objects.create(school=school, name="Online").sort_order == 8
    assert Course.objects.create(school=other, name="Altra scuola").sort_order == 1


def test_an_explicit_position_and_a_later_edit_are_left_alone():
    school = _school()
    course = Course.objects.create(school=school, name="Sala", sort_order=3)
    assert course.sort_order == 3
    course.name = "Sala grande"
    course.save()
    course.refresh_from_db()
    assert course.sort_order == 3


def test_a_special_event_gets_a_position_too():
    school = _school()
    Course.objects.create(school=school, name="Sala")
    event = Course.objects.create(school=school, name="Workshop", is_special_event=True)
    assert event.sort_order == 2
