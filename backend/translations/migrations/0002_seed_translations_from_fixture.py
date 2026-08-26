# Allinea la tabella translations (superficie di modifica di HQ → Traduzioni)
# allo stato già raggiunto in locale: chiavi scansionate dal codice + valori
# riversati dai messages/*.json. Il runtime usa i JSON bundlati, quindi qui
# si riempie solo la vista di editing. Idempotente e conservativa: crea le
# righe mancanti e riempie SOLO i valori vuoti — mai sovrascrivere modifiche
# fatte da HQ.
import json
from pathlib import Path

from django.db import migrations

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "translations_seed.json"


def seed(apps, schema_editor):
    Translation = apps.get_model("translations", "Translation")
    if not FIXTURE.exists():
        return
    rows = json.loads(FIXTURE.read_text())
    existing = {
        (t.key, t.locale): t
        for t in Translation.objects.all().only("id", "key", "locale", "value")
    }
    to_create, filled = [], 0
    for key, locale, value in rows:
        current = existing.get((key, locale))
        if current is None:
            to_create.append(Translation(key=key, locale=locale, value=value))
        elif not (current.value or "").strip():
            current.value = value
            current.save(update_fields=["value"])
            filled += 1
    if to_create:
        Translation.objects.bulk_create(to_create, batch_size=500)
    if to_create or filled:
        print(f"  translations seed: {len(to_create)} created, {filled} filled")


class Migration(migrations.Migration):

    dependencies = [
        ("translations", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
