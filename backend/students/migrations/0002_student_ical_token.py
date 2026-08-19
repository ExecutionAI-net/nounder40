import uuid

from django.db import migrations, models


def backfill_unique_tokens(apps, schema_editor):
    Student = apps.get_model("students", "Student")
    for student in Student.objects.all():
        Student.objects.filter(pk=student.pk).update(ical_token=uuid.uuid4())


class Migration(migrations.Migration):

    dependencies = [
        ('students', '0001_initial'),
    ]

    operations = [
        # Add nullable/non-unique first so the ALTER TABLE can't slam the same
        # default value into every existing row (which would violate uniqueness
        # the moment there's more than one row).
        migrations.AddField(
            model_name='student',
            name='ical_token',
            field=models.UUIDField(null=True, editable=False),
        ),
        migrations.RunPython(backfill_unique_tokens, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='student',
            name='ical_token',
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
    ]
