"""Scopa periodica delle sessioni di Checkout pagate e non riscattate (R3-H5).

Il giro 3 di QA ha misurato 0 evasioni su 10 dal webhook: ogni pagamento e'
stato salvato dalla chiamata `verify-session` della pagina di rientro. Con il
rientro bloccato i soldi restavano presi e il pacchetto non attivato. Questa
gira ogni ora, sfalsata rispetto alla scopa degli ordini Negozio (minuto 20)
per non far partire due giri Stripe nello stesso istante.
"""
from django.db import migrations

TASK_NAME = "Reconcile paid Stripe checkout sessions"


def seed(apps, schema_editor):
    CrontabSchedule = apps.get_model("django_celery_beat", "CrontabSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    hourly, _ = CrontabSchedule.objects.get_or_create(
        minute="50", hour="*", day_of_week="*", day_of_month="*", month_of_year="*"
    )
    PeriodicTask.objects.get_or_create(
        name=TASK_NAME,
        defaults=dict(task="commerce.tasks.reconcile_stripe_checkout_sessions_task", crontab=hourly),
    )


def unseed(apps, schema_editor):
    apps.get_model("django_celery_beat", "PeriodicTask").objects.filter(name=TASK_NAME).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("commerce", "0008_seed_shop_order_sweep_task"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
    ]
    operations = [migrations.RunPython(seed, unseed)]
