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
    # An email still leaves, but the "you've been added" one: no setup link
    # that would reset her password.
    assert res.data["email_sent"] is True and res.data["existing_account"] is True
    delayed.assert_called_once()
    kwargs = delayed.call_args.kwargs
    assert kwargs["key"] == "team_added"
    assert "setup_url" not in kwargs["context"]
    assert kwargs["context"]["login_url"].endswith("/login")
    assert kwargs["context"]["invite_org"] == school.name

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
    # She never chose a language herself (no password yet): the one the
    # school picks in the form wins, and it sticks to her row for the resend.
    assert delayed.call_args.kwargs["locale"] == "es"
    user.refresh_from_db()
    assert user.language_preference == "es"


def test_adding_an_already_active_teacher_again_sends_no_second_notice(api, school, django_capture_on_commit_callbacks):
    """Code review 13/09: the existing-account branch used to mail
    `team_added` on every POST, even when the link already existed."""
    User.objects.create_user("bianca@example.com", "Danza-2026", role=Role.STUDENT, roles=[Role.STUDENT])
    first, delayed_first = _add(api, django_capture_on_commit_callbacks, "bianca@example.com")
    assert first.status_code == 201 and first.data["email_sent"] is True and first.data["already_linked"] is False
    delayed_first.assert_called_once()

    second, delayed_second = _add(api, django_capture_on_commit_callbacks, "bianca@example.com")
    assert second.status_code == 201, second.data
    assert second.data["email_sent"] is False and second.data["already_linked"] is True
    delayed_second.assert_not_called()


def test_the_school_picks_the_language_of_the_invite(api, school, django_capture_on_commit_callbacks):
    """The form has a language field (default: the admin's UI language): a
    German teacher invited from an Italian panel gets a German invite, a
    German setup page, and German e-mails from then on."""
    res, delayed = _add(api, django_capture_on_commit_callbacks, "greta@example.com", locale="de")
    assert res.status_code == 201, res.data

    user = User.objects.get(email="greta@example.com")
    assert user.language_preference == "de"
    kwargs = delayed.call_args.kwargs
    assert kwargs["locale"] == "de" and "/de/setup-account?uid=" in kwargs["context"]["setup_url"]


def test_a_never_activated_teacher_reinvited_takes_the_new_language(api, school, django_capture_on_commit_callbacks):
    """Invited in Spanish by mistake, removed, added again in French before
    she ever set a password: the row has no preference of its own yet, the
    school's new choice wins and the invite goes out in French."""
    _add(api, django_capture_on_commit_callbacks, "lea@example.com", locale="es")
    TeacherSchool.objects.filter(teacher__user__email="lea@example.com").delete()

    res, delayed = _add(api, django_capture_on_commit_callbacks, "lea@example.com", locale="fr")
    assert res.status_code == 201, res.data
    assert User.objects.get(email="lea@example.com").language_preference == "fr"
    assert delayed.call_args.kwargs["locale"] == "fr"


def test_an_active_account_keeps_her_own_language(api, school, django_capture_on_commit_callbacks):
    """She already logs in and chose English herself: the school adding her
    as a teacher in Italian must not flip her e-mails to Italian."""
    student_user = User.objects.create_user(
        "amy@example.com", "Danza-2026", role=Role.STUDENT, roles=[Role.STUDENT], language_preference="en"
    )
    Student.objects.create(user=student_user, name="Amy Rossi", school=school)

    res, delayed = _add(api, django_capture_on_commit_callbacks, "amy@example.com", locale="it")
    assert res.status_code == 201 and res.data["existing_account"] is True
    student_user.refresh_from_db()
    assert student_user.language_preference == "en"
    assert delayed.call_args.kwargs["locale"] == "en"


def test_the_roster_shows_each_teacher_language(api, school, django_capture_on_commit_callbacks):
    _add(api, django_capture_on_commit_callbacks, "greta@example.com", locale="de")
    res = api.get(URL)
    assert res.status_code == 200
    assert res.data["teachers"][0]["teachers"]["language_preference"] == "de"
