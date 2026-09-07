"""Scopa periodica degli ordini Negozio rimasti `pending` (R2-M14c).

Rete di sicurezza per quando il webhook di scadenza non arriva affatto: senza,
un ordine abbandonato resta "In attesa" per sempre in "I miei acquisti".
"""
from django.db import migrations

TASK_NAME = "Expire stale shop orders"


def seed(apps, schema_editor):
    CrontabSchedule = apps.get_model("django_celery_beat", "CrontabSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    hourly, _ = CrontabSchedule.objects.get_or_create(
        minute="20", hour="*", day_of_week="*", day_of_month="*", month_of_year="*"
    )
    PeriodicTask.objects.get_or_create(
        name=TASK_NAME,
        defaults=dict(task="commerce.tasks.expire_stale_shop_orders_task", crontab=hourly),
    )


def unseed(apps, schema_editor):
    apps.get_model("django_celery_beat", "PeriodicTask").objects.filter(name=TASK_NAME).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("commerce", "0007_shop_order_status_terminal"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
    ]
    operations = [migrations.RunPython(seed, unseed)]
