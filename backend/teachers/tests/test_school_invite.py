"""POST /api/school/teachers/ — what a school gets when it adds a teacher.

A new person gets an invitation in the school's language; someone who already
has an account gets the teacher role (without it the frontend guard never
opened the Teacher panel) and no "choose your password" email, and the school
is told so instead of "invitation sent"."""
import uuid
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from accounts.models import Role, User
from notifications.models import EmailSetting
from schools.models import School
from students.models import Student
from teachers.models import Teacher, TeacherSchool

pytestmark = pytest.mark.django_db

URL = "/api/school/teachers/"


@pytest.fixture
def school():
    return School.objects.create(name="Danza Barcelona", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def api(school):
    admin = User.objects.create(email=f"sc-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, active_school=school)
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


def _add(api, capture, email, locale="es"):
    payload = {"first_name": "Alessia", "last_name": "Rossi", "email": email, "phone": "+34 600 000 000", "locale": locale}
    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, capture(execute=True):
        res = api.post(URL, payload, format="json")
    return res, delayed


def test_new_teacher_is_invited_in_the_school_language(api, school, django_capture_on_commit_callbacks):
    res, delayed = _add(api, django_capture_on_commit_callbacks, "new-teacher@example.com")
    assert res.status_code == 201, res.data
    assert res.data["email_sent"] is True and res.data["existing_account"] is False

    user = User.objects.get(email="new-teacher@example.com")
    assert user.roles == [Role.TEACHER] and not user.has_usable_password()
    assert user.language_preference == "es"
    assert TeacherSchool.objects.filter(teacher__user=user, school=school, active=True).exists()

    kwargs = delayed.call_args.kwargs
    assert kwargs["key"] == "team_invite" and kwargs["locale"] == "es"
    assert "/es/setup-account?uid=" in kwargs["context"]["setup_url"]


def test_existing_student_gets_the_teacher_role_and_no_setup_link(api, school, django_capture_on_commit_callbacks):
    student_user = User.objects.create_user("alessia@example.com", "Danza-2026", role=Role.STUDENT, roles=[Role.STUDENT])
    Student.objects.create(user=student_user, name="Alessia Rossi", school=school)

    res, delayed = _add(api, django_capture_on_commit_callbacks, "alessia@example.com")
    assert res.status_code == 201, res.data
    assert res.data["email_sent"] is False and res.data["existing_account"] is True
    delayed.assert_not_called()

    student_user.refresh_from_db()
    assert student_user.roles == [Role.STUDENT, Role.TEACHER]
    assert student_user.check_password("Danza-2026")  # untouched
    assert Teacher.objects.get(user=student_user).school_links.filter(school=school).exists()


def test_new_teacher_invite_reports_email_not_sent_when_team_invite_is_off(api, school, django_capture_on_commit_callbacks):
    """QA R2-H15: the "team_invite" template is shared with the HQ/school
    invite flows -- switching it off in HQ > Emails must be reflected here
    too instead of the endpoint still claiming `email_sent: true`."""
    EmailSetting.objects.create(key="enabled.team_invite", value="off")

    res, delayed = _add(api, django_capture_on_commit_callbacks, "another-teacher@example.com")
    assert res.status_code == 201, res.data
    assert res.data["email_sent"] is False and res.data["existing_account"] is False
    # The switch only silences delivery, not the invite/setup link itself.
    delayed.assert_called_once()


def test_teacher_who_never_set_a_password_is_invited_again(api, school, django_capture_on_commit_callbacks):
    user = User.objects.create(email="pending@example.com", role=Role.TEACHER, roles=[Role.TEACHER], language_preference="it")
    user.set_unusable_password()
    user.save()
    Teacher.objects.create(user=user, name="Pending", email="pending@example.com")

    res, delayed = _add(api, django_capture_on_commit_callbacks, "pending@example.com")
    assert res.status_code == 201, res.data
    assert res.data["email_sent"] is True and res.data["existing_account"] is False
    # Her own saved language wins over the school admin's UI language.
    assert delayed.call_args.kwargs["locale"] == "it"
