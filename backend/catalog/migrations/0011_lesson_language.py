from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0010_fix_barcelona_package_name_it"),
    ]

    operations = [
        migrations.AddField(
            model_name="lesson",
            name="language",
            field=models.CharField(blank=True, default="", max_length=8),
        ),
    ]
