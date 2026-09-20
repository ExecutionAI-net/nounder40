"""Special events (SPECIAL_EVENTS.md): the school matrix gets an "events"
section (sidebar + /api/school/events/). Seeded onto the roles that hold
every section (owner, admin); staff and custom roles get it from HQ >
Permissions."""
from django.db import migrations

ROLES_WITH_EVENTS = ("owner", "admin")


def add_events(apps, schema_editor):
    SchoolRole = apps.get_model("schools", "SchoolRole")
    for role in SchoolRole.objects.filter(key__in=ROLES_WITH_EVENTS):
        if "events" not in role.permissions:
            role.permissions = [*role.permissions, "events"]
            role.save(update_fields=["permissions"])


def remove_events(apps, schema_editor):
    SchoolRole = apps.get_model("schools", "SchoolRole")
    for role in SchoolRole.objects.all():
        if "events" in role.permissions:
            role.permissions = [p for p in role.permissions if p != "events"]
            role.save(update_fields=["permissions"])


class Migration(migrations.Migration):
    dependencies = [("schools", "0009_school_nav_order")]
    operations = [migrations.RunPython(add_events, remove_events)]
