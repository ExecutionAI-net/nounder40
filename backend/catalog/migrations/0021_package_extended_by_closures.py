from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0020_course_sort_order_backfill"),
    ]

    operations = [
        migrations.AddField(
            model_name="package",
            name="extended_by_closures",
            field=models.BooleanField(default=True),
        ),
    ]
