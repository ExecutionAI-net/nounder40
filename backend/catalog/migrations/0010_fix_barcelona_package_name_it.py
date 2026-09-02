# Production data fix: the Barcelona "10 Clases" package was imported with an
# English string in name_it ("10 Classes"), so Italian students saw an
# untranslated card. Idempotent: only touches that exact bad value.
from django.db import migrations

PACKAGE_ID = "4778d859-dcbf-4c19-90cb-d75729269691"


def fix_name_it(apps, schema_editor):
    Package = apps.get_model("catalog", "Package")
    Package.objects.filter(id=PACKAGE_ID, name_it="10 Classes").update(name_it="10 Lezioni")


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0009_package_description_es_package_description_fr"),
    ]

    operations = [
        migrations.RunPython(fix_name_it, migrations.RunPython.noop),
    ]
