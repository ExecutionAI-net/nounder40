"""Built-in fallback templates for the account-critical emails.

password_reset and team_invite gate access to the platform itself: before the
Django migration Supabase Auth sent them from its own templates, so no row for
them ever existed in email_templates — and after the migration every one of
them was silently dropped. They must not depend on somebody having filled a
template in HQ > Emails.
"""

from unittest.mock import patch

import pytest

from notifications.emails import send_transactional_email
from notifications.models import EmailSetting, EmailTemplate

pytestmark = pytest.mark.django_db


@pytest.fixture
def sent():
    """Captures the payload instead of hitting ZeptoMail."""
    with patch("notifications.emails.send_email") as mock:
        yield mock


def _payload(mock):
    assert mock.call_count == 1, "expected exactly one send"
    return mock.call_args.kwargs


def test_password_reset_sends_without_any_db_template(sent):
    ok = send_transactional_email(
        to_email="dancer@example.com", to_name="Maria",
        key="password_reset",
        context={"user_name": "Maria", "reset_url": "https://app.test/reset?uid=1&token=abc"},
        locale="en",
    )

    assert ok is True
    payload = _payload(sent)
    assert payload["subject"].strip()
    assert "https://app.test/reset?uid=1&token=abc" in payload["html_body"]
    assert "Maria" in payload["html_body"]


def test_team_invite_sends_without_any_db_template(sent):
    ok = send_transactional_email(
        to_email="staff@example.com", to_name="Luca",
        key="team_invite",
        context={"user_name": "Luca", "setup_url": "https://app.test/setup-account?uid=2&token=xyz",
                 "platform_name": "No Under 40"},
        locale="en",
    )

    assert ok is True
    assert "https://app.test/setup-account?uid=2&token=xyz" in _payload(sent)["html_body"]


def test_no_unrendered_placeholders_remain(sent):
    send_transactional_email(
        to_email="dancer@example.com", to_name="Maria", key="password_reset",
        context={"user_name": "Maria", "reset_url": "https://app.test/r"}, locale="en",
    )

    payload = _payload(sent)
    assert "{{" not in payload["html_body"]
    assert "{{" not in payload["subject"]


def test_builtin_is_localised(sent):
    send_transactional_email(
        to_email="dancer@example.com", to_name="Maria", key="password_reset",
        context={"user_name": "Maria", "reset_url": "https://app.test/r"}, locale="it",
    )
    italian = _payload(sent)["subject"]

    sent.reset_mock()
    send_transactional_email(
        to_email="dancer@example.com", to_name="Maria", key="password_reset",
        context={"user_name": "Maria", "reset_url": "https://app.test/r"}, locale="en",
    )
    english = _payload(sent)["subject"]

    assert italian != english


def test_unknown_locale_falls_back_to_english(sent):
    send_transactional_email(
        to_email="dancer@example.com", to_name="Maria", key="password_reset",
        context={"user_name": "Maria", "reset_url": "https://app.test/r"}, locale="tr",
    )
    fallback = _payload(sent)["subject"]

    sent.reset_mock()
    send_transactional_email(
        to_email="dancer@example.com", to_name="Maria", key="password_reset",
        context={"user_name": "Maria", "reset_url": "https://app.test/r"}, locale="en",
    )
    assert fallback == _payload(sent)["subject"]


def test_db_template_wins_over_builtin(sent):
    EmailTemplate.objects.create(
        school=None, key="password_reset", locale="en",
        subject="Custom subject", body_html="<p>Custom {{reset_url}}</p>",
    )

    send_transactional_email(
        to_email="dancer@example.com", to_name="Maria", key="password_reset",
        context={"user_name": "Maria", "reset_url": "https://app.test/r"}, locale="en",
    )

    payload = _payload(sent)
    assert payload["subject"] == "Custom subject"
    assert "<p>Custom https://app.test/r</p>" in payload["html_body"]


def test_hq_switch_off_still_wins_over_builtin(sent):
    EmailSetting.objects.create(key="password_reset", value="off")

    ok = send_transactional_email(
        to_email="dancer@example.com", to_name="Maria", key="password_reset",
        context={"user_name": "Maria", "reset_url": "https://app.test/r"}, locale="en",
    )

    assert ok is False
    sent.assert_not_called()


def test_key_without_builtin_and_without_row_is_still_a_no_op(sent):
    ok = send_transactional_email(
        to_email="dancer@example.com", to_name="Maria", key="booking_confirmed",
        context={}, locale="en",
    )

    assert ok is False
    sent.assert_not_called()
