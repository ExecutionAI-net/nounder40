"""Minimal iCal (RFC 5545) generator — no external dependency, the event shape
here (single-occurrence VEVENTs from already-expanded Lesson rows) is simple
enough to hand-roll."""

from datetime import datetime, timezone as dt_timezone


def _fold(line: str) -> str:
    return line  # lines here stay well under the 75-octet fold limit


def _escape(text: str) -> str:
    return (text or "").replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")


def _dt(date, time_) -> str:
    return datetime.combine(date, time_).strftime("%Y%m%dT%H%M%S")


def build_ics(lessons, *, calendar_name: str) -> bytes:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//No Under 40//Calendar//EN",
        "CALSCALE:GREGORIAN",
        f"X-WR-CALNAME:{_escape(calendar_name)}",
    ]
    now_stamp = datetime.now(dt_timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    for lesson in lessons:
        summary = lesson.lesson_type.name_en if lesson.lesson_type_id else "Lesson"
        location = lesson.room.name if lesson.room_id else (lesson.school.name if lesson.school_id else "")
        status = "CANCELLED" if lesson.status == "cancelled" else "CONFIRMED"
        lines += [
            "BEGIN:VEVENT",
            f"UID:{lesson.id}@nounder40",
            f"DTSTAMP:{now_stamp}",
            f"DTSTART:{_dt(lesson.date, lesson.start_time)}",
            f"DTEND:{_dt(lesson.date, lesson.end_time)}",
            f"SUMMARY:{_escape(summary)}",
            f"LOCATION:{_escape(location)}",
            f"STATUS:{status}",
            "END:VEVENT",
        ]

    lines.append("END:VCALENDAR")
    return ("\r\n".join(_fold(line) for line in lines) + "\r\n").encode("utf-8")
