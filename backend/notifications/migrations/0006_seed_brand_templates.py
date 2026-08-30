"""Seed every HQ-global email template with the brand copy in five languages
(notifications/brand_templates.py). Overwrites the previous seeds — plain
one-liners in three languages — so the whole set speaks with one voice; HQ
edits from here on stay (this runs once). School-level overrides untouched."""
from django.db import migrations


def seed(apps, schema_editor):
    from notifications.brand_templates import TEMPLATES, body_html

    EmailTemplate = apps.get_model("notifications", "EmailTemplate")
    for key, per_locale in TEMPLATES.items():
        for locale, (subject, text) in per_locale.items():
            EmailTemplate.objects.update_or_create(
                school=None, key=key, locale=locale,
                defaults={"subject": subject, "body_html": body_html(text)},
            )


class Migration(migrations.Migration):
    dependencies = [("notifications", "0005_seed_package_expiry_task")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
