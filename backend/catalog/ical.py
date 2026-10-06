"""Minimal iCal (RFC 5545) generator — no external dependency, the event shape
here (single-occurrence VEVENTs from already-expanded Lesson rows) is simple
enough to hand-roll.

Three consumers share it: the public school feed and the private per-student
feed (ical_views.py) and the one-event "Aggiungi al calendario" link in the
booking emails (bookings/services.booking_calendar_event). Times are written
in UTC: `Lesson.date` / `start_time` are the school's wall clock (see
bookings/services._lesson_datetime), so they go through `School.timezone`
first — a naive DTSTART was read in whatever zone the phone was in, which
shifted every lesson for a student travelling abroad. UTC needs no VTIMEZONE
block and every client (Google, Apple, Outlook) accepts it.
"""

from dataclasses import dataclass
from datetime import datetime, timezone as dt_timezone
from urllib.parse import urlencode

PRODID = "-//No Under 40//Calendar//EN"
_MAX_OCTETS = 75  # RFC 5545 §3.1: content lines are folded at 75 octets


@dataclass(frozen=True)
class CalendarEvent:
    uid: str
    start: datetime  # timezone-aware
    end: datetime  # timezone-aware
    summary: str
    location: str = ""
    description: str = ""
    url: str = ""
    cancelled: bool = False


def lesson_event(lesson, *, locale: str = "en", description: str = "") -> CalendarEvent:
    """A Lesson as a calendar event, in the reader's language.

    Summary is the course name (a special event's own title) or the Metodo
    lesson type in `locale`, then the school — what the lesson emails show.
    `description` is appended after the teacher / school / join-link lines:
    the booking email adds its "manage the booking" link and disclaimer there.
    Expects lesson.school (and ideally course, teacher, room__location) to be
    select_related: the feeds hand over up to 2000 rows."""
    course = lesson.course
    school = lesson.school
    tz = school.tzinfo()
    start = datetime.combine(lesson.date, lesson.start_time, tzinfo=tz)
    end = datetime.combine(lesson.date, lesson.end_time, tzinfo=tz)

    name = (course.name if course else "") or (lesson.lesson_type.localized_name(locale) if lesson.lesson_type_id else "")
    summary = " · ".join(p for p in (name or "Lesson", school.name) if p)

    teacher = lesson.teacher or (course.teacher if course else None)
    room = lesson.room or (course.room if course else None)
    place = room.location if room else None
    online_link = (lesson.online_link or (course.online_link if course else "")) if lesson.is_online else ""

    if lesson.is_online:
        location = "Online"
    else:
        header = " · ".join(p for p in (place.name if place else "", room.name if room else "") if p)
        location = ", ".join(p for p in (header, place.address if place else "") if p) or school.name

    lines = [p for p in (teacher.name if teacher else "", school.name, online_link) if p]
    if description:
        lines += ["", description]
    return CalendarEvent(
        uid=f"{lesson.id}@nounder40",
        start=start,
        end=end,
        summary=summary,
        location=location,
        description="\n".join(lines),
        url=online_link,
        cancelled=lesson.status == "cancelled",
    )


def _fold(line: str) -> str:
    """Break a content line at 75 octets (not characters: an address with
    accents or an emoji is several octets), continuation lines start with a
    space that counts toward their own 75."""
    out, current, size = [], [], 0
    for ch in line:
        n = len(ch.encode("utf-8"))
        if size + n > _MAX_OCTETS:
            out.append("".join(current))
            current, size = [" "], 1
        current.append(ch)
        size += n
    out.append("".join(current))
    return "\r\n".join(out)


def _escape(text: str) -> str:
    return (text or "").replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")


def _utc(moment: datetime) -> str:
    return moment.astimezone(dt_timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def build_ics(events, *, calendar_name: str) -> bytes:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{PRODID}",
        "CALSCALE:GREGORIAN",
        # PUBLISH, never REQUEST: this is "add to your calendar", not an
        # invitation — Gmail would otherwise show Yes/No/Maybe buttons and
        # mail the replies to the sender.
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_escape(calendar_name)}",
    ]
    now_stamp = _utc(datetime.now(dt_timezone.utc))

    for event in events:
        lines += [
            "BEGIN:VEVENT",
            f"UID:{event.uid}",
            f"DTSTAMP:{now_stamp}",
            f"DTSTART:{_utc(event.start)}",
            f"DTEND:{_utc(event.end)}",
            f"SUMMARY:{_escape(event.summary)}",
            f"LOCATION:{_escape(event.location)}",
        ]
        if event.description:
            lines.append(f"DESCRIPTION:{_escape(event.description)}")
        if event.url:
            lines.append(f"URL:{event.url}")
        lines += [f"STATUS:{'CANCELLED' if event.cancelled else 'CONFIRMED'}", "END:VEVENT"]

    lines.append("END:VCALENDAR")
    return ("\r\n".join(_fold(line) for line in lines) + "\r\n").encode("utf-8")


def google_calendar_url(event: CalendarEvent) -> str:
    """The "create event" page of Google Calendar with the event filled in —
    one tap, nothing to download. UTC `dates` (the trailing Z) so the event
    lands at the right hour whatever zone the student's calendar is in."""
    params = {
        "action": "TEMPLATE",
        "text": event.summary,
        "dates": f"{_utc(event.start)}/{_utc(event.end)}",
    }
    if event.description:
        params["details"] = event.description
    if event.location:
        params["location"] = event.location
    return "https://calendar.google.com/calendar/render?" + urlencode(params)
