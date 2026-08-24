from django.db import migrations

TASK_NAME = "We-miss-you emails"


def seed(apps, schema_editor):
    CrontabSchedule = apps.get_model("django_celery_beat", "CrontabSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")

    daily_10am, _ = CrontabSchedule.objects.get_or_create(
        minute="0", hour="10", day_of_week="*", day_of_month="*", month_of_year="*"
    )
    PeriodicTask.objects.get_or_create(
        name=TASK_NAME,
        defaults=dict(task="notifications.tasks.absent_student_winback_task", crontab=daily_10am),
    )


def unseed(apps, schema_editor):
    apps.get_model("django_celery_beat", "PeriodicTask").objects.filter(name=TASK_NAME).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("notifications", "0003_seed_periodic_tasks"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
    ]
    operations = [migrations.RunPython(seed, unseed)]
