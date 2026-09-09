"""R3-M10 (QA_REGRESSION_ROUND3_CROSSCUT.md X-R3-04): a student could
re-home herself and redirect her own school's e-mails.

`PATCH /api/student/profile/` hands the student's own body to
`StudentSelfSerializer`. `ical_token` was read-only there from the start and
`user` was never in `Meta.fields` at all — but `school` and `email` were both
writable:

    PATCH {"school": "<E2>", "email": "qa-r3-x-hijack2@uberip.com"}  -> 200

`school` bypassed the enrolment flow entirely — `POST /student/school/`
checks `active=True` and creates the `SchoolStudent` link, and this wrote
neither — leaving a "home school" the student is not enrolled in.
`Student.email` is not the login (`User.email` is) but it *is* the address
booking, purchase and no-show e-mails follow (R2-M13), so once the two
diverge the school's mail about a real student goes elsewhere.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from schools.models import School, SchoolMembership, SchoolRole, SchoolStudent
from students.models import Student

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def home_school():
    return School.objects.create(
        name="Home", slug=f"h-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com", active=True
    )


@pytest.fixture
def other_school():
    return School.objects.create(
        name="Other", slug=f"o-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com", active=True
    )


@pytest.fixture
def student(home_school):
    user = User.objects.create(
        email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT]
    )
    obj = Student.objects.create(user=user, name="Anna", email=user.email, school=home_school)
    SchoolStudent.objects.create(school=home_school, student=obj)
    return obj


@pytest.fixture
def student_client(student):
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(student.user).access_token}")
    return api


def test_a_student_cannot_re_home_herself(student_client, student, other_school):
    """The live repro: 200, `school` moved to a school she has no link to."""
    resp = student_client.patch("/api/student/profile/", {"school": str(other_school.id)}, format="json")

    assert resp.status_code == 200, resp.content
    student.refresh_from_db()
    assert student.school_id != other_school.id
    assert not SchoolStudent.objects.filter(school=other_school, student=student).exists()


def test_a_student_cannot_rewrite_her_notification_email(student_client, student):
    original = student.email

    resp = student_client.patch(
        "/api/student/profile/", {"email": "qa-r3-x-hijack2@example.com"}, format="json"
    )

    assert resp.status_code == 200, resp.content
    student.refresh_from_db()
    assert student.email == original


def test_both_in_one_request_are_both_ignored(student_client, student, other_school):
    original_email, original_school = student.email, student.school_id

    resp = student_client.patch(
        "/api/student/profile/",
        {"school": str(other_school.id), "email": "hijack@example.com", "phone": "+391234"},
        format="json",
    )

    assert resp.status_code == 200, resp.content
    student.refresh_from_db()
    assert (student.email, student.school_id) == (original_email, original_school)
    assert student.phone == "+391234", "the legitimate fields in the same body must still save"


def test_the_ical_token_stays_read_only_and_still_exposed(student_client, student):
    """R2 X-R2-16's fix must survive this edit: the token is returned but
    never writable."""
    original = str(student.ical_token)

    resp = student_client.patch(
        "/api/student/profile/", {"ical_token": "00000000-0000-0000-0000-000000000000"}, format="json"
    )

    assert resp.status_code == 200, resp.content
    assert resp.json()["ical_token"] == original
    student.refresh_from_db()
    assert str(student.ical_token) == original


def test_the_ordinary_profile_fields_still_save(student_client, student):
    resp = student_client.patch(
        "/api/student/profile/",
        {"first_name": "Anna", "last_name": "Rossi", "city": "Milano", "language_preference": "it"},
        format="json",
    )

    assert resp.status_code == 200, resp.content
    student.refresh_from_db()
    assert (student.first_name, student.city, student.language_preference) == ("Anna", "Milano", "it")


def test_the_intended_school_flow_still_works(student_client, student, other_school):
    """Read-only on the profile must not close the door the product opens."""
    resp = student_client.post("/api/student/school/", {"school_id": str(other_school.id)}, format="json")

    assert resp.status_code == 200, resp.content
    student.refresh_from_db()
    assert student.school_id == other_school.id
    assert SchoolStudent.objects.filter(school=other_school, student=student).exists()


def test_the_school_side_can_still_edit_a_students_contact_details(student, home_school):
    """`StudentSerializer` is shared with the school panel. That path writes
    the model by hand and only uses the serializer for its response, so
    read-only fields there would have been silently dropped from the *reply*
    rather than from the write -- pin that the school's own correction of a
    student's e-mail still lands, and still comes back in the body."""
    for key in ("owner", "admin", "staff"):
        SchoolRole.objects.update_or_create(
            key=key, defaults={"label": key.title(), "builtin": True, "permissions": ["students"]}
        )
    staff = User.objects.create(
        email=f"own-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=home_school,
    )
    SchoolMembership.objects.create(profile=staff, school=home_school, sub_role="owner")
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(staff).access_token}")

    resp = api.patch(
        "/api/school/students/",
        {"student_user_id": str(student.user_id), "email": "updated@example.com"},
        format="json",
    )

    assert resp.status_code == 200, resp.content
    assert resp.json()["email"] == "updated@example.com"
    student.refresh_from_db()
    assert student.email == "updated@example.com"
