"""Shop referrers registry (Carlo, 30/10/2026).

The names typed so far on manual sales become registry rows, one per distinct
name, with the whole text in first_name: HQ corrects them in the Referrers
tab (the registry is editable). Each sale is linked to its row; the text
column stays as the name at sale time.
"""
import uuid

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models



def link_existing_referrers(apps, schema_editor):
    ShopSale = apps.get_model("commerce", "ShopSale")
    ShopReferrer = apps.get_model("commerce", "ShopReferrer")
    names = (
        ShopSale.objects.exclude(referrer="").values_list("referrer", flat=True).distinct()
    )
    for raw in names:
        name = (raw or "").strip()
        if not name:
            continue
        row = ShopReferrer.objects.filter(first_name=name, last_name="").first()
        if row is None:
            row = ShopReferrer.objects.create(first_name=name[:120], last_name="")
        ShopSale.objects.filter(referrer=raw, referrer_contact__isnull=True).update(referrer_contact=row)


class Migration(migrations.Migration):

    dependencies = [
        ("commerce", "0009_seed_checkout_reconciliation_task"),
    ]

    operations = [
        migrations.CreateModel(
            name="ShopReferrer",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("first_name", models.CharField(max_length=120)),
                ("last_name", models.CharField(blank=True, max_length=120)),
                ("phone", models.CharField(blank=True, max_length=40)),
                ("email", models.EmailField(blank=True, max_length=254)),
                ("active", models.BooleanField(default=True)),
            ],
            options={"db_table": "shop_referrers", "ordering": ["last_name", "first_name"]},
        ),
        migrations.AddField(
            model_name="shopsale",
            name="referrer_contact",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="sales", to="commerce.shopreferrer",
            ),
        ),
        migrations.RunPython(link_existing_referrers, migrations.RunPython.noop),
    ]
