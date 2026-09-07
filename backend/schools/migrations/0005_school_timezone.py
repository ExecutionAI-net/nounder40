from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('schools', '0004_schoolrole'),
    ]

    operations = [
        migrations.AddField(
            model_name='school',
            name='timezone',
            field=models.CharField(default='Europe/Rome', max_length=60),
        ),
    ]
