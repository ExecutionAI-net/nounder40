"""R2-M20 — la copia delle notifiche deve dire la verità.

a) L'invito (HQ, titolare/staff di scuola, insegnante) usava un unico
   `team_invite` che non nominava mai ne' la scuola ne' il ruolo.
b) L'email di no-show diceva "oggi" a prescindere: una lezione a 16 giorni
   produceva "Du hast uns heute gefehlt".
c) `student.account_deleted` dava per scontata l'autocancellazione anche
   quando era la scuola a eliminare l'account.
"""
import re
import uuid
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model

from accounts.models import HQMember, HQRole, PendingInvitation, Role
from notifications.brand_templates import TEMPLATES
from notifications.emails import get_template, render
from schools.models import School, SchoolMembership, SchoolRole
from students.models import Student
from teachers.models import Teacher, TeacherSchool
from teachers.views import _send_teacher_invite_email

pytestmark = pytest.mark.django_db

LOCALES = ("en", "it", "es", "fr", "de")


def _user(**kwargs):
    user = get_user_model()(email=f"u-{uuid.uuid4().hex[:8]}@example.com", **kwargs)
    user.set_unusable_password()
    user.save()
    return user


@pytest.fixture
def school():
    return School.objects.create(
        name="Danza Milano", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        active=True, language="it",
    )


# --- (a) l'invito nomina scuola e ruolo -----------------------------------

def test_school_team_invite_names_the_school_and_the_role(school, django_capture_on_commit_callbacks):
    from schools.views import _send_school_team_invite_email

    SchoolRole.objects.update_or_create(
        key="admin", defaults={"label": "Amministratrice", "builtin": True, "permissions": ["students"]}
    )
    user = _user(role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school, language_preference="it")
    SchoolMembership.objects.create(profile=user, school=school, sub_role="admin")

    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed:
        with django_capture_on_commit_callbacks(execute=True):
            _send_school_team_invite_email(user, locale="it", school=school, sub_role="admin")

    ctx = delayed.call_args.kwargs["context"]
    assert ctx["invite_org"] == "Danza Milano"
    assert ctx["invite_role"] == "Amministratrice"
    body = render(get_template("team_invite", locale="it").body_html, ctx)
    assert "Danza Milano" in body and "Amministratrice" in body


def test_teacher_invite_names_the_school_and_says_teacher(school, django_capture_on_commit_callbacks):
    user = _user(role=Role.TEACHER, roles=[Role.TEACHER], language_preference="it")
    teacher = Teacher.objects.create(user=user, name="Prof")
    TeacherSchool.objects.create(teacher=teacher, school=school, active=True)

    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed:
        with django_capture_on_commit_callbacks(execute=True):
            _send_teacher_invite_email(user)

    ctx = delayed.call_args.kwargs["context"]
    assert ctx["invite_org"] == "Danza Milano"
    assert ctx["invite_role"] == "insegnante"


def test_hq_invite_names_hq_and_the_hq_role(django_capture_on_commit_callbacks):
    from accounts.hq_views import PendingInvitationViewSet

    HQRole.objects.update_or_create(
        key="support", defaults={"label": "Supporto", "builtin": True, "permissions": ["dashboard"]}
    )
    user = _user(role=Role.HQ, roles=[Role.HQ], language_preference="it")
    HQMember.objects.create(user=user, email=user.email, name="Sup", sub_role="support", active=True)

    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed:
        with django_capture_on_commit_callbacks(execute=True):
            PendingInvitationViewSet._send_invite_email(user)

    ctx = delayed.call_args.kwargs["context"]
    assert ctx["invite_org"] == "No Under 40 HQ"
    assert ctx["invite_role"] == "Supporto"


@pytest.mark.parametrize("locale", LOCALES)
def test_the_invite_copy_carries_both_variables_in_every_locale(locale):
    subject, text = TEMPLATES["team_invite"][locale]
    assert "{{invite_org}}" in subject + text
    assert "{{invite_role}}" in subject + text


def test_the_builtin_fallback_invite_also_names_them():
    """Il fallback built-in e' quello che parte quando nessuno ha ancora
    scritto la riga in HQ > Emails: deve dire le stesse cose."""
    from notifications.builtin_templates import get_builtin

    for locale in LOCALES:
        subject, body = get_builtin("team_invite", locale)
        assert "{{invite_org}}" in subject + body and "{{invite_role}}" in subject + body


# --- (b) il no-show non dice piu' "oggi" ----------------------------------

TODAY_WORDS = {
    "en": ("today",), "it": ("oggi",), "es": ("hoy",), "fr": ("aujourd'hui",), "de": ("heute",),
}


@pytest.mark.parametrize("locale", LOCALES)
def test_no_show_copy_no_longer_claims_the_lesson_was_today(locale):
    subject, text = TEMPLATES["student.no_show"][locale]
    blob = (subject + text).lower()
    for word in TODAY_WORDS[locale]:
        assert word not in blob, (locale, word)
    assert "{{lesson_date}}" in subject + text and "{{lesson_time}}" in text


@pytest.mark.parametrize("locale", LOCALES)
def test_no_show_email_renders_the_real_lesson_date(locale):
    template = get_template("student.no_show", locale=locale)
    assert template is not None
    context = {
        "student_first_name": "Giulia", "lesson_name": "QA Course", "lesson_date": "23-09-2026",
        "lesson_time": "18:00", "school_name": "Danza Milano", "school_calendar_url": "https://x/cal",
    }
    rendered = render(template.subject, context) + render(template.body_html, context)
    assert "23-09-2026" in rendered and "18:00" in rendered
    assert not re.search(r"\{\{\w+\}\}", rendered)


# --- (c) chi ha cancellato l'account --------------------------------------

def test_self_deletion_uses_the_self_deletion_copy(school, django_capture_on_commit_callbacks):
    from students.views import _send_account_deleted_email

    user = _user(role=Role.STUDENT, roles=[Role.STUDENT], language_preference="en")
    student = Student.objects.create(user=user, name="Giulia Bianchi", first_name="Giulia", school=school)

    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed:
        with django_capture_on_commit_callbacks(execute=True):
            _send_account_deleted_email(student)

    assert delayed.call_args.kwargs["key"] == "account_deleted"
    body = render(get_template("student.account_deleted", locale="en").body_html,
                  delayed.call_args.kwargs["context"])
    assert "you decided to delete your account" in body


def test_school_deletion_uses_its_own_copy(school, django_capture_on_commit_callbacks):
    from students.views import _send_account_deleted_email

    user = _user(role=Role.STUDENT, roles=[Role.STUDENT], language_preference="en")
    student = Student.objects.create(user=user, name="Giulia Bianchi", first_name="Giulia", school=school)

    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed:
        with django_capture_on_commit_callbacks(execute=True):
            _send_account_deleted_email(student, deleted_by_school=school)

    kwargs = delayed.call_args.kwargs
    assert kwargs["key"] == "account_deleted_by_school"
    assert kwargs["context"]["school_name"] == "Danza Milano"
    template = get_template("student.account_deleted_by_school", locale="en")
    body = render(template.body_html, kwargs["context"])
    assert "Danza Milano has deleted your" in body
    assert "you decided to delete" not in body


@pytest.mark.parametrize("locale", LOCALES)
def test_the_school_deletion_template_exists_in_every_locale(locale):
    template = get_template("student.account_deleted_by_school", locale=locale)
    assert template is not None
    rendered = render(template.subject + template.body_html, {
        "student_first_name": "Giulia", "school_name": "Danza Milano", "register_url": "https://x/r",
    })
    assert "Danza Milano" in rendered and not re.search(r"\{\{\w+\}\}", rendered)


def test_pending_invitation_model_is_untouched():
    """Sanity: il flusso di invito non ha cambiato forma, solo la copia."""
    assert PendingInvitation.Kind.HQ_MEMBER == "hq_member"
