"""ShopProduct.online: shown in the students' storefront (Carlo, 30/10/2026).
Off = sold in person only. Existing products stay online."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("commerce", "0010_shop_referrer"),
    ]

    operations = [
        migrations.AddField(
            model_name="shopproduct",
            name="online",
            field=models.BooleanField(default=True),
        ),
    ]
