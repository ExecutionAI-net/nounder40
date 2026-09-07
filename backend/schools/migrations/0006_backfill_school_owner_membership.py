"""QA SCH-R2-07 / R2-M4 — ripara le scuole senza titolare.

Il primo account creato da HQ (`resend-invite`) nasceva con
`SchoolMembership.sub_role = "admin"` e nessun endpoint ha mai assegnato
`owner`: nelle scuole esistenti la riga `School.owner` punta a un utente la
cui membership non e' `owner`. Conseguenze: `only_owner_assigns_owner`
blocca chiunque e un admin qualsiasi puo' declassare o cacciare il fondatore.

Qui promuoviamo a `owner` la membership dell'utente `School.owner`, ma solo
per le scuole che **non hanno gia'** una membership `owner`. Idempotente:
rieseguita non tocca nulla.
"""

from django.db import migrations


def promote_owner_memberships(apps, schema_editor):
    School = apps.get_model("schools", "School")
    SchoolMembership = apps.get_model("schools", "SchoolMembership")

    for school in School.objects.exclude(owner__isnull=True).only("id", "owner_id"):
        if SchoolMembership.objects.filter(school_id=school.id, sub_role="owner").exists():
            continue
        SchoolMembership.objects.filter(
            school_id=school.id, profile_id=school.owner_id
        ).exclude(sub_role="owner").update(sub_role="owner")

    # Il contrario: scuole con una (sola) membership `owner` ma `School.owner`
    # vuoto. Senza questo il campo resta NULL e la protezione del fondatore
    # (SchoolTeamView._is_owner_membership) non ha niente su cui appoggiarsi.
    for school in School.objects.filter(owner__isnull=True).only("id"):
        owner_profiles = list(
            SchoolMembership.objects.filter(school_id=school.id, sub_role="owner")
            .values_list("profile_id", flat=True)[:2]
        )
        if len(owner_profiles) == 1:
            School.objects.filter(pk=school.id).update(owner_id=owner_profiles[0])


def noop(apps, schema_editor):
    """Nessun rollback: non sappiamo quale fosse il sub_role precedente e
    riportarli tutti ad `admin` sarebbe una perdita di dati."""


class Migration(migrations.Migration):

    dependencies = [
        ("schools", "0005_school_timezone"),
    ]

    operations = [
        migrations.RunPython(promote_owner_memberships, noop),
    ]
