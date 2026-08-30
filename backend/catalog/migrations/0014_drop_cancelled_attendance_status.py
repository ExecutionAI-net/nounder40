"""An attendance status named "cancelled" made no sense: cancelling is an
action of the school on the whole lesson (refund for everyone), not a mark
the teacher gives one student. Attendance rows keep their mark with
status_ref=NULL (SET_NULL)."""
from django.db import migrations

NAMES = ("annullata", "annullato", "cancelled", "canceled", "cancelada", "cancelado", "annulée", "annulé", "abgesagt", "storniert")


def drop(apps, schema_editor):
    AttendanceStatus = apps.get_model("catalog", "AttendanceStatus")
    for status in AttendanceStatus.objects.all():
        if status.name.strip().lower() in NAMES:
            status.delete()


class Migration(migrations.Migration):
    dependencies = [("catalog", "0013_alter_package_options_package_sort_order"), ("bookings", "0004_alter_booking_credits_deducted")]
    operations = [migrations.RunPython(drop, migrations.RunPython.noop)]
