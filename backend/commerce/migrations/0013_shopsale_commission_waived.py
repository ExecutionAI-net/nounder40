"""ShopSale.commission_waived: HQ took the school's commission off a manual
sale line (Carlo, 2026-11-01)."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("commerce", "0012_shopsale_sold_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="shopsale",
            name="commission_waived",
            field=models.BooleanField(default=False),
        ),
    ]
