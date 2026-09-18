from django.db import migrations


def exhaust_drained_packages(apps, schema_editor):
    """Data repair for the staff-enrol bug fixed alongside this migration.

    `bookings.services.staff_enrol()` (the school's or the teacher's "add a
    student" on a lesson) drained the package's credits but never set
    `exhausted`, so a package used up from the register stayed `active` at
    0 credits: the school's Reports and usage modal counted it as active
    while the student's own page already treated it as used up. Any such
    row is made `exhausted`. Unlimited packages carry no credits and are
    left alone.
    """
    StudentPackage = apps.get_model("students", "StudentPackage")
    StudentPackage.objects.filter(status="active", credits_remaining__lte=0).exclude(
        package__is_unlimited=True
    ).update(status="exhausted")


class Migration(migrations.Migration):
    dependencies = [
        ("students", "0010_reactivate_refunded_packages"),
        # `package__is_unlimited` must exist in the historical model
        ("catalog", "0005_package_allowed_lesson_types_package_is_unlimited_and_more"),
    ]

    operations = [
        migrations.RunPython(exhaust_drained_packages, migrations.RunPython.noop),
    ]
