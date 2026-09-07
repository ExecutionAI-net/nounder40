"""POST /api/school/team/ must thread the invite's locale through the setup
email (M-6, QA regression): before this fix the School Team invite always
sent English regardless of School.language or the inviting admin's UI
locale, unlike the working Teacher-invite path
(teachers.views._send_teacher_invite_email). See
schools.views._send_school_team_invite_email / _school_invite_locale."""
import uuid
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role, User
from schools.models import School, SchoolMembership

pytestmark = pytest.mark.django_db

URL = "/api/school/team/"


@pytest.fixture
def school():
    return School.objects.create(
        name="Danza Milano", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", language="it",
    )


@pytest.fixture
def owner(school):
    user = User.objects.create(
        email=f"owner-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    return user


@pytest.fixture
def api(owner):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(owner).access_token}")
    return client


def _invite(api, capture, payload):
    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, capture(execute=True):
        res = api.post(URL, payload, format="json")
    return res, delayed


def test_new_team_member_is_invited_in_the_requested_locale(api, django_capture_on_commit_callbacks):
    email = f"invitee-{uuid.uuid4().hex[:8]}@example.com"
    payload = {"email": email, "name": "New Person", "school_sub_role": "staff", "locale": "it"}

    res, delayed = _invite(api, django_capture_on_commit_callbacks, payload)

    assert res.status_code == 201, res.data
    user = User.objects.get(email__iexact=email)
    assert user.language_preference == "it"

    kwargs = delayed.call_args.kwargs
    assert kwargs["key"] == "team_invite" and kwargs["locale"] == "it"
    assert "/it/setup-account?uid=" in kwargs["context"]["setup_url"]


def test_locale_falls_back_to_school_language_when_request_omits_it(api, django_capture_on_commit_callbacks):
    email = f"invitee-{uuid.uuid4().hex[:8]}@example.com"
    payload = {"email": email, "name": "New Person", "school_sub_role": "staff"}  # no explicit locale

    res, delayed = _invite(api, django_capture_on_commit_callbacks, payload)

    assert res.status_code == 201, res.data
    kwargs = delayed.call_args.kwargs
    # school.language == "it" (fixture) — falls back to it, not hardcoded English.
    assert kwargs["locale"] == "it"
    assert "/it/setup-account?uid=" in kwargs["context"]["setup_url"]


def test_locale_falls_back_to_english_when_school_has_no_supported_language(api, school, django_capture_on_commit_callbacks):
    school.language = "xx"  # not one of the 5 supported locales
    school.save(update_fields=["language"])
    email = f"invitee-{uuid.uuid4().hex[:8]}@example.com"
    payload = {"email": email, "name": "New Person", "school_sub_role": "staff"}

    res, delayed = _invite(api, django_capture_on_commit_callbacks, payload)

    assert res.status_code == 201, res.data
    kwargs = delayed.call_args.kwargs
    assert kwargs["locale"] == "en"
    assert "/en/setup-account?uid=" in kwargs["context"]["setup_url"]
