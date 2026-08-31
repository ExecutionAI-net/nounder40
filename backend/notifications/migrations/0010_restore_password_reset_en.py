"""Restore the English password_reset template from the brand copy: its body
was accidentally replaced from the HQ editor ("insert base structure", which
used to swap the text without asking for confirmation). Only this one
HQ-global row is touched."""
from django.db import migrations


def seed(apps, schema_editor):
    from notifications.brand_templates import TEMPLATES, body_html

    EmailTemplate = apps.get_model("notifications", "EmailTemplate")
    subject, text = TEMPLATES["password_reset"]["en"]
    EmailTemplate.objects.update_or_create(
        school=None, key="password_reset", locale="en",
        defaults={"subject": subject, "body_html": body_html(text)},
    )


class Migration(migrations.Migration):
    dependencies = [("notifications", "0009_seed_school_info_block")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
