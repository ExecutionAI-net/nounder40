"""School-side bulk import of students from a mapped spreadsheet
(students/services.py, POST /api/school/students/import/).

The preview (dry run) and the real import share one code path; these tests
pin what a row becomes -- a new account, an enrollment of an existing one, a
skip, or an error that never blocks the other rows -- that phone numbers get
their international prefix, and that the import itself sends no e-mail.
"""
import uuid
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from schools.models import School, SchoolMembership, SchoolRole, SchoolStudent
from students.models import Student
from students.services import MAX_ROWS, normalize_phone

pytestmark = pytest.mark.django_db
User = get_user_model()
URL = "/api/school/students/import/"


def _school(name="Danza Barcelona", country="Italy"):
    from core import section_guard

    SchoolRole.objects.update_or_create(key="admin", defaults={"label": "Admin", "builtin": True, "permissions": ["students"]})
    # The section guard caches the role matrix for 30s: a snapshot taken by an
    # earlier test module (where "admin" may carry other sections) must not
    # decide this one.
    section_guard._matrix_cache["expires"] = 0.0
    return School.objects.create(
        name=name, slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com", language="it",
        country=country, active=True,  # the section guard answers 403 for a deactivated school
    )


def _client(school, sub_role="admin"):
    user = User.objects.create(
        email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school=school, language_preference="it",
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role=sub_role)
    # A real JWT: the school section guard is middleware and reads the token
    # itself, so force_authenticate would slip past the matrix it enforces.
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


def _student(school, email, password=None):
    user = User.objects.create(email=email, role=Role.STUDENT, roles=[Role.STUDENT], first_name="Ivana", last_name="Argentieri")
    if password:
        user.set_password(password)
    else:
        user.set_unusable_password()
    user.save()
    student = Student.objects.create(user=user, first_name="Ivana", last_name="Argentieri", email=email, phone="+39 320 0000000", school=school)
    SchoolStudent.objects.create(school=school, student=student)
    return student


ROWS = [
    {"row": 2, "name": "Gina Schimkovits", "email": "GinaBlues@yahoo.it", "phone": "'+393487258699", "country": "Italy"},
    {"row": 3, "first_name": "Ivana", "last_name": "Argentieri", "email": "ivana.argentieri@gmail.com", "date_of_birth": "1975-04-12", "language_preference": "es"},
]


def test_dry_run_plans_without_writing():
    school = _school()
    res = _client(school).post(URL, {"rows": ROWS, "dry_run": True}, format="json")
    assert res.status_code == 200, res.content
    body = res.json()
    assert body["dry_run"] is True
    assert body["summary"] == {"create": 2, "enroll": 0, "already_enrolled": 0, "error": 0}
    assert [r["action"] for r in body["rows"]] == ["create", "create"]
    assert not User.objects.filter(email="ginablues@yahoo.it").exists()
    assert not Student.objects.exists()


def test_import_creates_account_profile_and_enrollment():
    school = _school()
    res = _client(school).post(URL, {"rows": ROWS, "dry_run": False}, format="json")
    assert res.status_code == 200, res.content
    body = res.json()
    assert body["summary"]["create"] == 2

    user = User.objects.get(email="ginablues@yahoo.it")  # lowercased
    assert user.roles == [Role.STUDENT] and user.role == Role.STUDENT
    assert not user.has_usable_password()
    student = user.student
    # "Gina Schimkovits" in one column -> first/last, and Student.save recomposes name
    assert (student.first_name, student.last_name, student.name) == ("Gina", "Schimkovits", "Gina Schimkovits")
    assert student.phone == "+39 3487258699"  # Excel's text marker stripped, prefix set apart
    assert student.country == "IT"  # free text resolved to the ISO code the app stores
    assert student.school_id == school.id
    # language: the wizard default (here the admin's, "it") unless the row has its own
    assert student.language_preference == "it"
    link = SchoolStudent.objects.get(school=school, student=student)
    assert link.imported_at is not None  # the school can tell imported rows apart
    # the page pre-selects the imported students for the password e-mail
    assert body["rows"][0]["student_id"] == str(student.pk)

    ivana = Student.objects.get(email="ivana.argentieri@gmail.com")
    assert ivana.language_preference == "es"
    assert str(ivana.date_of_birth) == "1975-04-12"


def test_import_sends_no_email(django_capture_on_commit_callbacks):
    """Carlo, 16/09/2026: the invitation is a separate, deliberate step from
    the list -- importing 300 contacts must not mail 300 people."""
    school = _school()
    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, django_capture_on_commit_callbacks(execute=True):
        res = _client(school).post(URL, {"rows": ROWS, "dry_run": False}, format="json")
    assert res.status_code == 200
    delayed.assert_not_called()


def test_existing_student_of_another_school_is_only_enrolled():
    school, other = _school(), _school("Other")
    existing = _student(other, "ivana.argentieri@gmail.com", password="Danza-2026")
    rows = [{"row": 2, "name": "Somebody Else", "email": "Ivana.Argentieri@gmail.com", "phone": "+39 999", "city": "Roma"}]

    preview = _client(school).post(URL, {"rows": rows, "dry_run": True}, format="json").json()
    assert preview["rows"][0]["action"] == "enroll"
    assert preview["rows"][0]["student_id"] == str(existing.pk)

    res = _client(school).post(URL, {"rows": rows, "dry_run": False}, format="json")
    assert res.status_code == 200 and res.json()["summary"] == {"create": 0, "enroll": 1, "already_enrolled": 0, "error": 0}
    link = SchoolStudent.objects.get(school=school, student=existing)
    assert link.imported_at is not None
    existing.refresh_from_db()
    # her profile is hers: the file does not overwrite it
    assert (existing.first_name, existing.last_name, existing.phone, existing.city) == ("Ivana", "Argentieri", "+39 320 0000000", "")
    assert existing.school_id == other.id
    assert User.objects.filter(email__iexact="ivana.argentieri@gmail.com").count() == 1


def test_already_enrolled_rows_are_skipped_and_reported():
    school = _school()
    existing = _student(school, "ivana.argentieri@gmail.com")
    res = _client(school).post(URL, {"rows": ROWS, "dry_run": False}, format="json")
    body = res.json()
    assert body["summary"] == {"create": 1, "enroll": 0, "already_enrolled": 1, "error": 0}
    assert body["rows"][1]["action"] == "already_enrolled"
    assert Student.objects.count() == 2
    # an enrollment the student made herself is not re-stamped as imported
    assert SchoolStudent.objects.get(school=school, student=existing).imported_at is None


def test_teacher_account_gains_the_student_profile_when_enrolled():
    school = _school()
    teacher = User.objects.create(email="alessia@example.com", role=Role.TEACHER, roles=[Role.TEACHER], first_name="Alessia", last_name="Rossi", phone="+39 333")
    teacher.set_password("Danza-2026")
    teacher.save()
    rows = [{"row": 2, "name": "Alessia R.", "email": "alessia@example.com", "city": "Barcelona"}]
    res = _client(school).post(URL, {"rows": rows, "dry_run": False}, format="json")
    assert res.json()["rows"][0]["action"] == "enroll"
    teacher.refresh_from_db()
    assert Role.STUDENT in teacher.roles and Role.TEACHER in teacher.roles
    student = teacher.student
    # the account's own data wins, the file fills what it lacks
    assert (student.first_name, student.last_name, student.phone, student.city) == ("Alessia", "Rossi", "+39 333", "Barcelona")
    assert SchoolStudent.objects.filter(school=school, student=student).exists()


def test_bad_rows_are_reported_and_do_not_block_the_others():
    school = _school()
    rows = [
        {"row": 2, "name": "No Email"},
        {"row": 3, "name": "Bad Email", "email": "not-an-email"},
        {"row": 4, "email": "nameless@example.com"},
        {"row": 5, "name": "Gina Schimkovits", "email": "gina@example.com"},
        {"row": 6, "name": "Gina Again", "email": "GINA@example.com"},
        {"row": 7, "name": "Bad Date", "email": "date@example.com", "date_of_birth": "12/04/1975"},
        {"row": 8, "name": "Long Address", "email": "long@example.com", "address": "x" * 256},
    ]
    res = _client(school).post(URL, {"rows": rows, "dry_run": False}, format="json")
    body = res.json()
    errors = {r["row"]: (r["error"], r["error_field"]) for r in body["rows"] if r["action"] == "error"}
    assert errors == {
        2: ("missing_email", "email"), 3: ("invalid_email", "email"), 4: ("missing_name", "name"),
        6: ("duplicate_in_file", "email"), 7: ("invalid_date", "date_of_birth"), 8: ("too_long", "address"),
    }
    assert body["summary"]["create"] == 1 and body["summary"]["error"] == 6
    assert User.objects.filter(email="gina@example.com").exists()
    assert not User.objects.filter(email__in=["date@example.com", "long@example.com", "nameless@example.com"]).exists()


def test_unknown_country_is_kept_with_a_warning():
    school = _school()
    rows = [{"row": 2, "name": "Gina S", "email": "gina@example.com", "country": "Atlantide"}]
    body = _client(school).post(URL, {"rows": rows, "dry_run": False}, format="json").json()
    assert body["rows"][0]["warnings"] == ["country_unrecognised"]
    assert Student.objects.get(email="gina@example.com").country == "Atlantide"


@pytest.mark.parametrize("raw, prefix, expected", [
    ("'+393487258699", "+39", "+39 3487258699"),    # Excel text marker, prefix already there
    ("+39 348 725 8699", "+39", "+39 3487258699"),   # spaces inside the number
    ("3487258699", "+39", "+39 3487258699"),         # bare national number
    ("348 7258699", "39", "+39 3487258699"),         # prefix passed as digits
    (393487258699, "+39", "+39 3487258699"),         # stored as a number: Excel dropped the "+"
    ("0039 348 7258699", "+39", "+39 3487258699"),   # 00 international form
    ("06 1234567", "+39", "+39 061234567"),          # Italy keeps the trunk 0
    ("+34 612 345 678", "+39", "+34 612345678"),     # another country the platform knows: its own code apart
    ("0034612345678", "+39", "+34 612345678"),
    ("+1 787 555 0100", "+39", "+1787 5550100"),     # longest known code wins (Puerto Rico, not the US)
    ("+999 123456", "+39", "+999123456"),            # unknown code: kept whole rather than split wrong
    ("0612345678", "+33", "+33 612345678"),          # France drops the trunk 0
    ("06 12 34 56 78", "+33", "+33 612345678"),
    ("07123 456789", "+44", "+44 7123456789"),
    ("3487258699", "", "3487258699"),                # no prefix known: digits, untouched
    ("n.d.", "+39", "n.d."),                         # no digits: kept as typed, the preview shows it
    ("", "+39", ""),
    (None, "+39", ""),
])
def test_normalize_phone(raw, prefix, expected):
    assert normalize_phone(raw, prefix) == expected


def test_phone_prefix_defaults_to_the_school_country():
    school = _school(country="Spain")
    rows = [
        {"row": 2, "name": "Marta Puig", "email": "marta@example.com", "phone": "612 345 678"},
        {"row": 3, "name": "Gina S", "email": "gina@example.com", "phone": "+39 348 7258699"},
    ]
    body = _client(school).post(URL, {"rows": rows, "dry_run": False}, format="json").json()
    assert [r["phone"] for r in body["rows"]] == ["+34 612345678", "+39 3487258699"]
    assert Student.objects.get(email="marta@example.com").phone == "+34 612345678"


def test_phone_prefix_from_the_wizard_wins():
    school = _school(country="Spain")
    rows = [{"row": 2, "name": "Gina S", "email": "gina@example.com", "phone": "3487258699"}]
    body = _client(school).post(URL, {"rows": rows, "dry_run": True, "phone_prefix": "+39"}, format="json").json()
    assert body["rows"][0]["phone"] == "+39 3487258699"
    assert _client(school).post(URL, {"rows": rows, "phone_prefix": ["+39"]}, format="json").status_code == 400


def test_payload_guards():
    school = _school()
    api = _client(school)
    assert api.post(URL, {"rows": []}, format="json").status_code == 400
    assert api.post(URL, {"rows": "nope"}, format="json").status_code == 400
    assert api.post(URL, {"rows": ["nope"]}, format="json").status_code == 400
    too_many = [{"row": i, "name": "x", "email": f"u{i}@example.com"} for i in range(MAX_ROWS + 1)]
    res = api.post(URL, {"rows": too_many, "dry_run": True}, format="json")
    assert res.status_code == 400 and res.json()["error"] == "too_many_rows"


def test_staff_without_the_students_section_is_refused():
    from core import section_guard

    school = _school()
    SchoolRole.objects.update_or_create(key="staff", defaults={"label": "Staff", "builtin": True, "permissions": ["lessons"]})
    section_guard._matrix_cache["expires"] = 0.0  # the role changed after _school() reset it
    res = _client(school, sub_role="staff").post(URL, {"rows": ROWS, "dry_run": True}, format="json")
    assert res.status_code == 403
    assert not User.objects.filter(email="ginablues@yahoo.it").exists()

