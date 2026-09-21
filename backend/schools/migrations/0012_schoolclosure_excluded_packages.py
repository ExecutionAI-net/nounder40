from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("schools", "0011_schoolclosure_extends_packages"),
    ]

    operations = [
        migrations.AddField(
            model_name="schoolclosure",
            name="excluded_packages",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
