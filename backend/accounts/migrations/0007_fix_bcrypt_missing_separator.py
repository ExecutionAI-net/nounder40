# Il vecchio ETL salvava "bcrypt$2a$..." SENZA il separatore di algoritmo
# (formato Django: "bcrypt$$2a$..."), quindi check_password falliva con
# "No active account found". Stessa correzione documentata in 2e2e95b:
#   UPDATE accounts_user SET password = 'bcrypt$' || substr(password, 7)
#   WHERE password LIKE 'bcrypt$2%' AND password NOT LIKE 'bcrypt$$%';
# Idempotente: gli hash già corretti (bcrypt$$...) non matchano il filtro.
from django.db import migrations


def add_missing_separator(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    fixed = 0
    qs = User.objects.filter(password__startswith="bcrypt$2").exclude(password__startswith="bcrypt$$")
    for user in qs.only("id", "password"):
        # "bcrypt$2a$..."[6:] == "$2a$..." → "bcrypt$" + "$2a$..." == "bcrypt$$2a$..."
        user.password = "bcrypt$" + user.password[6:]
        user.save(update_fields=["password"])
        fixed += 1
    if fixed:
        print(f"  bcrypt separator fixed on {fixed} users")


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0006_fix_supabase_bcrypt_prefix"),
    ]

    operations = [
        migrations.RunPython(add_missing_separator, migrations.RunPython.noop),
    ]
