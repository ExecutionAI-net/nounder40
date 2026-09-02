# Backfill nome/cognome dai nomi esistenti (primo token = nome, resto =
# cognome), fatto finora solo in locale via shell: qui diventa migrazione
# così la produzione si allinea da sola. Idempotente: tocca solo i record
# con first/last vuoti.
from django.db import migrations


def split_fill(apps, schema_editor):
    def fill(model, name_attr):
        fixed = 0
        for obj in model.objects.filter(first_name="", last_name=""):
            full = (getattr(obj, name_attr) or "").strip()
            if not full:
                continue
            head, _, rest = full.partition(" ")
            obj.first_name, obj.last_name = head, rest
            obj.save(update_fields=["first_name", "last_name"])
            fixed += 1
        return fixed

    users = fill(apps.get_model("accounts", "User"), "full_name")
    teachers = fill(apps.get_model("teachers", "Teacher"), "name")
    students = fill(apps.get_model("students", "Student"), "name")
    if users or teachers or students:
        print(f"  split names: {users} users, {teachers} teachers, {students} students")


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0007_fix_bcrypt_missing_separator"),
        ("teachers", "0003_teacher_first_name_teacher_last_name"),
        ("students", "0005_student_first_name_student_last_name"),
    ]

    operations = [
        migrations.RunPython(split_fill, migrations.RunPython.noop),
    ]
