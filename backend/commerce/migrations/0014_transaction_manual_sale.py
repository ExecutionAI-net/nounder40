"""Transaction.discount + Transaction.manual_grant: a sale the school typed by
hand in "Assign package" (reason "sale") is a payment too (Carlo, 2026-11-01).
Existing rows: discount 0, no grant."""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("commerce", "0013_shopsale_commission_waived"),
        ("students", "__latest__"),
    ]

    operations = [
        migrations.AddField(
            model_name="transaction",
            name="discount",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
        migrations.AddField(
            model_name="transaction",
            name="manual_grant",
            field=models.OneToOneField(
                blank=True, null=True, on_delete=django.db.models.deletion.CASCADE,
                related_name="transaction", to="students.manualcreditgrant",
            ),
        ),
    ]
