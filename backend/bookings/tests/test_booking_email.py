"""The confirmation email carries every placeholder the HQ editor offers —
a missing one renders as "" and "🕐 16:15 ()" reaches the student."""
import uuid
from datetime import date, time, timedelta
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from bookings.services import book_lesson, cancel_booking, notify_lesson_cancelled_by_school
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolLocation, SchoolRoom
from students.models import Student, StudentPackage
from teachers.models import Teacher

pytestmark = pytest.mark.django_db

NEXT_MONDAY = date(2026, 9, 7)


@pytest.fixture
def school():
    return School.objects.create(name="Test School", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")


@pytest.fixture
def student(school):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Francesca", school=school, language_preference="it")
    pkg = Package.objects.create(school=school, credits=10)
    StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=10, credits_remaining=10,
        expires_at=timezone.now() + timedelta(days=90),
    )
    return student


def _lesson(school, *, is_online=False):
    lesson_type = LessonType.objects.create(code=f"sbarra-{uuid.uuid4().hex[:6]}", name_en="Barre", name_it="Sbarra")
    teacher = Teacher.objects.create(name="Alessia", first_name="Alessia", last_name="Rossi")
    location = SchoolLocation.objects.create(school=school, name="Sede Centro", address="Via Roma 12")
    room = SchoolRoom.objects.create(location=location, name="Sala A")
    course = Course.objects.create(
        school=school, lesson_type=lesson_type, credit_cost=1, min_booking_notice_hours=0, is_online=is_online,
    )
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type, teacher=teacher, room=room,
        date=NEXT_MONDAY, start_time=time(16, 15), end_time=time(17, 30),
        max_capacity=10, status="scheduled", is_online=is_online, online_link="https://meet/x" if is_online else "",
    )


@pytest.fixture
def delayed():
    with patch("notifications.tasks.send_transactional_email_task.delay") as mock:
        yield mock


def test_confirmation_email_has_every_placeholder(school, student, delayed, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, _lesson(school))
    kwargs = delayed.call_args_list[0].kwargs  # [1] is the school's copy
    assert kwargs["key"] == "booking_confirmed"
    assert kwargs["locale"] == "it"
    assert kwargs["context"] == {
        "student_name": "Francesca", "student_first_name": "Francesca", "school_name": "Test School",
        "lesson_name": "Sbarra", "lesson_date": "07-09-2026", "lesson_time": "16:15", "lesson_duration": "75 min",
        "teacher_name": "Alessia Rossi", "teacher_first_name": "Alessia",
        "location_name": "Sede Centro", "location_address": "Via Roma 12",
        "room_name": "Sala A", "online_link": "",
        "booking_url": kwargs["context"]["booking_url"],
        "school_calendar_url": kwargs["context"]["school_calendar_url"],
        "cancellation_hours": "24",
    }
    assert "/it/student/bookings?for=" in kwargs["context"]["booking_url"]
    assert f"/it/student/book?school_id={school.id}&for=" in kwargs["context"]["school_calendar_url"]


def test_online_lesson_uses_the_online_template(school, student, delayed, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, _lesson(school, is_online=True))
    kwargs = delayed.call_args_list[0].kwargs
    assert kwargs["key"] == "student.booking_confirmed.online"
    assert kwargs["context"]["online_link"] == "https://meet/x"


# ---- the school hears about the same events (HQ > Emails "Alla scuola") ----

def test_school_is_notified_of_new_booking(school, student, delayed, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, _lesson(school))
    assert [c.kwargs["key"] for c in delayed.call_args_list] == ["booking_confirmed", "school.new_booking"]
    to_school = delayed.call_args_list[1].kwargs
    assert to_school["to_email"] == "s@example.com"
    assert to_school["locale"] == "it"  # School.language default, not the student's
    assert to_school["context"]["student_email"] == student.user.email
    assert to_school["context"]["lesson_name"] == "Sbarra"


def test_school_is_notified_when_student_cancels(school, student, delayed, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        booking = book_lesson(student, _lesson(school))
    delayed.reset_mock()
    with django_capture_on_commit_callbacks(execute=True):
        cancel_booking(booking)
    assert [c.kwargs["key"] for c in delayed.call_args_list] == ["booking_cancelled", "school.booking_cancelled"]


def test_lesson_cancelled_by_school_emails_each_student(school, student, delayed, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        booking = book_lesson(student, _lesson(school, is_online=True))
    delayed.reset_mock()
    with django_capture_on_commit_callbacks(execute=True):
        notify_lesson_cancelled_by_school([booking])
    assert [c.kwargs["key"] for c in delayed.call_args_list] == ["student.lesson_cancelled_by_school.online"]
    assert delayed.call_args.kwargs["to_email"] == student.user.email


def test_booking_enrols_the_student_and_sets_the_home_school(school, student, delayed, django_capture_on_commit_callbacks):
    from schools.models import SchoolStudent

    student.school = None
    student.save(update_fields=["school"])
    assert not SchoolStudent.objects.filter(school=school, student=student).exists()
    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, _lesson(school))
    student.refresh_from_db()
    assert student.school_id == school.id
    assert SchoolStudent.objects.filter(school=school, student=student).exists()


# ---- credits_low / no_show ----

def test_credits_low_fires_once_when_the_threshold_is_crossed(school, delayed, django_capture_on_commit_callbacks):
    from notifications.models import EmailSetting

    EmailSetting.objects.create(key="credits_low_threshold", value="2")
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna", school=school, language_preference="en")
    pkg = Package.objects.create(school=school, credits=3, name_en="Trio")
    StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=3, credits_remaining=3,
        expires_at=timezone.now() + timedelta(days=90),
    )
    lesson_type = LessonType.objects.create(code=f"t-{uuid.uuid4().hex[:6]}", name_en="Barre")

    def make(day):
        course = Course.objects.create(school=school, lesson_type=lesson_type, credit_cost=1, min_booking_notice_hours=0)
        return Lesson.objects.create(
            school=school, course=course, lesson_type=lesson_type, date=day,
            start_time=time(10, 0), end_time=time(11, 0), max_capacity=10, status="scheduled",
        )

    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, make(NEXT_MONDAY))  # 3 → 2: crosses the threshold
    keys = [c.kwargs["key"] for c in delayed.call_args_list]
    assert keys == ["booking_confirmed", "school.new_booking", "credits_low"]
    ctx = delayed.call_args_list[2].kwargs["context"]
    assert (ctx["credits_remaining"], ctx["credits_threshold"], ctx["package_name"]) == ("2", "2", "Trio")

    delayed.reset_mock()
    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, make(NEXT_MONDAY + timedelta(days=1)))  # 2 → 1: already below, no repeat
    assert "credits_low" not in [c.kwargs["key"] for c in delayed.call_args_list]


def test_no_show_that_burns_the_credit_emails_the_student(school, student, delayed, django_capture_on_commit_callbacks):
    from bookings.models import Attendance
    from bookings.services import mark_attendance

    lesson = _lesson(school)
    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, lesson)
    delayed.reset_mock()
    with django_capture_on_commit_callbacks(execute=True):
        mark_attendance(lesson, student, lesson.teacher, status=Attendance.Status.NO_SHOW)
    assert [c.kwargs["key"] for c in delayed.call_args_list] == ["no_show"]


def test_free_first_lesson_covers_the_very_first_booking(school, student, delayed, django_capture_on_commit_callbacks):
    """Even for a student with no link to the school yet: the link is created
    by the booking itself, and it is her first lesson here."""
    from schools.models import SchoolStudent

    school.free_first_lesson = True
    school.save(update_fields=["free_first_lesson"])
    SchoolStudent.objects.filter(school=school, student=student).delete()
    with django_capture_on_commit_callbacks(execute=True):
        first = book_lesson(student, _lesson(school))
        second = book_lesson(student, _lesson(school))
    assert (first.credits_deducted, first.access_source) == (0, "free_lesson")
    assert second.credits_deducted == 1
