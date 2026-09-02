from django.db import migrations

TASK_NAMES = [
    "Lesson reminder — 24h before",
    "Lesson reminder — 2h before",
    "Document expiry reminders",
    "Sync document statuses",
    "Weekly KPI report",
]


def seed(apps, schema_editor):
    IntervalSchedule = apps.get_model("django_celery_beat", "IntervalSchedule")
    CrontabSchedule = apps.get_model("django_celery_beat", "CrontabSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")

    hourly, _ = IntervalSchedule.objects.get_or_create(every=1, period="hours")
    daily_8am, _ = CrontabSchedule.objects.get_or_create(
        minute="0", hour="8", day_of_week="*", day_of_month="*", month_of_year="*"
    )
    daily_1am, _ = CrontabSchedule.objects.get_or_create(
        minute="0", hour="1", day_of_week="*", day_of_month="*", month_of_year="*"
    )
    monday_9am, _ = CrontabSchedule.objects.get_or_create(
        minute="0", hour="9", day_of_week="1", day_of_month="*", month_of_year="*"
    )

    PeriodicTask.objects.get_or_create(
        name="Lesson reminder — 24h before",
        defaults=dict(
            task="notifications.tasks.lesson_reminder_task", interval=hourly, kwargs='{"hours_before": 24}'
        ),
    )
    PeriodicTask.objects.get_or_create(
        name="Lesson reminder — 2h before",
        defaults=dict(
            task="notifications.tasks.lesson_reminder_task", interval=hourly, kwargs='{"hours_before": 2}'
        ),
    )
    PeriodicTask.objects.get_or_create(
        name="Document expiry reminders",
        defaults=dict(task="notifications.tasks.document_expiry_reminder_task", crontab=daily_8am),
    )
    PeriodicTask.objects.get_or_create(
        name="Sync document statuses",
        defaults=dict(task="notifications.tasks.sync_document_statuses_task", crontab=daily_1am),
    )
    PeriodicTask.objects.get_or_create(
        name="Weekly KPI report",
        defaults=dict(task="notifications.tasks.weekly_kpi_report_task", crontab=monday_9am),
    )


def unseed(apps, schema_editor):
    apps.get_model("django_celery_beat", "PeriodicTask").objects.filter(name__in=TASK_NAMES).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("notifications", "0002_initial"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
    ]
    operations = [migrations.RunPython(seed, unseed)]
