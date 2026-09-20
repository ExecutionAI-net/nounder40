"""Special events (SPECIAL_EVENTS.md): the HQ matrix gets an "events" key —
the approval queue at /hq/events. Seeded onto the roles that already run the
network's day-to-day content (owner, super_admin, operations); every other
role, custom ones included, gets it from HQ > Permissions."""
from django.db import migrations

ROLES_WITH_EVENTS = ("owner", "super_admin", "operations")


def add_events(apps, schema_editor):
    HQRole = apps.get_model("accounts", "HQRole")
    for role in HQRole.objects.filter(key__in=ROLES_WITH_EVENTS):
        if "events" not in role.permissions:
            role.permissions = [*role.permissions, "events"]
            role.save(update_fields=["permissions"])


def remove_events(apps, schema_editor):
    HQRole = apps.get_model("accounts", "HQRole")
    for role in HQRole.objects.all():
        if "events" in role.permissions:
            role.permissions = [p for p in role.permissions if p != "events"]
            role.save(update_fields=["permissions"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0010_reconcile_language_preference")]
    operations = [migrations.RunPython(add_events, remove_events)]
