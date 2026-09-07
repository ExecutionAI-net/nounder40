"""R2-M20 / R2-M14b — copia email corretta e nuovi template.

- `team_invite`: nomina la scuola/organizzazione e il ruolo ({{invite_org}},
  {{invite_role}}); prima parlava sempre e solo del "team di Danza Classica
  No Under 40", per HQ, titolari, staff e insegnanti (R2-M20a).
- `student.no_show`: diceva "oggi" a prescindere dalla data della lezione
  ("Du hast uns heute gefehlt" per una lezione a 16 giorni) — ora rende la
  data vera (R2-M20b).
- `student.account_deleted_by_school`: nuovo, per quando e' la scuola a
  eliminare l'account (R2-M20c).
- `student.shop_order_confirmed`: nuovo, la conferma d'ordine del Negozio che
  la pagina di rientro prometteva e che non esisteva (R2-M14b).

Solo le righe HQ-globali (school=None): un'eventuale versione riscritta da una
scuola resta la sua.
"""
from django.db import migrations

RESEEDED = ("team_invite", "student.no_show")
NEW = ("student.account_deleted_by_school", "student.shop_order_confirmed")


def seed(apps, schema_editor):
    from notifications.brand_templates import TEMPLATES, body_html

    EmailTemplate = apps.get_model("notifications", "EmailTemplate")
    for key in RESEEDED + NEW:
        for locale, (subject, text) in TEMPLATES[key].items():
            EmailTemplate.objects.update_or_create(
                school=None, key=key, locale=locale,
                defaults={"subject": subject, "body_html": body_html(text)},
            )


def unseed(apps, schema_editor):
    EmailTemplate = apps.get_model("notifications", "EmailTemplate")
    EmailTemplate.objects.filter(school__isnull=True, key__in=NEW).delete()


class Migration(migrations.Migration):
    dependencies = [("notifications", "0012_restore_team_invite")]
    operations = [migrations.RunPython(seed, unseed)]
