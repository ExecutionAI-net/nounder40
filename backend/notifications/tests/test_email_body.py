"""What HQ > Emails stores vs. what the mail client receives.

The seeded templates are plain text with newlines; sent raw, Gmail collapsed
every one of them onto a single line and with none of the branding the HQ
"Anteprima" tab promises.
"""

from unittest.mock import patch

import pytest

from notifications.emails import send_transactional_email, to_html_body
from notifications.models import EmailTemplate

pytestmark = pytest.mark.django_db


@pytest.fixture
def sent():
    with patch("notifications.emails.send_email") as mock:
        yield mock


def _body(mock):
    assert mock.call_count == 1
    return mock.call_args.kwargs["html_body"]


def test_plain_text_body_keeps_its_lines_and_gets_the_branded_card(sent):
    EmailTemplate.objects.create(
        key="student.booking_confirmed", locale="en", subject="Confirmed",
        body_html="Hi {{student_name}},\n\nyour booking with {{school_name}} is confirmed ✅",
    )
    send_transactional_email(
        to_email="a@example.com", to_name="A", key="booking_confirmed",
        context={"student_name": "Maria", "school_name": "Rock & Roll"},
    )
    body = _body(sent)
    assert "Hi Maria,<br><br>your booking with Rock &amp; Roll is confirmed ✅" in body
    assert "No Under 40" in body and "<html" in body


def test_editor_html_fragment_is_wrapped_once(sent):
    EmailTemplate.objects.create(
        key="student.booking_confirmed", locale="en", subject="Confirmed",
        body_html='<p class="mb-1.5">Hi {{student_name}},</p><p><br></p><p>see you</p>',
    )
    send_transactional_email(
        to_email="a@example.com", to_name="A", key="booking_confirmed", context={"student_name": "Maria"},
    )
    body = _body(sent)
    assert '<p class="mb-1.5">Hi Maria,</p><p><br></p><p>see you</p>' in body
    assert body.count("<html") == 1


def test_full_document_is_left_alone():
    doc = "<!DOCTYPE html><html><body><p>built-in</p></body></html>"
    assert to_html_body(doc) == doc


def test_builtin_fallback_is_not_double_wrapped(sent):
    send_transactional_email(
        to_email="a@example.com", to_name="A", key="password_reset",
        context={"user_name": "Maria", "reset_url": "https://x/r"},
    )
    assert _body(sent).count("<html") == 1


def test_online_key_falls_back_to_in_person_template(sent):
    EmailTemplate.objects.create(
        key="student.booking_confirmed", locale="en", subject="In person", body_html="in person body",
    )
    ok = send_transactional_email(
        to_email="a@example.com", to_name="A", key="student.booking_confirmed.online", context={},
    )
    assert ok and "in person body" in _body(sent)


def test_online_template_wins_when_written(sent):
    EmailTemplate.objects.create(key="student.booking_confirmed", locale="en", subject="In person", body_html="in person")
    EmailTemplate.objects.create(key="student.booking_confirmed.online", locale="en", subject="Online", body_html="online body")
    send_transactional_email(
        to_email="a@example.com", to_name="A", key="student.booking_confirmed.online", context={},
    )
    assert "online body" in _body(sent)
