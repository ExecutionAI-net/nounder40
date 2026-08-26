# Personas di test per ruolo (create finora solo in locale via shell):
# così anche l'ambiente deployato le ha e Carlo può testare lì.
# - Insegnante "Alessia Insegnante Test" e allieva "Francesca Allieva Test"
#   sull'account multi-ruolo c.carlo@cfcholding.it, entrambe su Barcelona
# - Alias c.carlo+school/+staff rinominati Marta Admin Test / Sara Staff Test
# Tutto con guardie: se account o scuola non esistono, non fa nulla.
from django.db import migrations

BASE_EMAIL = "c.carlo@cfcholding.it"
SCHOOL_NAME = "Barcelona"  # match parziale sul nome scuola


def seed(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    Teacher = apps.get_model("teachers", "Teacher")
    TeacherSchool = apps.get_model("teachers", "TeacherSchool")
    Student = apps.get_model("students", "Student")
    School = apps.get_model("schools", "School")
    SchoolStudent = apps.get_model("schools", "SchoolStudent")

    user = User.objects.filter(email__iexact=BASE_EMAIL).first()
    school = School.objects.filter(name__icontains=SCHOOL_NAME).first()
    if user is None or school is None:
        return

    teacher, _ = Teacher.objects.get_or_create(
        user=user,
        defaults=dict(name="Alessia Insegnante Test", first_name="Alessia",
                      last_name="Insegnante Test", email=user.email, active=True),
    )
    if "Alessia" not in teacher.name:
        teacher.first_name, teacher.last_name = "Alessia", "Insegnante Test"
        teacher.name = "Alessia Insegnante Test"
        teacher.save(update_fields=["first_name", "last_name", "name"])
    TeacherSchool.objects.get_or_create(teacher=teacher, school=school, defaults=dict(active=True))

    student, created = Student.objects.get_or_create(
        user=user,
        defaults=dict(name="Francesca Allieva Test", first_name="Francesca",
                      last_name="Allieva Test", email=user.email, school=school,
                      language_preference="it"),
    )
    if not created and "Francesca" not in student.name:
        student.first_name, student.last_name = "Francesca", "Allieva Test"
        student.name = "Francesca Allieva Test"
        student.save(update_fields=["first_name", "last_name", "name"])
    SchoolStudent.objects.get_or_create(school=school, student=student)

    for email, first, last in [
        ("c.carlo+school@cfcholding.it", "Marta", "Admin Test"),
        ("c.carlo+staff@cfcholding.it", "Sara", "Staff Test"),
    ]:
        alias = User.objects.filter(email__iexact=email).first()
        if alias and "Test" not in (alias.full_name or ""):
            alias.first_name, alias.last_name = first, last
            alias.full_name = f"{first} {last}"
            alias.save(update_fields=["first_name", "last_name", "full_name"])


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0008_backfill_split_names"),
        ("schools", "0004_schoolrole"),
        ("teachers", "0003_teacher_first_name_teacher_last_name"),
        ("students", "0005_student_first_name_student_last_name"),
    ]

    operations = [
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
