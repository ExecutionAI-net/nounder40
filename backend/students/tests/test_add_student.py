"""The "Add student" button of the Students page (POST /api/school/students/,
students/services.add_student): one student typed in by the school.

It is one row of the import, so the outcomes are the import's -- a new
account, an enrollment of an existing one, a refusal when she is here
already, an error naming the field -- except that the student is not stamped
as imported, and the password e-mail can leave right away when asked.
"""
import uuid
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from notifications.models import EmailSetting
from schools.models import School, SchoolMembership, SchoolRole, SchoolStudent
from students.models import Student
from students.services import INVITE_EMAIL_KEY, PASSWORD_RESET_KEY

pytestmark = pytest.mark.django_db
User = get_user_model()
URL = "/api/school/students/"


def _school(name="Danza Barcelona"):
    from core import section_guard

    SchoolRole.objects.update_or_create(key="admin", defaults={"label": "Admin", "builtin": True, "permissions": ["students"]})
    section_guard._matrix_cache["expires"] = 0.0  # see test_import_students._school
    return School.objects.create(
        name=name, slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com", language="it",
        country="Italy", active=True,
    )


def _client(school):
    user = User.objects.create(
        email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
        language_preference="it",
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="admin")
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


def _student(school, email, *, password=None):
    user = User.objects.create(email=email, role=Role.STUDENT, roles=[Role.STUDENT], first_name="Gina", last_name="Schimkovits")
    if password:
        user.set_password(password)
    else:
        user.set_unusable_password()
    user.save()
    student = Student.objects.create(user=user, first_name="Gina", last_name="Schimkovits", email=email, school=school)
    if school is not None:
        SchoolStudent.objects.create(school=school, student=student)
    return student


def _post(api, payload, capture):
    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, capture(execute=True):
        res = api.post(URL, payload, format="json")
    return res, [c.kwargs for c in delayed.call_args_list]


PAYLOAD = {
    "email": "Ivana.Argentieri@gmail.com", "first_name": "Ivana", "last_name": "Argentieri",
    "phone": "348 7258699", "city": "Roma", "country": "Italy", "date_of_birth": "1975-04-12",
    "language_preference": "es",
}


def test_creates_account_profile_and_enrollment_and_sends_the_invite(django_capture_on_commit_callbacks):
    school = _school()
    res, mails = _post(_client(school), PAYLOAD, django_capture_on_commit_callbacks)
    assert res.status_code == 201, res.content
    body = res.json()
    assert body["action"] == "create" and body["password_email"] == "invite"

    user = User.objects.get(email="ivana.argentieri@gmail.com")  # lowercased
    assert user.roles == [Role.STUDENT] and not user.has_usable_password()
    student = user.student
    assert body["student_id"] == str(student.pk)
    assert student.name == "Ivana Argentieri"
    assert student.phone == "+39 3487258699"  # the school's prefix, like the import
    assert student.country == "IT"
    assert student.language_preference == "es"
    assert str(student.date_of_birth) == "1975-04-12"
    link = SchoolStudent.objects.get(school=school, student=student)
    assert link.imported_at is None  # typed in, not imported

    # The invitation left, after commit, in the student's language
    assert len(mails) == 1
    assert mails[0]["key"] == INVITE_EMAIL_KEY and mails[0]["locale"] == "es"
    assert mails[0]["to_email"] == "ivana.argentieri@gmail.com"
    assert "/es/setup-account?uid=" in mails[0]["context"]["setup_url"]


def test_send_email_false_queues_nothing(django_capture_on_commit_callbacks):
    school = _school()
    res, mails = _post(_client(school), {**PAYLOAD, "send_email": False}, django_capture_on_commit_callbacks)
    assert res.status_code == 201, res.content
    assert res.json()["password_email"] is None
    assert mails == []
    assert SchoolStudent.objects.filter(school=school, student__email="ivana.argentieri@gmail.com").exists()


def test_existing_account_is_enrolled_and_gets_the_reset(django_capture_on_commit_callbacks):
    school, other = _school(), _school("Altra")
    existing = _student(other, "gina@example.com", password="Segreta123!")
    res, mails = _post(
        _client(school), {"email": "gina@example.com", "first_name": "Other", "last_name": "Name"},
        django_capture_on_commit_callbacks,
    )
    assert res.status_code == 201, res.content
    assert res.json() == {**res.json(), "action": "enroll", "student_id": str(existing.pk), "password_email": "reset"}
    assert SchoolStudent.objects.filter(school=school, student=existing).exists()
    existing.refresh_from_db()
    assert existing.first_name == "Gina"  # her profile is hers: untouched
    assert Student.objects.count() == 1
    assert [m["key"] for m in mails] == [PASSWORD_RESET_KEY]


def test_already_enrolled_is_a_409(django_capture_on_commit_callbacks):
    school = _school()
    existing = _student(school, "gina@example.com")
    res, mails = _post(_client(school), {"email": "gina@example.com", "first_name": "Gina"}, django_capture_on_commit_callbacks)
    assert res.status_code == 409, res.content
    assert res.json() == {"error": "already_enrolled", "student_id": str(existing.pk)}
    assert mails == []


@pytest.mark.parametrize(
    "payload, error, field",
    [
        ({"first_name": "Gina"}, "missing_email", "email"),
        ({"email": "not-an-email", "first_name": "Gina"}, "invalid_email", "email"),
        ({"email": "gina@example.com"}, "missing_name", "name"),
        ({"email": "gina@example.com", "first_name": "Gina", "date_of_birth": "12/04/1975"}, "invalid_date", "date_of_birth"),
        ({"email": "gina@example.com", "first_name": "Gina", "city": "x" * 121}, "too_long", "city"),
    ],
)
def test_bad_rows_are_400_with_the_field(payload, error, field, django_capture_on_commit_callbacks):
    school = _school()
    res, mails = _post(_client(school), payload, django_capture_on_commit_callbacks)
    assert res.status_code == 400, res.content
    assert res.json() == {"error": error, "field": field}
    assert not User.objects.filter(email="gina@example.com").exists()
    assert mails == []


def test_switched_off_email_is_reported_honestly(django_capture_on_commit_callbacks):
    school = _school()
    EmailSetting.objects.create(key=f"enabled.{INVITE_EMAIL_KEY}", value="false")
    res, mails = _post(_client(school), PAYLOAD, django_capture_on_commit_callbacks)
    assert res.status_code == 201, res.content
    assert res.json()["password_email"] is None
    assert mails == []
    assert User.objects.filter(email="ivana.argentieri@gmail.com").exists()


def test_school_language_is_the_default_when_the_row_has_none():
    school = _school()
    api = _client(school)  # admin works in "it"
    res = api.post(URL, {"email": "gina@example.com", "first_name": "Gina", "send_email": False}, format="json")
    assert res.status_code == 201, res.content
    assert Student.objects.get(email="gina@example.com").language_preference == "it"
