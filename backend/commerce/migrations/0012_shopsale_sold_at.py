"""ShopSale.sold_at: the day of the sale as HQ states it (Carlo, 2026-11-01).
Existing rows take the day their row was written, which is what the register
showed until now (one set-based UPDATE; TIME_ZONE is UTC, so TruncDate is the
same day timezone.localdate(created_at) gives)."""
from django.db import migrations, models
from django.db.models.functions import TruncDate
from django.utils import timezone


def copy_created_day(apps, schema_editor):
    ShopSale = apps.get_model("commerce", "ShopSale")
    ShopSale.objects.update(sold_at=TruncDate("created_at"))


class Migration(migrations.Migration):

    dependencies = [
        ("commerce", "0011_shopproduct_online"),
    ]

    operations = [
        migrations.AddField(
            model_name="shopsale",
            name="sold_at",
            field=models.DateField(db_index=True, default=timezone.localdate),
        ),
        migrations.RunPython(copy_created_day, migrations.RunPython.noop),
    ]
