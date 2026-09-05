"""
Seed deterministic test data for load + security testing.

Two isolated schools (A and B) so multi-tenant isolation can be probed:
whatever school A's users can reach must never include school B's rows.

Run:  docker compose exec -T django python manage.py shell < ops/testing/seed_testdata.py
Idempotent: re-running updates in place instead of duplicating.
"""

import datetime as dt
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.utils import timezone

from bookings.models import Booking
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolLocation, SchoolMembership, SchoolRoom, SchoolStudent
from students.models import Student, StudentPackage
from teachers.models import Teacher, TeacherSchool

User = get_user_model()

PASSWORD = "LoadTest!2024"          # test-only credential, local stack only
LOAD_STUDENTS = 30                  # extra students in school A for k6 ramp-up


def user(email, roles, **extra):
    u, _ = User.objects.get_or_create(email=email, defaults={"is_active": True})
    u.roles = roles
    u.role = roles[0]
    u.is_active = True
    for k, v in extra.items():
        setattr(u, k, v)
    u.set_password(PASSWORD)
    u.save()
    return u


def school(slug, name, owner):
    s, _ = School.objects.get_or_create(
        slug=slug,
        defaults={"name": name, "email": f"{slug}@example.test"},
    )
    s.name = name
    s.owner = owner
    s.active = True
    s.cancellation_policy_hours = 24
    s.min_booking_notice_hours = 2
    s.save()
    return s


def student(email, name, sch):
    u = user(email, ["student"], full_name=name, active_school=sch)
    st, _ = Student.objects.get_or_create(user=u, defaults={"name": name, "email": email})
    st.name, st.email, st.school = name, email, sch
    st.save()
    SchoolStudent.objects.get_or_create(school=sch, student=st)
    return st


def credits(st, sch, pkg, amount=50):
    sp, _ = StudentPackage.objects.get_or_create(
        student=st, school=sch, package=pkg,
        defaults={"credits_total": Decimal(amount), "credits_remaining": Decimal(amount)},
    )
    sp.credits_total = Decimal(amount)
    sp.credits_remaining = Decimal(amount)
    sp.status = "active"
    sp.expires_at = timezone.now() + dt.timedelta(days=365)
    sp.payment_method = "cash"
    sp.save()
    return sp


# ---- HQ ----------------------------------------------------------------
hq = user("hq.test@example.test", ["hq"], full_name="HQ Tester",
          is_staff=True, hq_sub_role="admin")

# ---- Lesson type (global catalog) --------------------------------------
lt, _ = LessonType.objects.get_or_create(
    code="loadtest-salsa",
    defaults={"name_en": "Salsa (test)", "name_it": "Salsa (test)", "active": True},
)

built = {}
for tag, slug, name in [("A", "load-school-a", "Load School A"),
                        ("B", "load-school-b", "Load School B")]:
    owner = user(f"owner.{tag.lower()}@example.test", ["school"], full_name=f"Owner {tag}")
    sch = school(slug, name, owner)
    owner.active_school = sch
    owner.save()
    SchoolMembership.objects.get_or_create(profile=owner, school=sch,
                                           defaults={"sub_role": "admin"})

    tu = user(f"teacher.{tag.lower()}@example.test", ["teacher"], full_name=f"Teacher {tag}")
    teacher, _ = Teacher.objects.get_or_create(
        user=tu, defaults={"name": f"Teacher {tag}", "email": tu.email})
    teacher.active = True
    teacher.save()
    TeacherSchool.objects.get_or_create(teacher=teacher, school=sch, defaults={"active": True})

    loc, _ = SchoolLocation.objects.get_or_create(school=sch, name=f"{name} HQ")
    room, _ = SchoolRoom.objects.get_or_create(location=loc, name="Room 1",
                                               defaults={"capacity": 40})

    pkg, _ = Package.objects.get_or_create(
        school=sch, name_en=f"{name} Test Pack",
        defaults={"credits": Decimal(50), "price": Decimal(100), "active": True},
    )

    course, _ = Course.objects.get_or_create(
        school=sch, name=f"{name} Course",
        defaults={
            "lesson_type": lt, "teacher": teacher, "room": room,
            "start_time": dt.time(19, 0), "duration_minutes": 60,
            "max_capacity": 40, "credit_cost": Decimal("1.0"), "active": True,
        },
    )

    # Future lessons — bookable, so booking flows are exercisable under load.
    today = timezone.localdate()
    for offset in range(1, 15):
        Lesson.objects.get_or_create(
            course=course, school=sch, date=today + dt.timedelta(days=offset),
            start_time=dt.time(19, 0),
            defaults={
                "end_time": dt.time(20, 0), "teacher": teacher, "room": room,
                "lesson_type": lt, "max_capacity": 40, "status": "scheduled",
            },
        )

    main = student(f"student.{tag.lower()}@example.test", f"Student {tag}", sch)
    credits(main, sch, pkg)

    built[tag] = {"school": sch, "package": pkg, "course": course,
                  "teacher": teacher, "student": main, "owner": owner}

# ---- Bulk students in school A for the k6 ramp -------------------------
for i in range(1, LOAD_STUDENTS + 1):
    st = student(f"load{i:03d}@example.test", f"Load User {i:03d}", built["A"]["school"])
    credits(st, built["A"]["school"], built["A"]["package"])

print("=" * 60)
print("SEED OK")
print(f"password           : {PASSWORD}")
for tag in ("A", "B"):
    b = built[tag]
    print(f"school {tag}  id       : {b['school'].id}")
    print(f"  owner            : {b['owner'].email}")
    print(f"  student          : {b['student'].user.email}  (student_id={b['student'].id})")
    print(f"  teacher          : {b['teacher'].user.email}")
    print(f"  course_id        : {b['course'].id}")
    lesson = Lesson.objects.filter(school=b["school"]).order_by("date").first()
    print(f"  lesson_id        : {lesson.id}  ({lesson.date})")
    sp = StudentPackage.objects.filter(student=b["student"]).first()
    print(f"  student_package  : {sp.id}")
print(f"hq user            : {hq.email}")
print(f"load students      : load001..load{LOAD_STUDENTS:03d}@example.test (school A)")
print(f"totals             : users={User.objects.count()} lessons={Lesson.objects.count()} "
      f"bookings={Booking.objects.count()}")
print("=" * 60)
