"""Re-seed the two booking-confirmed templates (in person / online, five
languages) with the cancellation-policy sentence ({{cancellation_hours}}).
Only those ten HQ-global rows are touched."""
from django.db import migrations

KEYS = ("student.booking_confirmed", "student.booking_confirmed.online")


def seed(apps, schema_editor):
    from notifications.brand_templates import TEMPLATES, body_html

    EmailTemplate = apps.get_model("notifications", "EmailTemplate")
    for key in KEYS:
        for locale, (subject, text) in TEMPLATES[key].items():
            EmailTemplate.objects.update_or_create(
                school=None, key=key, locale=locale, defaults={"subject": subject, "body_html": body_html(text)},
            )


class Migration(migrations.Migration):
    dependencies = [("notifications", "0006_seed_brand_templates")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
