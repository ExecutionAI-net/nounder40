"""Re-seed password_reset + team_invite (five languages) with the new
{{user_first_name}} greeting — "Ciao Maria" instead of "Ciao Maria Rossi".
Also guarantees the English password_reset body is back after the editor
incident 0010 already fixed. Only these ten HQ-global rows are touched."""
from django.db import migrations

KEYS = ("password_reset", "team_invite")


def seed(apps, schema_editor):
    from notifications.brand_templates import TEMPLATES, body_html

    EmailTemplate = apps.get_model("notifications", "EmailTemplate")
    for key in KEYS:
        for locale, (subject, text) in TEMPLATES[key].items():
            EmailTemplate.objects.update_or_create(
                school=None, key=key, locale=locale, defaults={"subject": subject, "body_html": body_html(text)},
            )


class Migration(migrations.Migration):
    dependencies = [("notifications", "0010_restore_password_reset_en")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
