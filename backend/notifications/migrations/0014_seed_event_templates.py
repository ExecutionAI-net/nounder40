"""Special events (SPECIAL_EVENTS.md): the five new HQ > Emails cards —
"event to approve" for HQ, approved / rejected / suspended for the school,
"event updated" for the booked students. HQ-global rows only (school=None);
a school's own rewrite is never touched."""
from django.db import migrations

NEW = (
    "student.event_updated",
    "school.event_approved",
    "school.event_rejected",
    "school.event_suspended",
    "hq.event_submitted",
)


def seed(apps, schema_editor):
    from notifications.brand_templates import TEMPLATES, body_html

    EmailTemplate = apps.get_model("notifications", "EmailTemplate")
    for key in NEW:
        for locale, (subject, text) in TEMPLATES[key].items():
            EmailTemplate.objects.update_or_create(
                school=None, key=key, locale=locale,
                defaults={"subject": subject, "body_html": body_html(text)},
            )


def unseed(apps, schema_editor):
    EmailTemplate = apps.get_model("notifications", "EmailTemplate")
    EmailTemplate.objects.filter(school__isnull=True, key__in=NEW).delete()


class Migration(migrations.Migration):
    dependencies = [("notifications", "0013_qa_r2_m20_m14_templates")]
    operations = [migrations.RunPython(seed, unseed)]
