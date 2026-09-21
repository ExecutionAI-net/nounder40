"""The Courses page no longer loads every course up front: it asks
`courses-overview` for the ones matching the filters the school picked, and
`courses-filter-options` for what those filters can offer. Reordering a
filtered subset must not disturb the positions of the courses left out."""
import uuid
from datetime import time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from catalog.models import Course, Lesson
from schools.models import School, SchoolLocation, SchoolMembership, SchoolRoom
from teachers.models import Teacher

pytestmark = pytest.mark.django_db
User = get_user_model()
OVERVIEW = "/api/school/courses-overview/"
OPTIONS = "/api/school/courses-filter-options/"
REORDER = "/api/school/courses-reorder/"


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True)


@pytest.fixture
def client(school):
    user = User.objects.create(
        email=f"o-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return c


def _teacher(name):
    user = User.objects.create(email=f"t-{uuid.uuid4().hex[:8]}@example.com")
    return Teacher.objects.create(user=user, name=name, email=user.email)


def _room(school, name):
    loc = SchoolLocation.objects.create(school=school, name=f"Loc {name}")
    return SchoolRoom.objects.create(location=loc, name=name)


def _next_weekday(target):  # 0 = Monday
    d = timezone.localdate() + timedelta(days=1)
    while d.weekday() != target:
        d += timedelta(days=1)
    return d


def _lesson(school, course, *, day, at=time(18, 0), teacher=None, room=None, online=False, status="scheduled"):
    return Lesson.objects.create(
        school=school, course=course, teacher=teacher, room=room, date=day, start_time=at,
        end_time=time(at.hour + 1, at.minute), is_online=online, status=status,
    )


def _ids(res):
    assert res.status_code == 200, res.content
    return {row["id"] for row in res.json()}


def test_no_filter_lists_every_course_even_without_lessons(school, client):
    with_lessons = Course.objects.create(school=school, name="A")
    _lesson(school, with_lessons, day=_next_weekday(0))
    empty = Course.objects.create(school=school, name="B")
    assert _ids(client.get(OVERVIEW)) == {str(with_lessons.id), str(empty.id)}


def test_a_filter_keeps_only_courses_with_a_matching_upcoming_lesson(school, client):
    monday = Course.objects.create(school=school, name="Mon")
    tuesday = Course.objects.create(school=school, name="Tue")
    empty = Course.objects.create(school=school, name="None")
    _lesson(school, monday, day=_next_weekday(0))
    _lesson(school, tuesday, day=_next_weekday(1))
    assert _ids(client.get(OVERVIEW, {"weekday": "monday"})) == {str(monday.id)}
    assert _ids(client.get(OVERVIEW, {"weekday": "monday,tuesday"})) == {str(monday.id), str(tuesday.id)}
    assert str(empty.id) not in _ids(client.get(OVERVIEW, {"weekday": "monday,tuesday"}))


def test_filters_must_all_hold_on_the_same_lesson(school, client):
    course = Course.objects.create(school=school, name="Mixed")
    # Monday at 18:00 and Tuesday at 10:00: "monday AND 10:00" matches neither
    _lesson(school, course, day=_next_weekday(0), at=time(18, 0))
    _lesson(school, course, day=_next_weekday(1), at=time(10, 0))
    assert _ids(client.get(OVERVIEW, {"weekday": "monday", "start_time": "18:00"})) == {str(course.id)}
    assert _ids(client.get(OVERVIEW, {"weekday": "monday", "start_time": "10:00"})) == set()


def test_a_matching_course_still_carries_all_its_schedule_rows(school, client):
    course = Course.objects.create(school=school, name="Two days")
    _lesson(school, course, day=_next_weekday(0))
    _lesson(school, course, day=_next_weekday(1))
    (row,) = client.get(OVERVIEW, {"weekday": "monday"}).json()
    assert {s["weekday"] for s in row["_schedules"]} == {"monday", "tuesday"}


def test_teacher_room_location_and_mode_filters(school, client):
    ann, bea = _teacher("Ann"), _teacher("Bea")
    room_a, room_b = _room(school, "A"), _room(school, "B")
    c1 = Course.objects.create(school=school, name="c1", teacher=ann)
    c2 = Course.objects.create(school=school, name="c2", teacher=bea)
    _lesson(school, c1, day=_next_weekday(0), room=room_a)  # course teacher Ann (default)
    _lesson(school, c2, day=_next_weekday(0), room=room_b, teacher=ann, online=True)  # lesson teacher overrides
    assert _ids(client.get(OVERVIEW, {"teacher": str(ann.id)})) == {str(c1.id), str(c2.id)}
    assert _ids(client.get(OVERVIEW, {"teacher": str(bea.id)})) == set()
    assert _ids(client.get(OVERVIEW, {"room": str(room_a.id)})) == {str(c1.id)}
    assert _ids(client.get(OVERVIEW, {"location": str(room_b.location_id)})) == {str(c2.id)}
    assert _ids(client.get(OVERVIEW, {"mode": "online"})) == {str(c2.id)}
    assert _ids(client.get(OVERVIEW, {"mode": "inperson"})) == {str(c1.id)}
    assert _ids(client.get(OVERVIEW, {"mode": "online,inperson"})) == {str(c1.id), str(c2.id)}


def test_past_and_cancelled_lessons_do_not_match(school, client):
    course = Course.objects.create(school=school, name="c")
    _lesson(school, course, day=timezone.localdate() - timedelta(days=7))
    _lesson(school, course, day=_next_weekday(0), status="cancelled")
    assert _ids(client.get(OVERVIEW, {"weekday": "monday"})) == set()


def test_another_schools_courses_are_never_listed(school, client):
    other = School.objects.create(name="O", slug=f"o-{uuid.uuid4().hex[:8]}", email="o@example.com", active=True)
    theirs = Course.objects.create(school=other, name="theirs")
    _lesson(other, theirs, day=_next_weekday(0))
    assert _ids(client.get(OVERVIEW, {"weekday": "monday"})) == set()


def test_bad_filter_values_are_a_400(client):
    assert client.get(OVERVIEW, {"weekday": "funday"}).status_code == 400
    assert client.get(OVERVIEW, {"mode": "hybrid"}).status_code == 400
    assert client.get(OVERVIEW, {"teacher": "not-a-uuid"}).status_code == 400
    assert client.get(OVERVIEW, {"start_time": "25:99"}).status_code == 400


def test_filter_options_are_the_distinct_values_of_upcoming_lessons(school, client):
    ann = _teacher("Ann")
    room = _room(school, "Sala")
    course = Course.objects.create(school=school, name="c", teacher=ann)
    _lesson(school, course, day=_next_weekday(2), at=time(9, 30), room=room)
    _lesson(school, course, day=_next_weekday(2) + timedelta(days=7), at=time(9, 30), room=room)
    _lesson(school, course, day=_next_weekday(0), at=time(18, 0))
    _lesson(school, course, day=timezone.localdate() - timedelta(days=3), at=time(7, 0))  # past: not offered
    body = client.get(OPTIONS).json()
    assert body["weekdays"] == ["monday", "wednesday"]
    assert body["start_times"] == ["09:30", "18:00"]
    assert body["teachers"] == [{"id": str(ann.id), "name": "Ann"}]
    assert body["locations"] == [{"id": str(room.location_id), "name": room.location.name}]
    assert body["rooms"] == [{"id": str(room.id), "name": "Sala", "location_id": str(room.location_id)}]


def test_reordering_a_subset_keeps_the_positions_of_the_others(school, client):
    a, b, c, d = (Course.objects.create(school=school, name=n) for n in "abcd")  # positions 1..4
    res = client.post(REORDER, {"ids": [str(d.id), str(b.id)]}, format="json")  # swap b and d, a/c not sent
    assert res.status_code == 200
    positions = {x.name: Course.objects.get(pk=x.pk).sort_order for x in (a, b, c, d)}
    assert positions == {"a": 1, "b": 4, "c": 3, "d": 2}


def test_reordering_the_full_list_numbers_it_from_one(school, client):
    a, b, c = (Course.objects.create(school=school, name=n) for n in "abc")
    client.post(REORDER, {"ids": [str(c.id), str(a.id), str(b.id)]}, format="json")
    assert [Course.objects.get(pk=x.pk).sort_order for x in (c, a, b)] == [1, 2, 3]
