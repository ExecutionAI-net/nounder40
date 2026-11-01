"""ShopSale.sold_at: the day of the sale as HQ states it (Carlo, 2026-11-01).
Existing rows take the day their row was written, which is what the register
showed until now."""
from django.db import migrations, models
from django.utils import timezone


def copy_created_day(apps, schema_editor):
    ShopSale = apps.get_model("commerce", "ShopSale")
    for sale in ShopSale.objects.all().only("id", "created_at").iterator():
        ShopSale.objects.filter(pk=sale.pk).update(sold_at=timezone.localdate(sale.created_at))


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
