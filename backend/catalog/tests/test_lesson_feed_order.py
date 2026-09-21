"""Carlo, 2026-09-21: two lessons at the same day and time ("Sala" and
"Online") swapped places between one calendar load and the next. Every
lesson feed sorted by (date, start_time) only, so ties came back in whatever
order Postgres produced. Ties now follow the order the school gives its
courses on the Courses page (Course.sort_order), courses without a position
last, then name and id -- the same rule in the student calendar, the public
upcoming feed and the school feed (catalog.services.LESSON_FEED_ORDER)."""
import uuid
from datetime import date, time, timedelta

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from catalog.models import Course, Lesson
from schools.models import School, SchoolMembership, SchoolRole

pytestmark = pytest.mark.django_db
User = get_user_model()

TOMORROW = date.today() + timedelta(days=1)


@pytest.fixture
def school():
    SchoolRole.objects.update_or_create(
        key="owner", defaults={"label": "Titolare", "builtin": True, "permissions": ["calendar", "courses"]}
    )
    return School.objects.create(
        name="Danza Barcelona", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com", active=True
    )


@pytest.fixture
def owner_client(school):
    user = User.objects.create(
        email=f"own-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


def _same_slot(school):
    """Three lessons at the same minute. Insertion order is unranked, Online,
    Sala -- the opposite of what the school wants: Sala first (position 1),
    Online second (position 2), the course without a position last."""
    # A legacy row: since migration 0020 every course is created with a
    # position, so the null has to be forced after the insert.
    unranked = Course.objects.create(school=school, name="Aaa senza posizione")
    Course.objects.filter(pk=unranked.pk).update(sort_order=None)
    online = Course.objects.create(school=school, name="Online Danza Classica", sort_order=2, is_online=True)
    sala = Course.objects.create(school=school, name="Danza Classica Sala", sort_order=1)
    lessons = {}
    for course in (unranked, online, sala):
        lessons[course.name] = Lesson.objects.create(
            school=school, course=course, date=TOMORROW, start_time=time(10, 0), end_time=time(11, 10),
            is_online=course.is_online,
        )
    return [str(lessons[c.name].id) for c in (sala, online, unranked)]


def _ids(rows):
    return [r["id"] for r in rows]


def test_student_calendar_orders_ties_by_the_school_course_order(school):
    expected = _same_slot(school)
    res = APIClient().get(f"/api/student/lessons/?school_id={school.id}&date={TOMORROW.isoformat()}")
    assert res.status_code == 200, res.data
    rows = res.data["results"] if isinstance(res.data, dict) else res.data
    assert _ids(rows) == expected


def test_public_upcoming_feed_orders_ties_by_the_school_course_order(school):
    expected = _same_slot(school)
    res = APIClient().get("/api/lessons/public/upcoming/?days=3&limit=10")
    assert res.status_code == 200, res.data
    rows = res.data["results"] if isinstance(res.data, dict) else res.data
    assert [i for i in _ids(rows) if i in expected] == expected


def test_school_feed_orders_ties_by_the_school_course_order(owner_client, school):
    expected = _same_slot(school)
    res = owner_client.get(f"/api/school/lessons-feed/?from={TOMORROW.isoformat()}&to={TOMORROW.isoformat()}")
    assert res.status_code == 200, res.data
    assert _ids(res.data) == expected
    assert [r["courses"]["sort_order"] for r in res.data] == [1, 2, None]
