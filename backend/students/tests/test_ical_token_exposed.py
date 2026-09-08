"""QA_REGRESSION_ROUND2 X-R2-16: `Student.ical_token` has always been generated
(default=uuid.uuid4, see the 0002_student_ical_token migration) and the
per-student feed (`GET /api/calendar/student/<token>.ics`,
catalog/ical_views.StudentICalView) has worked since it was wired in --  but
`StudentSerializer` never returned the token to the student, so there was no
way to discover the feed's URL from the product itself. This is a low-risk
wiring fix: expose `ical_token` read-only on `GET /api/student/profile/` (and
confirm it can't be set via `PATCH`, since it is meant to be a stable, quietly
rotatable-only-by-us identifier -- same trust model as `School.ical_token`).

The field is added on a new `StudentSelfSerializer` subclass rather than on
`StudentSerializer` itself, because that base serializer is also what
school_views.py hands to school/HQ staff viewing a student's profile
(StudentSheet etc.) -- this keeps a student's personal calendar-feed token
from also leaking to the school side, which nothing asked for."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from schools.models import School, SchoolStudent
from students.models import Student

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def student():
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name="Stu")


def _client_for(student):
    client = APIClient()
    client.force_authenticate(student.user)
    return client


def test_profile_exposes_ical_token(student):
    resp = _client_for(student).get("/api/student/profile/")
    assert resp.status_code == 200
    body = resp.json()
    assert "ical_token" in body
    assert body["ical_token"] == str(student.ical_token)


def test_ical_token_is_a_real_uuid_and_feeds_the_ics_endpoint(student):
    body = _client_for(student).get("/api/student/profile/").json()
    token = body["ical_token"]
    # Doesn't raise -- confirms the serialized value round-trips as a UUID,
    # the same shape catalog.ical_views.StudentICalView matches on.
    uuid.UUID(token)

    resp = _client_for(student).get(f"/api/calendar/student/{token}.ics")
    assert resp.status_code == 200
    assert resp["Content-Type"].startswith("text/calendar")


def test_ical_token_is_read_only_on_patch(student):
    original = student.ical_token
    other_token = uuid.uuid4()
    resp = _client_for(student).patch(
        "/api/student/profile/", {"ical_token": str(other_token)}, format="json"
    )
    assert resp.status_code == 200
    student.refresh_from_db()
    assert student.ical_token == original
    assert student.ical_token != other_token


def test_school_side_view_of_the_student_does_not_leak_the_token(student):
    """The school's own view of a student (StudentSheet, SchoolStudentListView
    PATCH) reuses `StudentSerializer` -- confirms ical_token was added on a
    separate `StudentSelfSerializer` instead of on the shared base, so a
    school doesn't incidentally gain the student's personal calendar-feed
    token just by viewing/editing her profile from the school side."""
    from accounts.models import Role

    school = School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com",
    )
    SchoolStudent.objects.create(school=school, student=student)
    school_user = User.objects.create(
        email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school,
    )
    from schools.models import SchoolMembership

    SchoolMembership.objects.create(profile=school_user, school=school, sub_role="admin")
    school_client = APIClient()
    school_client.force_authenticate(school_user)

    resp = school_client.patch(
        "/api/school/students/", {"student_user_id": str(student.user_id), "phone": "12345"}, format="json"
    )
    assert resp.status_code == 200
    assert "ical_token" not in resp.json()
