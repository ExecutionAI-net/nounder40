"""Seed the new "student.account_deleted" template (five languages)."""
from django.db import migrations


def seed(apps, schema_editor):
    from notifications.brand_templates import TEMPLATES, body_html

    EmailTemplate = apps.get_model("notifications", "EmailTemplate")
    for locale, (subject, text) in TEMPLATES["student.account_deleted"].items():
        EmailTemplate.objects.update_or_create(
            school=None, key="student.account_deleted", locale=locale,
            defaults={"subject": subject, "body_html": body_html(text)},
        )


class Migration(migrations.Migration):
    dependencies = [("notifications", "0007_booking_confirmed_policy_line")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
