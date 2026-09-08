"""Staff grants on the teacher-school link (TeacherSchool.can_view_all_lessons /
can_manage_bookings, teachers/access.py):

- without a grant a teacher's panel is exactly what it was: her lessons,
  her attendance, nothing else — a colleague's lesson is a 404, not a 403;
- `can_view_all_lessons` opens the whole school's calendar and attendance,
  `?scope=mine` narrows it back; the grant is per school;
- `can_manage_bookings` lets her add and remove students on a lesson through
  the same engine as the school panel's manual enrolment (credits move the
  same way, and back); on its own it opens no colleague's lesson;
- the school switches the grants from School → Teachers, on its own link only.
"""
import uuid
from datetime import date, time, timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from bookings.models import Booking
from catalog.models import AttendanceStatus, Course, Lesson, LessonType
from schools.models import School, SchoolMembership, SchoolStudent
from students.models import Student, StudentPackage
from teachers.models import Teacher, TeacherSchool

pytestmark = pytest.mark.django_db

User = get_user_model()


@pytest.fixture
def school():
    return School.objects.create(name="Danza Milano", slug=f"s-{uuid.uuid4().hex[:8]}", email="milano@example.com")


@pytest.fixture
def other_school():
    return School.objects.create(name="Danza Roma", slug=f"s-{uuid.uuid4().hex[:8]}", email="roma@example.com")


@pytest.fixture
def lesson_type():
    return LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Base")


def make_teacher(school, name, **grants):
    user = User.objects.create(email=f"{name.lower()}-{uuid.uuid4().hex[:6]}@example.com", role=Role.TEACHER, roles=[Role.TEACHER])
    teacher = Teacher.objects.create(user=user, name=name, email=user.email)
    TeacherSchool.objects.create(teacher=teacher, school=school, active=True, **grants)
    return teacher


def client_for(user):
    api = APIClient()
    api.force_authenticate(user=user)
    return api


def make_lesson(school, lesson_type, teacher, *, day, at=time(18, 0)):
    course = Course.objects.create(school=school, lesson_type=lesson_type, credit_cost=1, min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type, teacher=teacher,
        date=day, start_time=at, end_time=time((at.hour + 1) % 24, at.minute),
        max_capacity=10, current_bookings=0, status="scheduled",
    )


def make_student(school, name="Francesca", credits=5):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT])
    student = Student.objects.create(user=user, name=name, school=school)
    SchoolStudent.objects.create(school=school, student=student)
    StudentPackage.objects.create(
        student=student, school=school, credits_total=credits, credits_remaining=credits, status="active",
    )
    return student


def book(student, lesson):
    b = Booking.objects.create(student=student, lesson=lesson, school=lesson.school, status=Booking.Status.CONFIRMED, credits_deducted=1)
    lesson.current_bookings += 1
    lesson.save(update_fields=["current_bookings"])
    return b


YESTERDAY = date.today() - timedelta(days=1)
NEXT_WEEK = date.today() + timedelta(days=7)


# ---- calendar ----


def test_without_grants_the_calendar_is_her_own_lessons_only(school, lesson_type):
    alessia = make_teacher(school, "Alessia")
    marta = make_teacher(school, "Marta")
    mine = make_lesson(school, lesson_type, alessia, day=NEXT_WEEK)
    make_lesson(school, lesson_type, marta, day=NEXT_WEEK)

    ids = {row["id"] for row in client_for(alessia.user).get("/api/teacher/lessons/").json()}
    assert ids == {str(mine.id)}


def test_view_all_grant_opens_the_school_calendar_and_scope_mine_narrows_it(school, other_school, lesson_type):
    alessia = make_teacher(school, "Alessia", can_view_all_lessons=True)
    marta = make_teacher(school, "Marta")
    elsewhere = make_teacher(other_school, "Giulia")
    mine = make_lesson(school, lesson_type, alessia, day=NEXT_WEEK)
    colleague = make_lesson(school, lesson_type, marta, day=NEXT_WEEK)
    make_lesson(other_school, lesson_type, elsewhere, day=NEXT_WEEK)  # another school: never

    api = client_for(alessia.user)
    assert {r["id"] for r in api.get("/api/teacher/lessons/").json()} == {str(mine.id), str(colleague.id)}
    assert {r["id"] for r in api.get("/api/teacher/lessons/?scope=mine").json()} == {str(mine.id)}


def test_an_inactive_link_grants_nothing(school, lesson_type):
    alessia = make_teacher(school, "Alessia", can_view_all_lessons=True)
    TeacherSchool.objects.filter(teacher=alessia).update(active=False)
    marta = make_teacher(school, "Marta")
    colleague = make_lesson(school, lesson_type, marta, day=YESTERDAY)

    api = client_for(alessia.user)
    assert api.get("/api/teacher/lessons/").json() == []
    assert api.get(f"/api/teacher/attendance/{colleague.id}/").status_code == 404


# ---- attendance on a colleague's lesson ----


def test_attendance_on_a_colleague_lesson_needs_the_view_all_grant(school, lesson_type):
    alessia = make_teacher(school, "Alessia")
    marta = make_teacher(school, "Marta")
    lesson = make_lesson(school, lesson_type, marta, day=YESTERDAY)
    student = make_student(school)
    book(student, lesson)
    present = AttendanceStatus.objects.create(school=school, name="Presente", burns_credit=False, is_default=True)

    api = client_for(alessia.user)
    url = f"/api/teacher/attendance/{lesson.id}/"
    assert api.get(url).status_code == 404
    assert api.post(url, [{"student_id": str(student.id), "status_id": str(present.id)}], format="json").status_code == 404

    TeacherSchool.objects.filter(teacher=alessia).update(can_view_all_lessons=True)
    page = api.get(url)
    assert page.status_code == 200
    assert page.json()["permissions"] == {"is_own": False, "teacher_name": "Marta", "can_manage_bookings": False}

    res = api.post(url, [{"student_id": str(student.id), "status_id": str(present.id)}], format="json")
    assert res.status_code == 200 and res.json()["results"] == [{"student_id": str(student.id), "ok": True}]
    # Recorded under whoever marked; the lesson stays Marta's (compensation, stats)
    attendance = lesson.attendance.get()
    assert attendance.teacher_id == alessia.id
    lesson.refresh_from_db()
    assert lesson.teacher_id == marta.id


def test_stats_follow_the_lesson_teacher_not_whoever_marked(school, lesson_type):
    """QA R2-H10: TeacherStatsView used to filter Attendance by its own
    `teacher` field (whoever marked), not the lesson's teacher -- Alessia
    marking Marta's lesson (as staff) had it silently credited to
    ALESSIA's own Performance numbers, while Marta's showed nothing for a
    lesson she actually taught. Compensation already keyed off
    `Lesson.teacher` correctly; attendance stats now match it."""
    alessia = make_teacher(school, "Alessia", can_view_all_lessons=True)
    marta = make_teacher(school, "Marta")
    lesson = make_lesson(school, lesson_type, marta, day=YESTERDAY)
    student = make_student(school)
    book(student, lesson)
    present = AttendanceStatus.objects.create(school=school, name="Presente", burns_credit=False, is_default=True)

    api = client_for(alessia.user)
    res = api.post(
        f"/api/teacher/attendance/{lesson.id}/",
        [{"student_id": str(student.id), "status_id": str(present.id)}], format="json",
    )
    assert res.status_code == 200

    marta_stats = client_for(marta.user).get("/api/teacher/stats/").json()
    assert marta_stats["attendance_marked"] == 1
    assert marta_stats["present"] == 1

    alessia_stats = api.get("/api/teacher/stats/").json()
    assert alessia_stats["attendance_marked"] == 0
    assert alessia_stats["present"] == 0


# ---- add / remove students ----


def test_managing_students_needs_the_manage_grant(school, lesson_type):
    alessia = make_teacher(school, "Alessia")
    lesson = make_lesson(school, lesson_type, alessia, day=NEXT_WEEK)
    student = make_student(school)
    api = client_for(alessia.user)
    url = f"/api/teacher/attendance/{lesson.id}/students/"

    assert api.get(url).status_code == 403
    assert api.post(url, {"student_id": str(student.id)}, format="json").status_code == 403
    assert api.delete(f"{url}?student_id={student.id}").status_code == 403
    assert not Booking.objects.filter(lesson=lesson).exists()


def test_staff_teacher_adds_and_removes_a_student_with_credits_moving_like_the_school_panel(school, lesson_type):
    alessia = make_teacher(school, "Alessia", can_manage_bookings=True)
    lesson = make_lesson(school, lesson_type, alessia, day=NEXT_WEEK)
    student = make_student(school, credits=5)
    api = client_for(alessia.user)
    url = f"/api/teacher/attendance/{lesson.id}/students/"

    # search: this school's students, with their seat status
    found = api.get(f"{url}?q=fran").json()
    assert found == [{"id": str(student.id), "name": "Francesca", "booked": False}]

    res = api.post(url, {"student_id": str(student.id)}, format="json")
    assert res.status_code == 200, res.data
    assert res.json()["current_bookings"] == 1
    assert [r["student_id"] for r in res.json()["roster"]] == [str(student.id)]
    booking = Booking.objects.get(lesson=lesson, student=student)
    assert booking.status == "confirmed" and booking.credits_deducted == Decimal("1")
    assert student.packages.get().credits_remaining == Decimal("4")
    assert api.get(f"{url}?q=fran").json()[0]["booked"] is True

    # twice is refused, nothing charged twice
    dup = api.post(url, {"student_id": str(student.id)}, format="json")
    assert dup.status_code == 400 and dup.json()["error"] == "already_booked"
    assert student.packages.get().credits_remaining == Decimal("4")

    res = api.delete(f"{url}?student_id={student.id}")
    assert res.status_code == 200 and res.json()["current_bookings"] == 0 and res.json()["roster"] == []
    booking.refresh_from_db()
    assert booking.status == "cancelled" and booking.credit_refunded is True
    assert student.packages.get().credits_remaining == Decimal("5")


def test_a_student_without_credits_cannot_be_added(school, lesson_type):
    alessia = make_teacher(school, "Alessia", can_manage_bookings=True)
    lesson = make_lesson(school, lesson_type, alessia, day=NEXT_WEEK)
    student = make_student(school, credits=0)
    res = client_for(alessia.user).post(
        f"/api/teacher/attendance/{lesson.id}/students/", {"student_id": str(student.id)}, format="json"
    )
    assert res.status_code == 400 and res.json()["error"] == "no_valid_access"


def test_only_this_school_students_can_be_added(school, other_school, lesson_type):
    alessia = make_teacher(school, "Alessia", can_manage_bookings=True)
    lesson = make_lesson(school, lesson_type, alessia, day=NEXT_WEEK)
    outsider = make_student(other_school, name="Outsider")
    api = client_for(alessia.user)
    url = f"/api/teacher/attendance/{lesson.id}/students/"
    assert api.get(f"{url}?q=out").json() == []
    assert api.post(url, {"student_id": str(outsider.id)}, format="json").status_code == 404
    assert api.post(url, {"student_id": "not-a-uuid"}, format="json").status_code == 400


def test_manage_grant_alone_does_not_open_a_colleague_lesson(school, lesson_type):
    alessia = make_teacher(school, "Alessia", can_manage_bookings=True)
    marta = make_teacher(school, "Marta")
    lesson = make_lesson(school, lesson_type, marta, day=NEXT_WEEK)
    student = make_student(school)
    api = client_for(alessia.user)
    url = f"/api/teacher/attendance/{lesson.id}/students/"
    assert api.get(url).status_code == 404
    assert api.post(url, {"student_id": str(student.id)}, format="json").status_code == 404

    TeacherSchool.objects.filter(teacher=alessia).update(can_view_all_lessons=True)
    assert api.get(url).status_code == 200
    page = api.get(f"/api/teacher/attendance/{lesson.id}/").json()
    assert page["permissions"]["can_manage_bookings"] is True


# ---- the school panel switches ----


def _school_admin(school):
    user = User.objects.create(email=f"admin-{uuid.uuid4().hex[:6]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school)
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    return client_for(user)


def test_school_switches_the_grants_on_its_own_link_only(school, other_school):
    alessia = make_teacher(school, "Alessia")
    TeacherSchool.objects.create(teacher=alessia, school=other_school, active=True)

    res = _school_admin(school).patch(
        f"/api/school/teachers/{alessia.id}/", {"can_view_all_lessons": True, "can_manage_bookings": True}, format="json"
    )
    assert res.status_code == 200
    assert res.json()["can_view_all_lessons"] is True and res.json()["can_manage_bookings"] is True
    assert TeacherSchool.objects.get(teacher=alessia, school=school).can_view_all_lessons is True
    # Per school: Roma's link is untouched
    roma = TeacherSchool.objects.get(teacher=alessia, school=other_school)
    assert roma.can_view_all_lessons is False and roma.can_manage_bookings is False

    listed = _school_admin(school).get("/api/school/teachers/").json()["teachers"]
    assert listed[0]["can_view_all_lessons"] is True and listed[0]["can_manage_bookings"] is True

    # Switching off again, and a name edit in the same request still works
    res = _school_admin(school).patch(
        f"/api/school/teachers/{alessia.id}/", {"can_view_all_lessons": False, "first_name": "Alessia", "last_name": "Rossi"}, format="json"
    )
    assert res.status_code == 200 and res.json()["can_view_all_lessons"] is False and res.json()["name"] == "Alessia Rossi"


@pytest.mark.parametrize("false_value", [False, "false", "False", "0", 0])
def test_grant_patch_coerces_falsy_string_correctly(school, false_value):
    """SCH-R2-24: `bool("false")` is True in Python, so a plain
    `bool(request.data.get(field))` cast kept the grant on when the client
    sent the JSON string "false" instead of the boolean `false`."""
    alessia = make_teacher(school, "Alessia", can_view_all_lessons=True)

    res = _school_admin(school).patch(
        f"/api/school/teachers/{alessia.id}/", {"can_view_all_lessons": false_value}, format="json"
    )

    assert res.status_code == 200, res.content
    assert res.json()["can_view_all_lessons"] is False
    assert TeacherSchool.objects.get(teacher=alessia, school=school).can_view_all_lessons is False


def test_grant_patch_rejects_unparseable_boolean(school):
    alessia = make_teacher(school, "Alessia")

    res = _school_admin(school).patch(
        f"/api/school/teachers/{alessia.id}/", {"can_view_all_lessons": "maybe"}, format="json"
    )

    assert res.status_code == 400, res.content
    assert TeacherSchool.objects.get(teacher=alessia, school=school).can_view_all_lessons is False


def test_a_school_cannot_touch_a_teacher_it_does_not_have(school, other_school):
    alessia = make_teacher(school, "Alessia")
    res = _school_admin(other_school).patch(f"/api/school/teachers/{alessia.id}/", {"can_view_all_lessons": True}, format="json")
    assert res.status_code == 404
    assert TeacherSchool.objects.get(teacher=alessia).can_view_all_lessons is False


def test_teacher_schools_endpoint_reports_the_grants(school):
    alessia = make_teacher(school, "Alessia", can_view_all_lessons=True)
    rows = client_for(alessia.user).get("/api/teacher/schools/").json()
    assert rows[0]["school_id"] == str(school.id)
    assert rows[0]["can_view_all_lessons"] is True and rows[0]["can_manage_bookings"] is False


# ---- the school panel's own manual enrolment still behaves (moved engine) ----


def test_school_manual_enrolment_uses_the_same_engine(school, lesson_type):
    alessia = make_teacher(school, "Alessia")
    lesson = make_lesson(school, lesson_type, alessia, day=NEXT_WEEK)
    student = make_student(school, credits=2)
    api = _school_admin(school)
    url = f"/api/school/classes/{lesson.id}/students/"

    assert api.post(url, {"student_id": str(student.id)}, format="json").status_code == 200
    assert student.packages.get().credits_remaining == Decimal("1")
    dup = api.post(url, {"student_id": str(student.id)}, format="json")
    assert dup.status_code == 400 and dup.json()["error"] == "Student already booked"

    assert api.delete(f"{url}?student_id={student.id}").json() == {"removed": True}
    assert student.packages.get().credits_remaining == Decimal("2")
    assert api.delete(f"{url}?student_id={student.id}").status_code == 404
