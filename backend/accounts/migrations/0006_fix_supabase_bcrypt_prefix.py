# Ripara le password importate dall'ETL PRIMA del fix di codifica: Supabase
# (GoTrue) salva bcrypt puro ("$2a$/$2b$/$2y$..."), Django lo accetta solo
# col prefisso "bcrypt$". Idempotente: tocca solo gli hash non prefissati.
# Sostituisce il fix SQL manuale che era in attesa per la produzione.
from django.db import migrations


def add_bcrypt_prefix(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    fixed = 0
    for user in User.objects.filter(password__startswith="$2").only("id", "password"):
        user.password = "bcrypt$" + user.password
        user.save(update_fields=["password"])
        fixed += 1
    if fixed:
        print(f"  bcrypt prefix fixed on {fixed} users")


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0005_user_first_name_user_last_name"),
    ]

    operations = [
        migrations.RunPython(add_bcrypt_prefix, migrations.RunPython.noop),
    ]
