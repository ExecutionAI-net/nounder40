from django.db import migrations
from django.db.models import Q
from django.utils import timezone


def reactivate_refunded_packages(apps, schema_editor):
    """Data repair for the school-side refund bug fixed in PR #200.

    `refund_bookings()` put the credit back into a StudentPackage that a
    booking had left `exhausted`, but never flipped the status back, so the
    package -- with credits inside -- was invisible to the balance and to
    booking. Any such row still on the database is made `active` again;
    a package past its expiry is left alone (it is expired, not usable).
    """
    StudentPackage = apps.get_model("students", "StudentPackage")
    StudentPackage.objects.filter(status="exhausted", credits_remaining__gt=0).filter(
        Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now())
    ).update(status="active")


class Migration(migrations.Migration):
    dependencies = [
        ("students", "0009_studentpackage_credits_low_sent_at"),
    ]

    operations = [
        migrations.RunPython(reactivate_refunded_packages, migrations.RunPython.noop),
    ]
