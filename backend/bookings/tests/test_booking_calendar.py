"""The "Add to calendar" links of the confirmation / reminder emails and the
iCal they point at: times are the school's wall clock written in UTC, the
lesson is named in the student's language with its place, one event per
booking behind the student's own feed token, nothing for a cancelled booking."""
import uuid
from datetime import date, datetime, time, timezone as dt_timezone
from urllib.parse import parse_qs, urlparse

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from bookings.models import Booking
from bookings.services import booking_email_context
from catalog.ical import CalendarEvent, build_ics, google_calendar_url, lesson_event
from catalog.models import Course, Lesson, LessonType
from schools.models import School, SchoolLocation, SchoolRoom
from students.models import Student
from teachers.models import Teacher

pytestmark = pytest.mark.django_db

JULY_14 = date(2026, 7, 14)  # summer time: Rome is UTC+2


@pytest.fixture
def school():
    return School.objects.create(
        name="Danza Milano", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        timezone="Europe/Rome", language="it",
    )


@pytest.fixture
def student(school):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name="Francesca", school=school, language_preference="it")


def _lesson(school, *, is_online=False, course_name="", room=True):
    lt = LessonType.objects.create(code=f"sb-{uuid.uuid4().hex[:6]}", name_en="Barre", name_it="Sbarra")
    teacher = Teacher.objects.create(name="Alessia Rossi")
    if room:
        location = SchoolLocation.objects.create(school=school, name="Sede Centro", address="Via Roma 12, Milano")
        room = SchoolRoom.objects.create(location=location, name="Sala A")
    course = Course.objects.create(
        school=school, lesson_type=lt, name=course_name, credit_cost=1,
        is_online=is_online, online_link="https://meet.example/x" if is_online else "",
    )
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt, teacher=teacher, room=room or None,
        date=JULY_14, start_time=time(18, 0), end_time=time(19, 15), status="scheduled", is_online=is_online,
    )


def _booking(student, lesson, status=Booking.Status.CONFIRMED):
    return Booking.objects.create(student=student, lesson=lesson, school=lesson.school, status=status)


# ── catalog.ical ──────────────────────────────────────────────────────────

def test_event_time_is_the_school_wall_clock_written_in_utc(school):
    """18:00 in a Rome school in July is 16:00Z — a naive 18:00 was read in
    whatever zone the phone was in."""
    event = lesson_event(_lesson(school), locale="it")
    assert event.start.astimezone(dt_timezone.utc).hour == 16
    ics = build_ics([event], calendar_name="x").decode()
    assert "DTSTART:20260714T160000Z" in ics
    assert "DTEND:20260714T171500Z" in ics
    assert "METHOD:PUBLISH" in ics and "STATUS:CONFIRMED" in ics


def test_event_is_named_in_the_readers_language_with_its_place(school):
    lesson = _lesson(school)
    assert lesson_event(lesson, locale="it").summary == "Sbarra · Danza Milano"
    assert lesson_event(lesson, locale="en").summary == "Barre · Danza Milano"
    event = lesson_event(lesson, locale="it")
    assert event.location == "Sede Centro · Sala A, Via Roma 12, Milano"
    assert event.description == "Alessia Rossi\nDanza Milano"
    assert event.uid == f"{lesson.id}@nounder40"


def test_course_title_wins_and_online_lessons_carry_the_link(school):
    event = lesson_event(_lesson(school, is_online=True, course_name="Workshop Giselle"), locale="it")
    assert event.summary == "Workshop Giselle · Danza Milano"
    assert event.location == "Online"
    assert event.url == "https://meet.example/x"
    assert "https://meet.example/x" in event.description
    assert "URL:https://meet.example/x" in build_ics([event], calendar_name="x").decode()


def test_without_a_room_the_place_is_the_school(school):
    assert lesson_event(_lesson(school, room=False), locale="it").location == "Danza Milano"


def test_ics_folds_at_75_octets_and_escapes_text():
    event = CalendarEvent(
        uid="u@nounder40",
        start=datetime(2026, 7, 14, 16, 0, tzinfo=dt_timezone.utc),
        end=datetime(2026, 7, 14, 17, 0, tzinfo=dt_timezone.utc),
        summary="Sbarra, livello 1; avanzato",
        location="Sede Centro · Sala A, Via Roma 12",
        description="È" * 120 + "\nseconda riga",
    )
    ics = build_ics([event], calendar_name="x").decode()
    assert "SUMMARY:Sbarra\\, livello 1\\; avanzato" in ics
    assert "\\nseconda riga" in ics
    for line in ics.split("\r\n"):
        assert len(line.encode("utf-8")) <= 75, line
    # unfolding gives the description back in one piece
    assert "È" * 120 in ics.replace("\r\n ", "")


def test_google_calendar_url_carries_utc_dates_title_place_and_notes(school):
    event = lesson_event(_lesson(school), locale="it", description="nota")
    url = google_calendar_url(event)
    assert url.startswith("https://calendar.google.com/calendar/render?")
    q = parse_qs(urlparse(url).query)
    assert q["action"] == ["TEMPLATE"]
    assert q["text"] == ["Sbarra · Danza Milano"]
    assert q["dates"] == ["20260714T160000Z/20260714T171500Z"]
    assert q["location"] == ["Sede Centro · Sala A, Via Roma 12, Milano"]
    assert q["details"] == ["Alessia Rossi\nDanza Milano\n\nnota"]


# ── bookings.services: the email placeholders ─────────────────────────────

def test_confirmation_context_carries_the_calendar_links_and_the_disclaimer(student):
    booking = _booking(student, _lesson(student.school))
    ctx = booking_email_context(booking, "it")
    assert ctx["ics_url"].endswith(f"/api/calendar/student/{student.ical_token}/{booking.id}.ics")
    assert ctx["google_calendar_url"].startswith("https://calendar.google.com/calendar/render?action=TEMPLATE")
    details = parse_qs(urlparse(ctx["google_calendar_url"]).query)["details"][0]
    assert "Gestisci la prenotazione: " in details and "/it/student/bookings?for=" in details
    assert "ricordati di togliere la lezione dal tuo calendario" in details
    block = ctx["add_to_calendar_block"]
    assert block.startswith("<br><br>📅 <strong>Aggiungi al calendario:</strong>")
    assert f'href="{ctx["ics_url"]}"' in block
    assert f'href="{ctx["google_calendar_url"].replace("&", "&amp;")}"' in block  # & escaped inside HTML
    assert ">Google Calendar</a>" in block and ">Apple / Outlook</a>" in block
    assert "non si aggiorna da sola" in block


def test_calendar_block_is_localized_and_falls_back_to_english(student):
    booking = _booking(student, _lesson(student.school))
    assert "Add to calendar" in booking_email_context(booking, "en")["add_to_calendar_block"]
    assert "Zum Kalender hinzufügen" in booking_email_context(booking, "de")["add_to_calendar_block"]
    assert "Add to calendar" in booking_email_context(booking, "pt")["add_to_calendar_block"]


def test_cancelled_booking_has_no_calendar_links(student):
    ctx = booking_email_context(_booking(student, _lesson(student.school), Booking.Status.CANCELLED), "it")
    assert not {"google_calendar_url", "ics_url", "add_to_calendar_block"} & set(ctx)


# ── the one-booking .ics endpoint ─────────────────────────────────────────

def test_booking_ics_serves_one_event_behind_the_students_token(student):
    booking = _booking(student, _lesson(student.school))
    res = APIClient().get(f"/api/calendar/student/{student.ical_token}/{booking.id}.ics")
    assert res.status_code == 200
    assert res["Content-Type"].startswith("text/calendar")
    assert res["Content-Disposition"] == 'attachment; filename="lesson-2026-07-14.ics"'
    body = res.content.decode().replace("\r\n ", "")  # unfold
    assert body.count("BEGIN:VEVENT") == 1
    assert f"UID:{booking.lesson_id}@nounder40" in body
    assert "DTSTART:20260714T160000Z" in body
    assert "SUMMARY:Sbarra · Danza Milano" in body
    assert "Gestisci la prenotazione: " in body and "ricordati di togliere la lezione" in body


def test_booking_ics_is_404_for_a_wrong_token_another_student_or_a_cancelled_booking(student):
    booking = _booking(student, _lesson(student.school))
    api = APIClient()
    assert api.get(f"/api/calendar/student/{uuid.uuid4()}/{booking.id}.ics").status_code == 404

    other_user = get_user_model().objects.create(email=f"o-{uuid.uuid4().hex[:8]}@example.com")
    other = Student.objects.create(user=other_user, name="Giulia", school=student.school)
    assert api.get(f"/api/calendar/student/{other.ical_token}/{booking.id}.ics").status_code == 404

    booking.status = Booking.Status.CANCELLED
    booking.save(update_fields=["status"])
    assert api.get(f"/api/calendar/student/{student.ical_token}/{booking.id}.ics").status_code == 404


def test_student_feed_uses_the_school_timezone_and_her_language(student):
    _booking(student, _lesson(student.school))
    res = APIClient().get(f"/api/calendar/student/{student.ical_token}.ics")
    assert res.status_code == 200
    body = res.content.decode().replace("\r\n ", "")
    assert "DTSTART:20260714T160000Z" in body
    assert "SUMMARY:Sbarra · Danza Milano" in body


def test_school_feed_uses_the_school_language(school):
    _lesson(school)
    res = APIClient().get(f"/api/calendar/{school.id}.ics")
    assert res.status_code == 200
    assert "SUMMARY:Sbarra · Danza Milano" in res.content.decode().replace("\r\n ", "")
