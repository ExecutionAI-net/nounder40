"""Put the team_invite template back in HQ > Emails, five languages, from the
brand copy — wherever the HQ-global row is missing or blank. Deleting a key
from the HQ page drops all its locales at once, and the card then looks like
the template never existed (the built-in fallback kept the email going, but
HQ could not see or edit the text). Rows HQ has filled in are left alone."""
from django.db import migrations


def seed(apps, schema_editor):
    from notifications.brand_templates import TEMPLATES, body_html

    EmailTemplate = apps.get_model("notifications", "EmailTemplate")
    for locale, (subject, text) in TEMPLATES["team_invite"].items():
        row, _ = EmailTemplate.objects.get_or_create(school=None, key="team_invite", locale=locale)
        if not row.subject.strip() or not row.body_html.strip():
            row.subject, row.body_html = subject, body_html(text)
            row.save(update_fields=["subject", "body_html"])


class Migration(migrations.Migration):
    dependencies = [("notifications", "0011_first_name_greetings")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
