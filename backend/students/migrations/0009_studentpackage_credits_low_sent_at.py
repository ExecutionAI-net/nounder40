from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("students", "0008_alter_studentdocument_status")]

    operations = [
        migrations.AddField(
            model_name="studentpackage",
            name="credits_low_sent_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
