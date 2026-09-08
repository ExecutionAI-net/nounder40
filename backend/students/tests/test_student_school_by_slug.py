"""R3-M4 (QA_REGRESSION_ROUND3_SCHOOL.md SCH-R3-02): the shareable slug deep
link never enrolled the student.

`/student/book?school=<slug>` is the link the product tells schools to share
("lo slug è più pulito da girare via chat/WhatsApp"). `/register?next=…`
forwards whatever that link carried straight to
`POST /api/student/school/ {"school_id": <slug>}`, and the view did
`School.objects.filter(pk=<slug>)` — a non-UUID pk is not a 404 but an
unhandled `ValidationError` deep in the ORM, i.e. a **500** on an
authenticated endpoint. The register page `.catch()`es it and redirects, so
the student landed on the booking page unenrolled, invisible to the school's
roster, counters and grants.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from schools.models import School, SchoolStudent
from students.models import Student

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    return School.objects.create(
        name="QA R3 School B", slug=f"qa-r3-school-{uuid.uuid4().hex[:6]}",
        email=f"{uuid.uuid4().hex[:6]}@example.com", active=True,
    )


@pytest.fixture
def student_client():
    user = User.objects.create(
        email=f"s-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT]
    )
    student = Student.objects.create(user=user, name="QA Student")
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api, student


def test_a_slug_enrols_the_student(student_client, school):
    """The exact live repro: 500 before, student left unenrolled."""
    api, student = student_client

    resp = api.post("/api/student/school/", {"school_id": school.slug}, format="json")

    assert resp.status_code == 200, resp.content
    assert resp.json()["school"]["id"] == str(school.id)
    student.refresh_from_db()
    assert student.school_id == school.id
    assert SchoolStudent.objects.filter(school=school, student=student).exists()


def test_a_uuid_still_enrols_the_student(student_client, school):
    api, student = student_client

    resp = api.post("/api/student/school/", {"school_id": str(school.id)}, format="json")

    assert resp.status_code == 200, resp.content
    student.refresh_from_db()
    assert student.school_id == school.id


def test_an_unknown_slug_is_a_clean_404(student_client):
    api, student = student_client

    resp = api.post("/api/student/school/", {"school_id": "no-such-school"}, format="json")

    assert resp.status_code == 404, resp.content
    assert resp.json()["error"] == "school_not_found"
    student.refresh_from_db()
    assert student.school_id is None


def test_an_unknown_uuid_is_a_clean_404(student_client):
    api, _ = student_client
    resp = api.post("/api/student/school/", {"school_id": str(uuid.uuid4())}, format="json")
    assert resp.status_code == 404, resp.content


def test_a_deactivated_school_is_not_reachable_by_slug(student_client, school):
    """The `active=True` filter must survive the slug branch."""
    school.active = False
    school.save(update_fields=["active"])
    api, _ = student_client

    resp = api.post("/api/student/school/", {"school_id": school.slug}, format="json")

    assert resp.status_code == 404, resp.content


@pytest.mark.parametrize("value", ["", "   ", None])
def test_a_blank_identifier_is_a_clean_404(student_client, value):
    api, _ = student_client
    resp = api.post("/api/student/school/", {"school_id": value}, format="json")
    assert resp.status_code == 404, resp.content


def test_a_non_string_identifier_does_not_blow_up(student_client):
    api, _ = student_client
    resp = api.post("/api/student/school/", {"school_id": 12345}, format="json")
    assert resp.status_code == 404, resp.content
