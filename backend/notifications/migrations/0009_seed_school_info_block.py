"""Re-seed booking-confirmed + the two lesson reminders (in person / online,
five languages) with the {{school_info_block}} placeholder — the "Importante —
Informazioni dalla scuola" block that renders only when the course/lesson has
email info filled in. Only these thirty HQ-global rows are touched."""
from django.db import migrations

KEYS = (
    "student.booking_confirmed", "student.booking_confirmed.online",
    "student.lesson_reminder_1day", "student.lesson_reminder_1day.online",
    "student.lesson_reminder_2hour", "student.lesson_reminder_2hour.online",
)


def seed(apps, schema_editor):
    from notifications.brand_templates import TEMPLATES, body_html

    EmailTemplate = apps.get_model("notifications", "EmailTemplate")
    for key in KEYS:
        for locale, (subject, text) in TEMPLATES[key].items():
            EmailTemplate.objects.update_or_create(
                school=None, key=key, locale=locale, defaults={"subject": subject, "body_html": body_html(text)},
            )


class Migration(migrations.Migration):
    dependencies = [("notifications", "0008_seed_account_deleted")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
