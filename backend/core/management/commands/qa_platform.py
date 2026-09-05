"""Fixture per una passata di QA manuale su tutti i ruoli della piattaforma.

Serve perché non esiste un modo self-service per ottenere un account per ogni
ruolo: HQ e scuola sono a invito, e i sub-ruoli (HQRole/SchoolRole) sono
configurabili da HQ — quindi l'elenco giusto lo dice il database di destinazione,
non un elenco scritto qui a mano.

Tre azioni:
  report  — sola lettura: ruoli configurati, scuole con Stripe Connect pronto
            e i loro pacchetti attivi (serve per scegliere dove testare un
            acquisto vero, che richiede stripe_onboarding_complete=True).
  seed    — idempotente: un utente per ogni HQRole e per ogni SchoolRole
            (su una scuola QA dedicata), un insegnante, un'allieva. Tutti con
            la stessa password nota. Email sotto qa.*@example.test — non
            collidono con account reali e si riconoscono a colpo d'occhio.
  cleanup — rimuove tutto ciò che seed ha creato (per email prefix + scuola QA).
"""
from django.core.management.base import BaseCommand

QA_PASSWORD = "QaSuite!2026"  # nota, temporanea, solo per ambienti di test
# Dominio dedicato, non "example.test": quello è già usato da fixture di load
# test presenti in alcuni ambienti (Load School A/B, load001..030@example.test).
# find/delete per suffisso di dominio ci era già cascato addosso una volta,
# cancellando dati che non erano nostri — vedi anche il cleanup più sotto,
# che per lo stesso motivo non filtra più per dominio ma per elenco esatto.
QA_EMAIL_DOMAIN = "qa-nounder40.test"
QA_SCHOOL_SLUG = "qa-test-school"


class Command(BaseCommand):
    help = "Report / seed / cleanup QA fixtures for a manual all-roles test pass."

    def add_arguments(self, parser):
        parser.add_argument("action", choices=["report", "seed", "cleanup"])

    def handle(self, *args, **options):
        action = options["action"]
        if action == "report":
            self._report()
        elif action == "seed":
            self._seed()
        else:
            self._cleanup()

    # ------------------------------------------------------------------ report

    def _report(self):
        from accounts.models import HQRole
        from catalog.models import Package
        from schools.models import School, SchoolRole

        self.stdout.write(self.style.NOTICE("HQ roles configured:"))
        for r in HQRole.objects.order_by("label"):
            self.stdout.write(f"  - {r.key:16} {r.label:24} sections={len(r.permissions)}")

        self.stdout.write(self.style.NOTICE("\nSchool roles configured:"))
        for r in SchoolRole.objects.order_by("label"):
            self.stdout.write(f"  - {r.key:16} {r.label:24} sections={len(r.permissions)}")

        self.stdout.write(self.style.NOTICE("\nSchools with Stripe Connect ready for a real checkout:"))
        ready = School.objects.filter(stripe_onboarding_complete=True).exclude(stripe_account_id="")
        if not ready:
            self.stdout.write("  (none — a real Stripe Checkout purchase needs one onboarded school)")
        for s in ready:
            packages = Package.objects.filter(school=s, active=True)
            self.stdout.write(f"  - {s.name} ({s.slug}) — {packages.count()} active package(s)")
            for p in packages[:5]:
                self.stdout.write(f"      · {p.id}  {p.name_en or p.name_it}  €{p.price}  {p.credits} credits")

        self.stdout.write(self.style.NOTICE("\nSchools NOT connected (checkout would 400 school_not_connected):"))
        for s in School.objects.filter(active=True).exclude(pk__in=ready.values("pk"))[:10]:
            self.stdout.write(f"  - {s.name} ({s.slug})")

    # -------------------------------------------------------------------- seed

    def _seed(self):
        from accounts.models import HQMember, HQRole, Role, User
        from catalog.models import AttendanceStatus, Course, Lesson, LessonType, Package
        from schools.models import School, SchoolMembership, SchoolRole
        from students.models import Student
        from teachers.models import Teacher, TeacherSchool

        created, existing = [], []

        def user_for(email, **fields):
            user, was_created = User.objects.get_or_create(email=email, defaults=fields)
            user.set_password(QA_PASSWORD)
            for k, v in fields.items():
                setattr(user, k, v)
            user.is_active = True
            user.save()
            (created if was_created else existing).append(email)
            return user

        # --- HQ: un utente per ogni HQRole configurato -----------------------
        hq_roles = list(HQRole.objects.all())
        if not hq_roles:
            self.stdout.write(self.style.WARNING("No HQRole rows found — seeding a generic 'owner' HQ account."))
            hq_roles = [HQRole.objects.create(key="owner", label="Owner", builtin=True, permissions=[])]

        for role in hq_roles:
            email = f"qa.hq.{role.key}@{QA_EMAIL_DOMAIN}"
            user = user_for(email, role=Role.HQ, roles=[Role.HQ], full_name=f"QA HQ {role.label}")
            HQMember.objects.update_or_create(
                user=user, defaults={"email": email, "name": f"QA HQ {role.label}", "sub_role": role.key, "active": True}
            )

        # --- una scuola dedicata al QA, distinta da quelle reali -------------
        school, _ = School.objects.get_or_create(
            slug=QA_SCHOOL_SLUG,
            defaults=dict(
                name="QA Test School", email=f"qa.school@{QA_EMAIL_DOMAIN}", city="Milano", country="Italia",
                active=True, cancellation_policy_hours=24, min_booking_notice_hours=1,
            ),
        )
        if not school.active:
            school.active = True
            school.save(update_fields=["active"])

        # --- School: un utente per ogni SchoolRole configurato ---------------
        school_roles = list(SchoolRole.objects.all())
        if not school_roles:
            school_roles = [SchoolRole.objects.create(key="admin", label="Admin", builtin=True, permissions=[])]

        first_school_user = None
        for role in school_roles:
            email = f"qa.school.{role.key}@{QA_EMAIL_DOMAIN}"
            user = user_for(
                email, role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
                full_name=f"QA School {role.label}",
            )
            SchoolMembership.objects.get_or_create(profile=user, school=school, defaults={"sub_role": role.key})
            first_school_user = first_school_user or user

        # --- un'insegnante collegata alla scuola QA ---------------------------
        teacher_email = f"qa.teacher@{QA_EMAIL_DOMAIN}"
        teacher_user = user_for(teacher_email, role=Role.TEACHER, roles=[Role.TEACHER], full_name="QA Teacher")
        teacher, _ = Teacher.objects.get_or_create(
            user=teacher_user, defaults={"name": "QA Teacher", "email": teacher_email, "active": True}
        )
        TeacherSchool.objects.get_or_create(teacher=teacher, school=school, defaults={"active": True})

        # --- un'allieva collegata alla scuola QA ------------------------------
        student_email = f"qa.student@{QA_EMAIL_DOMAIN}"
        student_user = user_for(student_email, role=Role.STUDENT, roles=[Role.STUDENT], full_name="QA Student")
        student, _ = Student.objects.get_or_create(
            user=student_user, defaults={"name": "QA Student", "email": student_email, "school": school}
        )
        if student.school_id != school.id:
            student.school = school
            student.save(update_fields=["school"])

        # --- catalogo minimo per prenotare (non serve Stripe) -----------------
        lesson_type, _ = LessonType.objects.get_or_create(
            code="qa-lesson-type", defaults={"name_en": "QA Lesson Type", "active": True}
        )
        AttendanceStatus.objects.get_or_create(
            school=school, name="Presente", defaults={"burns_credit": True, "is_default": True}
        )
        AttendanceStatus.objects.get_or_create(
            school=school, name="Assente", defaults={"burns_credit": True}
        )
        course, _ = Course.objects.get_or_create(
            school=school, lesson_type=lesson_type, name="QA Course",
            defaults={"teacher": teacher, "max_capacity": 10, "credit_cost": 1, "active": True},
        )
        package, _ = Package.objects.get_or_create(
            school=school, name_en="QA Credit Pack",
            defaults={"name_it": "QA Credit Pack", "credits": 10, "price": 25, "validity_days": 90, "active": True},
        )

        from datetime import timedelta

        from django.utils import timezone

        now = timezone.now()
        lessons_made = 0
        for days_ahead in (1, 2, 3):
            when = now + timedelta(days=days_ahead)
            _, was_new = Lesson.objects.get_or_create(
                school=school, course=course, date=when.date(),
                start_time=when.time().replace(second=0, microsecond=0),
                defaults={
                    "end_time": (when + timedelta(hours=1)).time(),
                    "teacher": teacher, "lesson_type": lesson_type, "max_capacity": 10,
                },
            )
            lessons_made += int(was_new)

        self.stdout.write(self.style.SUCCESS(
            f"\nSeeded. New accounts: {len(created)}, already present: {len(existing)}. "
            f"School: {school.name} ({school.slug}). Lessons created this run: {lessons_made}."
        ))
        self.stdout.write(f"Password for every qa.*@{QA_EMAIL_DOMAIN} account: {QA_PASSWORD}")
        self.stdout.write("\nAccounts:")
        for role in hq_roles:
            self.stdout.write(f"  qa.hq.{role.key}@{QA_EMAIL_DOMAIN}  (HQRole: {role.key})")
        for role in school_roles:
            self.stdout.write(f"  qa.school.{role.key}@{QA_EMAIL_DOMAIN}  (SchoolRole: {role.key})")
        self.stdout.write(f"  {teacher_email}  (Teacher)")
        self.stdout.write(f"  {student_email}  (Student, school={school.slug})")
        self.stdout.write(
            f"\nNote: {school.name} has NOT completed Stripe Connect onboarding "
            "(stripe_onboarding_complete=False) — a real Checkout purchase against its "
            "own package will 400 with school_not_connected. Run `report` to see if "
            "another, already-onboarded school exists to test a purchase against instead."
        )

    # ----------------------------------------------------------------- cleanup

    def _cleanup(self):
        from accounts.models import HQMember, HQRole, User
        from catalog.models import AttendanceStatus, Course, Lesson, LessonType, Package
        from schools.models import School, SchoolMembership, SchoolRole
        from students.models import Student
        from teachers.models import Teacher

        # Elenco ESATTO delle email che seed() crea, non un filtro per dominio:
        # un `endswith` una volta ha cancellato dati di load-test che vivevano
        # sullo stesso dominio "example.test" per una ragione indipendente da
        # noi. Qui si tocca solo ciò che questo comando ha messo.
        emails = {f"qa.hq.{r.key}@{QA_EMAIL_DOMAIN}" for r in HQRole.objects.all()}
        emails |= {f"qa.school.{r.key}@{QA_EMAIL_DOMAIN}" for r in SchoolRole.objects.all()}
        emails |= {f"qa.teacher@{QA_EMAIL_DOMAIN}", f"qa.student@{QA_EMAIL_DOMAIN}"}
        # Copre anche ruoli che esistevano al momento del seed ma sono stati
        # rinominati/rimossi da HQRole/SchoolRole nel frattempo.
        emails |= set(User.objects.filter(email__endswith=f"@{QA_EMAIL_DOMAIN}")
                      .values_list("email", flat=True))

        qa_users = User.objects.filter(email__in=emails)
        n_hq = HQMember.objects.filter(user__in=qa_users).delete()[0]
        n_mem = SchoolMembership.objects.filter(profile__in=qa_users).delete()[0]
        n_students = Student.objects.filter(user__in=qa_users).delete()[0]
        n_teachers = Teacher.objects.filter(user__in=qa_users).delete()[0]

        school = School.objects.filter(slug=QA_SCHOOL_SLUG).first()
        n_lessons = n_courses = n_packages = 0
        if school:
            n_lessons = Lesson.objects.filter(school=school).delete()[0]
            n_courses = Course.objects.filter(school=school).delete()[0]
            n_packages = Package.objects.filter(school=school).delete()[0]
            AttendanceStatus.objects.filter(school=school).delete()
            school.delete()
        LessonType.objects.filter(code="qa-lesson-type").delete()

        n_users = qa_users.delete()[0]

        self.stdout.write(self.style.SUCCESS(
            f"Removed: {n_users} users, {n_hq} HQMember, {n_mem} SchoolMembership, "
            f"{n_students} Student, {n_teachers} Teacher, {n_courses} Course, "
            f"{n_lessons} Lesson, {n_packages} Package, QA school: {bool(school)}."
        ))
