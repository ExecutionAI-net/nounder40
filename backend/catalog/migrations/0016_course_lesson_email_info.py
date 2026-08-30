from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("catalog", "0015_course_compensation_plan")]

    operations = [
        migrations.AddField(
            model_name="course",
            name="email_info",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="lesson",
            name="email_info",
            field=models.TextField(blank=True, default=""),
        ),
    ]
