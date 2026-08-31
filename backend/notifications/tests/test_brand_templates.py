"""The brand copy covers every HQ card in all five languages and uses only
placeholders the code fills for that template."""
import re

import pytest

from notifications.brand_templates import TEMPLATES, body_html
from notifications.emails import render, to_html_body

LOCALES = {"en", "it", "es", "fr", "de"}
# mirror of TEMPLATE_VARS in frontend hq/emails/page.tsx (+ platform_name)
LESSON = {"student_name", "student_first_name", "school_name", "lesson_name", "lesson_date", "lesson_time", "lesson_duration",
          "teacher_name", "teacher_first_name", "location_name", "location_address", "room_name", "online_link", "booking_url", "school_calendar_url", "cancellation_hours"}
PACKAGE = {"student_name", "student_first_name", "school_name", "package_name", "package_expiry", "lessons_remaining", "lessons_total",
           "credits_remaining", "credits_total", "booking_url", "school_calendar_url"}
ALLOWED = {
    "password_reset": {"user_name", "reset_url"}, "team_invite": {"user_name", "setup_url"},
    "student.welcome": {"student_name", "student_first_name", "user_name", "profile_url", "booking_url"},
    "student.no_show": LESSON, "student.credits_low": LESSON | PACKAGE | {"credits_threshold"},
    "student.after_purchase": PACKAGE | {"amount"}, "student.package_expiring": PACKAGE | {"days"},
    "student.we_miss_you_1m": {"student_name", "student_first_name", "school_name", "days_absent", "last_lesson_date", "booking_url", "school_calendar_url"},
    "student.we_miss_you_3m": {"student_name", "student_first_name", "school_name", "days_absent", "last_lesson_date", "booking_url", "school_calendar_url"},
    "student.account_deleted": {"student_name", "student_first_name", "register_url"},
    "student.document_expiring_30": {"student_name", "student_first_name", "school_name", "document_type", "days", "profile_url"},
    "student.document_expiring_7": {"student_name", "student_first_name", "school_name", "document_type", "days", "profile_url"},
    "school.new_booking": LESSON | {"student_email", "dashboard_url"}, "school.booking_cancelled": LESSON | {"student_email", "dashboard_url"},
    "school.stripe_connected": {"school_name", "school_city", "school_email", "dashboard_url"},
    "hq.new_school_registered": {"school_name", "school_city", "school_email", "school_url"},
    "hq.weekly_kpi_report": {"active_schools", "total_students", "lessons_this_week"},
}
# Course/lesson "email info" reaches only confirmation + the two reminders
SCHOOL_INFO = {"school_info", "school_info_block"}
for k in ("booking_confirmed", "booking_cancelled", "lesson_cancelled_by_school", "lesson_reminder_1day", "lesson_reminder_2hour"):
    extra = SCHOOL_INFO if k in ("booking_confirmed", "lesson_reminder_1day", "lesson_reminder_2hour") else set()
    ALLOWED[f"student.{k}"] = LESSON | extra
    ALLOWED[f"student.{k}.online"] = LESSON | extra


def test_every_card_has_all_five_languages():
    assert set(TEMPLATES) == set(ALLOWED)
    for key, per_locale in TEMPLATES.items():
        assert set(per_locale) == LOCALES, key


@pytest.mark.parametrize("key", sorted(ALLOWED))
def test_only_placeholders_the_code_fills(key):
    for locale, (subject, text) in TEMPLATES[key].items():
        used = set(re.findall(r"\{\{(\w+)\}\}", subject + text))
        assert used <= ALLOWED[key] | {"platform_name"}, (key, locale, used - ALLOWED[key])


@pytest.mark.django_db  # to_html_body legge il frame configurabile (EmailSetting)
def test_body_renders_buttons_and_paragraphs():
    html = body_html("Ciao {{student_first_name}} 🌸\n\nriga uno\nriga due\n\n[✨ Vai|{{profile_url}}]")
    assert html.startswith("<p>Ciao {{student_first_name}} 🌸</p><p>riga uno<br>riga due</p>")
    assert 'data-email-button="1"' in html and 'href="{{profile_url}}"' in html
    rendered = to_html_body(render(html, {"student_first_name": "Maria", "profile_url": "https://x/p"}))
    assert 'href="https://x/p"' in rendered and "Ciao Maria" in rendered and "<html" in rendered
