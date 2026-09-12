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


def _monday_at_least(days_ahead: int) -> date:
    """First Monday at least `days_ahead` days out — relative, never a fixed
    calendar date: the lesson has to stay far enough in the future that
    min-notice never trips, whenever the suite happens to run."""
    day = timezone.localdate() + timedelta(days=days_ahead)
    return day + timedelta(days=-day.weekday() % 7)


NEXT_MONDAY = _monday_at_least(14)
NEXT_MONDAY_STR = NEXT_MONDAY.strftime("%d-%m-%Y")


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
        "lesson_name": "Sbarra", "lesson_date": NEXT_MONDAY_STR, "lesson_time": "16:15", "lesson_duration": "75 min",
        "teacher_name": "Alessia Rossi", "teacher_first_name": "Alessia",
        "location_name": "Sede Centro", "location_address": "Via Roma 12",
        "room_name": "Sala A", "location_line": "\n📍 Sede Centro · Sala A\nVia Roma 12", "online_link": "",
        "school_info": "", "school_info_block": "",
        "booking_url": kwargs["context"]["booking_url"],
        "school_calendar_url": kwargs["context"]["school_calendar_url"],
        "cancellation_hours": "24",
    }
    assert "/it/student/bookings?for=" in kwargs["context"]["booking_url"]
    assert f"/it/student/book?school_id={school.id}&for=" in kwargs["context"]["school_calendar_url"]


def test_confirmation_email_omits_location_line_without_a_room(school, student, delayed, django_capture_on_commit_callbacks):
    """ST-R2-15: no room assigned used to render a bare "📍 · " line; the
    {{location_line}} placeholder now drops the whole segment instead."""
    lesson_type = LessonType.objects.create(code=f"sbarra-{uuid.uuid4().hex[:6]}", name_en="Barre", name_it="Sbarra")
    teacher = Teacher.objects.create(name="Alessia", first_name="Alessia", last_name="Rossi")
    course = Course.objects.create(school=school, lesson_type=lesson_type, credit_cost=1, min_booking_notice_hours=0)
    lesson = Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type, teacher=teacher, room=None,
        date=NEXT_MONDAY, start_time=time(16, 15), end_time=time(17, 30),
        max_capacity=10, status="scheduled",
    )
    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, lesson)
    ctx = delayed.call_args_list[0].kwargs["context"]
    assert ctx["location_name"] == "" and ctx["room_name"] == ""
    assert ctx["location_line"] == ""


def test_school_info_inherits_from_the_course(school, student, delayed, django_capture_on_commit_callbacks):
    """Course-level "email info" reaches the confirmation email as a ready-made
    localized block; an empty lesson override inherits it."""
    lesson = _lesson(school)
    lesson.course.email_info = "Porta i pesini"
    lesson.course.save(update_fields=["email_info"])
    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, lesson)
    ctx = delayed.call_args_list[0].kwargs["context"]
    assert ctx["school_info"] == "Porta i pesini"
    assert "Importante — Informazioni dalla scuola" in ctx["school_info_block"]  # student locale is "it"
    assert "Porta i pesini" in ctx["school_info_block"]


def test_school_info_lesson_override_wins_and_is_escaped(school, student, delayed, django_capture_on_commit_callbacks):
    lesson = _lesson(school)
    lesson.course.email_info = "Testo del corso"
    lesson.course.save(update_fields=["email_info"])
    lesson.email_info = "Focus <gambe>\nporta i pesini"
    lesson.save(update_fields=["email_info"])
    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, lesson)
    ctx = delayed.call_args_list[0].kwargs["context"]
    assert ctx["school_info"] == "Focus <gambe>\nporta i pesini"
    # free text goes into an HTML body: escaped, newlines become <br>
    assert "Focus &lt;gambe&gt;<br>porta i pesini" in ctx["school_info_block"]
    assert "Testo del corso" not in ctx["school_info_block"]


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


def _credits_low_setup(school, credits, *, expires_in_days=90, locale="en"):
    """A student holding one package, plus a factory for lessons of a given
    credit cost — the two knobs SCH-R3-12 turns."""
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna", school=school, language_preference=locale)
    catalogue = Package.objects.create(school=school, credits=credits, name_en="Big")
    pkg = StudentPackage.objects.create(
        student=student, school=school, package=catalogue, credits_total=credits, credits_remaining=credits,
        expires_at=timezone.now() + timedelta(days=expires_in_days) if expires_in_days is not None else None,
    )
    lesson_type = LessonType.objects.create(code=f"t-{uuid.uuid4().hex[:6]}", name_en="Barre")
    day = iter(range(1, 40))

    def make(cost):
        course = Course.objects.create(school=school, lesson_type=lesson_type, credit_cost=cost, min_booking_notice_hours=0)
        return Lesson.objects.create(
            school=school, course=course, lesson_type=lesson_type, date=NEXT_MONDAY + timedelta(days=next(day)),
            start_time=time(10, 0), end_time=time(11, 0), max_capacity=10, status="scheduled",
        )

    return student, pkg, make


def _credits_low_calls(delayed):
    return [c for c in delayed.call_args_list if c.kwargs["key"] == "credits_low"]


def test_credits_low_does_not_warn_twice_when_a_cheaper_lesson_shifts_the_count(
    school, delayed, django_capture_on_commit_callbacks
):
    """SCH-R3-12: lessons-left is credits ÷ the cost of the lesson just
    booked, so the old derived "did it just cross?" test came out true a
    second time on a package that never gained a credit. 18 credits: a
    3-credit booking warns at "5 lessons left", then a 2.5-credit one used to
    warn again — still "5 lessons left", at 12.5 of 18."""
    student, _pkg, make = _credits_low_setup(school, 18)

    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, make(3))  # 18 → 15: 6 lessons → 5, warns
    first = _credits_low_calls(delayed)
    assert len(first) == 1
    assert first[0].kwargs["context"]["lessons_remaining"] == "5"

    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, make("2.5"))  # 15 → 12.5: still 5 "lessons", no second warning
    assert len(_credits_low_calls(delayed)) == 1


def test_credits_low_warns_again_after_the_balance_climbs_back_over_the_threshold(
    school, delayed, django_capture_on_commit_callbacks
):
    """A renewal or a manual top-up has to re-arm the warning, otherwise a
    package that fills up again would go quiet for good."""
    student, pkg, make = _credits_low_setup(school, 18)

    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, make(3))  # warns
    assert len(_credits_low_calls(delayed)) == 1

    pkg.refresh_from_db()
    assert pkg.credits_low_sent_at is not None
    StudentPackage.objects.filter(pk=pkg.pk).update(credits_remaining=21)

    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, make(3))  # 21 → 18: 6 lessons left, back above → re-armed
    assert len(_credits_low_calls(delayed)) == 1
    pkg.refresh_from_db()
    assert pkg.credits_low_sent_at is None

    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, make(3))  # 18 → 15: crosses again, warns again
    assert len(_credits_low_calls(delayed)) == 2


def test_credits_low_drops_the_expiry_clause_when_the_package_has_no_expiry(
    school, delayed, django_capture_on_commit_callbacks
):
    """TCH-R3-02: a raw credit grant has no expires_at, and the copy rendered
    the parenthetical anyway — "has 5 lessons left (it expires on )."."""
    from notifications.brand_templates import TEMPLATES
    from notifications.emails import render

    student, _pkg, make = _credits_low_setup(school, 18, expires_in_days=None)
    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, make(3))
    context = _credits_low_calls(delayed)[0].kwargs["context"]
    assert context["package_expiry"] == ""
    assert context["package_expiry_line"] == ""

    body = render(TEMPLATES["student.credits_low"]["en"][1], context)
    assert "expires on" not in body
    assert "has 5 lessons left." in body


def test_credits_low_keeps_the_expiry_clause_when_there_is_one(
    school, delayed, django_capture_on_commit_callbacks
):
    from notifications.brand_templates import TEMPLATES
    from notifications.emails import render

    student, pkg, make = _credits_low_setup(school, 18, expires_in_days=30)
    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, make(3))
    context = _credits_low_calls(delayed)[0].kwargs["context"]
    expiry = pkg.expires_at.strftime("%d-%m-%Y")
    assert context["package_expiry_line"] == f" (it expires on {expiry})"
    assert f"has 5 lessons left (it expires on {expiry})." in render(
        TEMPLATES["student.credits_low"]["en"][1], context
    )


# --- R4-M7 (ST-R4-03 / SCH-R4-06): the warning is about the wallet, never a drop-in --


def _threshold(value="5"):
    from notifications.models import EmailSetting

    EmailSetting.objects.create(key="credits_low_threshold", value=value)


def _lesson_for(school, day, *, lesson_type=None):
    lesson_type = lesson_type or LessonType.objects.create(code=f"t-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(school=school, lesson_type=lesson_type, credit_cost=1, min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lesson_type, date=day,
        start_time=time(10, 0), end_time=time(11, 0), max_capacity=10, status="scheduled",
    )


def test_a_drop_in_purchase_does_not_warn_that_the_package_is_running_low(school, delayed, django_capture_on_commit_callbacks):
    """ST-R4-03: a drop-in holds one lesson; the purchase books it and the
    balance is 0 by construction -- the buyer got "0 lessons left, renew"."""
    _threshold()
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna", school=school, language_preference="en")
    pkg = Package.objects.create(school=school, credits=1, name_en="Single", is_drop_in=True)
    StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=1, credits_remaining=1,
        expires_at=timezone.now() + timedelta(days=30),
    )
    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, _lesson_for(school, NEXT_MONDAY))
    assert "credits_low" not in [c.kwargs["key"] for c in delayed.call_args_list]


def test_the_warning_counts_the_whole_wallet_not_one_package(school, delayed, django_capture_on_commit_callbacks):
    """SCH-R4-06: draining one package to 3 while 10 credits sit in another
    warned "3 lezioni rimaste"; the wallet has 13, nothing is running low."""
    _threshold()
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna", school=school, language_preference="en")
    small = Package.objects.create(school=school, credits=4, name_en="Small")
    big = Package.objects.create(school=school, credits=10, name_en="Big")
    sp_small = StudentPackage.objects.create(
        student=student, school=school, package=small, credits_total=4, credits_remaining=4,
        expires_at=timezone.now() + timedelta(days=30),
    )
    StudentPackage.objects.create(
        student=student, school=school, package=big, credits_total=10, credits_remaining=10,
        expires_at=timezone.now() + timedelta(days=90),
    )
    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, _lesson_for(school, NEXT_MONDAY))  # small: 4 -> 3, wallet 13
    assert "credits_low" not in [c.kwargs["key"] for c in delayed.call_args_list]
    sp_small.refresh_from_db()
    assert sp_small.credits_low_sent_at is None


def test_the_wallet_warning_fires_once_across_packages(school, delayed, django_capture_on_commit_callbacks):
    _threshold("2")
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna", school=school, language_preference="en")
    a = Package.objects.create(school=school, credits=2, name_en="A")
    b = Package.objects.create(school=school, credits=1, name_en="B")
    StudentPackage.objects.create(
        student=student, school=school, package=a, credits_total=2, credits_remaining=2,
        expires_at=timezone.now() + timedelta(days=30),
    )
    StudentPackage.objects.create(
        student=student, school=school, package=b, credits_total=1, credits_remaining=1,
        expires_at=timezone.now() + timedelta(days=90),
    )
    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, _lesson_for(school, NEXT_MONDAY))  # wallet 3 -> 2: crosses the threshold
    keys = [c.kwargs["key"] for c in delayed.call_args_list]
    assert keys.count("credits_low") == 1
    ctx = [c for c in delayed.call_args_list if c.kwargs["key"] == "credits_low"][0].kwargs["context"]
    assert (ctx["credits_remaining"], ctx["lessons_remaining"]) == ("2", "2")

    delayed.reset_mock()
    with django_capture_on_commit_callbacks(execute=True):
        book_lesson(student, _lesson_for(school, NEXT_MONDAY + timedelta(days=1)))  # 2 -> 1, other package
    assert "credits_low" not in [c.kwargs["key"] for c in delayed.call_args_list]
