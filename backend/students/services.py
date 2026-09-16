"""Bulk student import from a spreadsheet, and the e-mail that lets a student
set her password.

Import. The client parses the Excel/CSV file, lets the school match every
column to a field ("Nome" -> full name, "E-mail" -> email, "is_blocked" ->
ignore...) and posts the resulting rows here twice: first as a dry run, whose
per-row plan is the preview the school confirms, then for real with the same
payload. Both calls go through the same code path so the preview cannot drift
from what the import actually does. Per row, one of four outcomes:

- ``create``: no account with that e-mail -> User (student role, no usable
  password) + Student + SchoolStudent link.
- ``enroll``: the account exists (a student of another school, a teacher...)
  but is not enrolled here -> SchoolStudent link only; an existing profile is
  hers and is left untouched. An account with no student profile yet gets one,
  like /auth/become-student/.
- ``already_enrolled``: nothing to do, reported so the school sees it.
- ``error``: the row is skipped and the reason is reported; the other rows
  still go through.

The import sends no e-mail (Carlo, 16/09/2026): the school decides afterwards
whom to write to, selecting students in the list and using "Send password
email" (`send_password_emails`). That e-mail is the school invitation with the
"choose your password" link for an account that never had a password, and the
ordinary password reset for one that has -- `queue_password_email` picks.

Nothing here is a second registration path: the rows end up in the same
User/Student/SchoolStudent shape RegisterSerializer produces, minus the
password the student chooses herself from the link.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import date
from functools import partial

from django.db import transaction
from django.db.models.functions import Lower
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from core.locales import clamp_locale
from core.params import parse_date, parse_email

logger = logging.getLogger(__name__)

MAX_ROWS = 2000
INVITE_EMAIL_KEY = "student.school_invite"
PASSWORD_RESET_KEY = "password_reset"

# Student/User column widths: a value that does not fit is a row error, not a
# silent truncation or a database error half-way through the import.
MAX_LENGTH = {
    "first_name": 120, "last_name": 120, "phone": 40, "address": 255,
    "city": 120, "postal_code": 20, "province": 120, "country": 120,
}
TEXT_FIELDS = ("first_name", "last_name", "phone", "address", "city", "postal_code", "province", "country")

# Dialling code per country the platform knows (geography/services.py),
# mirror of DIAL_CODES in frontend lib/countries.ts: the default prefix for
# phone numbers that come without one is the school's own.
DIAL_CODES = {
    "IT": "39", "ES": "34", "FR": "33", "DE": "49", "GB": "44", "TR": "90", "PT": "351", "NL": "31", "BE": "32",
    "CH": "41", "AT": "43", "IE": "353", "GR": "30", "PL": "48", "SE": "46", "DK": "45", "NO": "47", "FI": "358",
    "US": "1", "BR": "55", "AR": "54", "CL": "56", "CO": "57", "MX": "52", "PR": "1787",
}
# Countries that keep the trunk "0" in the international form (+39 06 ...);
# everywhere else a leading 0 is dropped (+33 6 ..., +44 7 ..., +49 30 ...).
_KEEP_TRUNK_ZERO = {"39"}


@dataclass
class ImportRow:
    row: int  # 1-based line in the file, so the school can find it again
    email: str = ""
    first_name: str = ""
    last_name: str = ""
    phone: str = ""
    address: str = ""
    city: str = ""
    postal_code: str = ""
    province: str = ""
    country: str = ""
    date_of_birth: date | None = None
    language_preference: str = "en"
    action: str = ""  # create | enroll | already_enrolled | error
    error: str = ""
    error_field: str = ""
    warnings: list[str] = field(default_factory=list)
    student_id: str | None = None  # known after the import (or already, for existing accounts)

    @property
    def name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    def fail(self, code: str, field_name: str = "") -> None:
        self.action, self.error, self.error_field = "error", code, field_name

    def as_dict(self) -> dict:
        return {
            "row": self.row, "email": self.email, "name": self.name,
            "first_name": self.first_name, "last_name": self.last_name, "phone": self.phone,
            "address": self.address, "city": self.city, "postal_code": self.postal_code,
            "province": self.province, "country": self.country,
            "date_of_birth": self.date_of_birth.isoformat() if self.date_of_birth else None,
            "language_preference": self.language_preference,
            "action": self.action, "error": self.error, "error_field": self.error_field,
            "warnings": self.warnings, "student_id": self.student_id,
        }


def _text(value) -> str:
    """A spreadsheet cell as clean text.

    Excel marks a number typed as text with a leading apostrophe and exports
    keep it ("'+393487258699"); numbers arrive as int/float; None is blank.
    """
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    text = " ".join(str(value).split())
    return text.lstrip("'\"’`").strip()


def school_dial_code(school) -> str:
    """The school's own dialling code ("39"), or "" when its country is not known."""
    from geography.services import country_code_for

    return DIAL_CODES.get(country_code_for(getattr(school, "country", "")) or "", "")


def normalize_phone(raw, default_prefix: str) -> str:
    """A phone number in the international form the app stores ("+39 3487258699").

    Spreadsheets carry every spelling at once: "+39 348 7258699", "0039...",
    a bare national "348 7258699", or -- the classic Excel accident -- the
    number stored as a number, so the "+" is gone and "393487258699" arrives.
    `default_prefix` (digits or "+39") is the school's country: it is added
    to numbers that have no prefix of their own; a national number that
    already starts with those digits and is too long to be national is the
    plus-less form. Anything without digits is kept as typed.
    """
    text = _text(raw)
    if not text:
        return ""
    digits = re.sub(r"\D", "", text)
    if not digits:
        return text
    prefix = re.sub(r"\D", "", default_prefix or "")

    def joined(country: str, national: str) -> str:
        return f"+{country} {national}".strip() if national else f"+{country}"

    def split_known(all_digits: str) -> str:
        # Show the country part apart when it is the school's own; another
        # country's number stays in one piece rather than being split wrong.
        if prefix and all_digits.startswith(prefix) and len(all_digits) > len(prefix):
            return joined(prefix, all_digits[len(prefix):])
        return f"+{all_digits}"

    if text.startswith("+"):
        return split_known(digits)
    if digits.startswith("00") and len(digits) > 2:
        return split_known(digits[2:])
    if not prefix:
        return digits
    if digits.startswith(prefix) and len(digits) >= len(prefix) + 9:
        return joined(prefix, digits[len(prefix):])  # Excel dropped the "+"
    national = digits
    if prefix not in _KEEP_TRUNK_ZERO and national.startswith("0"):
        national = national[1:]
    return joined(prefix, national)


def normalize_rows(raw_rows: list[dict], default_language: str, phone_prefix: str) -> list[ImportRow]:
    """Client rows -> validated ImportRows; every problem is a row error."""
    from geography.services import country_code_for

    rows: list[ImportRow] = []
    seen: set[str] = set()
    for index, raw in enumerate(raw_rows, start=1):
        row_number = raw.get("row")
        row = ImportRow(row=row_number if isinstance(row_number, int) and row_number > 0 else index)
        rows.append(row)

        for name in TEXT_FIELDS:
            setattr(row, name, _text(raw.get(name)))
        row.phone = normalize_phone(raw.get("phone"), phone_prefix)
        full_name = _text(raw.get("name"))
        if not row.first_name and full_name:
            # One "Name" column: first word is the first name, the rest the
            # surname -- the same split the school's profile edit applies.
            row.first_name, _, row.last_name = full_name.partition(" ")
        row.language_preference = clamp_locale(_text(raw.get("language_preference")).lower(), default_language)

        try:
            row.email = parse_email(raw.get("email"), "email", required=False)
        except ValidationError:
            row.fail("invalid_email", "email")
            continue
        if not row.email:
            row.fail("missing_email", "email")
            continue
        if row.email in seen:
            row.fail("duplicate_in_file", "email")
            continue
        seen.add(row.email)

        if not row.first_name:
            row.fail("missing_name", "name")
            continue

        too_long = next((f for f in TEXT_FIELDS if len(getattr(row, f)) > MAX_LENGTH[f]), None)
        if too_long:
            row.fail("too_long", too_long)
            continue

        try:
            row.date_of_birth = parse_date(raw.get("date_of_birth"), "date_of_birth")
        except ValidationError:
            row.fail("invalid_date", "date_of_birth")
            continue

        if row.country:
            code = country_code_for(row.country)
            if code:
                row.country = code
            else:
                row.warnings.append("country_unrecognised")
    return rows


def import_students(school, raw_rows: list[dict], *, dry_run: bool, default_language: str, phone_prefix: str | None = None) -> dict:
    """Plan (and unless ``dry_run``, apply) the import of ``raw_rows`` into
    ``school``. Returns the per-row outcome plus a summary. Sends nothing."""
    from accounts.models import Role, User
    from schools.models import SchoolStudent

    from .models import Student

    default_language = clamp_locale(default_language)
    if phone_prefix is None:
        phone_prefix = school_dial_code(school)
    rows = normalize_rows(raw_rows, default_language, phone_prefix)

    valid = [r for r in rows if not r.error]
    users = {
        u.email_l: u
        for u in User.objects.annotate(email_l=Lower("email")).filter(email_l__in=[r.email for r in valid])
    }
    students = {s.user_id: s for s in Student.objects.filter(user_id__in=[u.pk for u in users.values()])}
    enrolled = set(
        SchoolStudent.objects.filter(school=school, student_id__in=[s.pk for s in students.values()])
        .values_list("student_id", flat=True)
    )

    for row in valid:
        user = users.get(row.email)
        if user is None:
            row.action = "create"
            continue
        student = students.get(user.pk)
        if student is not None:
            row.student_id = str(student.pk)
        row.action = "already_enrolled" if student is not None and student.pk in enrolled else "enroll"

    if not dry_run:
        now = timezone.now()
        with transaction.atomic():
            for row in valid:
                if row.action == "create":
                    user = User(
                        email=row.email, first_name=row.first_name, last_name=row.last_name,
                        role=Role.STUDENT, roles=[Role.STUDENT], language_preference=row.language_preference,
                        phone=row.phone, city=row.city,
                    )
                    user.set_unusable_password()
                    user.save()
                    student = Student.objects.create(
                        user=user, first_name=row.first_name, last_name=row.last_name, email=row.email,
                        phone=row.phone, date_of_birth=row.date_of_birth, address=row.address, city=row.city,
                        postal_code=row.postal_code, province=row.province, country=row.country,
                        language_preference=row.language_preference, school=school,
                    )
                    SchoolStudent.objects.create(school=school, student=student, imported_at=now)
                    row.student_id = str(student.pk)
                elif row.action == "enroll":
                    user = users[row.email]
                    student = students.get(user.pk)
                    if student is None:
                        # Same as /auth/become-student/: the account gains the
                        # student profile; the file fills what the account lacks.
                        student = Student.objects.create(
                            user=user, first_name=user.first_name or row.first_name,
                            last_name=user.last_name or row.last_name, email=user.email,
                            phone=user.phone or row.phone, date_of_birth=row.date_of_birth, address=row.address,
                            city=user.city or row.city, postal_code=row.postal_code, province=row.province,
                            country=row.country, language_preference=user.language_preference or row.language_preference,
                            school=school,
                        )
                    elif student.school_id is None:
                        student.school = school
                        student.save(update_fields=["school"])
                    if Role.STUDENT not in (user.roles or []):
                        user.roles = [*(user.roles or []), Role.STUDENT]
                        user.save(update_fields=["roles"])
                    SchoolStudent.objects.get_or_create(
                        school=school, student=student, defaults={"imported_at": now},
                    )
                    row.student_id = str(student.pk)
        logger.info(
            "student import school=%s created=%d enrolled=%d skipped=%d errors=%d",
            school.id, *(sum(1 for r in rows if r.action == a) for a in ("create", "enroll", "already_enrolled", "error")),
        )

    return {
        "dry_run": dry_run,
        "summary": {
            "create": sum(1 for r in rows if r.action == "create"),
            "enroll": sum(1 for r in rows if r.action == "enroll"),
            "already_enrolled": sum(1 for r in rows if r.action == "already_enrolled"),
            "error": sum(1 for r in rows if r.action == "error"),
        },
        "rows": [r.as_dict() for r in rows],
    }


# --- the "set your password" e-mail ---------------------------------------------


def email_possible(key: str, locale: str) -> bool:
    """Whether an e-mail with this key will actually leave (HQ > Emails switch
    and a template to render), so callers report it honestly instead of
    promising an e-mail nobody receives (QA R2-H15)."""
    from notifications.builtin_templates import has_builtin
    from notifications.emails import get_template, is_enabled

    return is_enabled(key) and (get_template(key, locale=locale) is not None or has_builtin(key))


def password_email_kind(user) -> str:
    """`invite` for an account that never chose a password (imported, or added
    by the school): the school invitation with the setup link. `reset` for an
    account with a password of its own: the ordinary reset -- a setup link
    would read as "the school reset my credentials" (SCH-R4-05)."""
    return "reset" if user.has_usable_password() else "invite"


def queue_password_email(student, school, *, locale: str | None = None) -> str | None:
    """Queue, after commit, the e-mail that lets ``student`` set her password.
    Returns the kind sent (`invite` / `reset`) or None when that e-mail is
    switched off in HQ > Emails."""
    from django.conf import settings
    from django.contrib.auth.tokens import default_token_generator
    from django.utils.encoding import force_bytes
    from django.utils.http import urlsafe_base64_encode

    from notifications.tasks import send_transactional_email_task

    user = student.user
    locale = clamp_locale(locale or user.language_preference or student.language_preference)
    kind = password_email_kind(user)
    key = INVITE_EMAIL_KEY if kind == "invite" else PASSWORD_RESET_KEY
    if not email_possible(key, locale):
        return None

    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    name = student.name or user.full_name or user.email
    first_name = student.first_name or user.first_name_display
    if kind == "invite":
        context = {
            "student_name": name, "student_first_name": first_name, "school_name": school.name,
            "setup_url": f"{settings.FRONTEND_URL}/{locale}/setup-account?uid={uid}&token={token}",
            "platform_name": "No Under 40",
        }
    else:
        context = {
            "user_name": name, "user_first_name": first_name,
            "reset_url": f"{settings.FRONTEND_URL}/{locale}/reset-password?uid={uid}&token={token}",
            "platform_name": "No Under 40",
        }
    transaction.on_commit(partial(
        send_transactional_email_task.delay,
        to_email=user.email, to_name=name, key=key, context=context, locale=locale, school_id=str(school.id),
    ))
    return kind


def send_password_emails(school, student_ids: list) -> dict:
    """The bulk action of the Students page: one password e-mail per selected
    student enrolled at ``school`` (ids from elsewhere are ignored, not an
    error). Counts what left and what did not."""
    from .models import Student

    ids = list(dict.fromkeys(student_ids))
    students = Student.objects.filter(pk__in=ids, school_links__school=school).select_related("user").distinct()
    counts = {"invite": 0, "reset": 0, "off": 0}
    with transaction.atomic():
        for student in students:
            counts[queue_password_email(student, school) or "off"] += 1
    found = counts["invite"] + counts["reset"] + counts["off"]
    return {
        "requested": len(ids),
        "sent": counts["invite"] + counts["reset"],
        "invites": counts["invite"],
        "resets": counts["reset"],
        "switched_off": counts["off"],
        "not_found": len(ids) - found,
    }
