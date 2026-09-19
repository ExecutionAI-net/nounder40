"""The school's hand-made deductions on one package and their reversal
(students/credit_movements.py): POST /api/school/credits/deduct/ and
POST /api/school/credits/deductions/<id>/reverse/. The mirror of the manual
grant: same ledger (ManualCreditGrant.kind), same wallet, same rules as a
booking. The student sees the movement in her credit history, never the
school's note."""
import uuid
from datetime import datetime, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from catalog.models import Course, LessonType, Package
from schools.models import School, SchoolMembership, SchoolRole, SchoolStudent
from students.models import ManualCreditGrant, Student, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()
DEDUCT_URL = "/api/school/credits/deduct/"


def _school():
    from core import section_guard

    # A real role holding the sections these URLs sit in (credits/ →
    # manualCredits, student-usage/ → students): the section guard is
    # middleware that reads the JWT itself. Its 30s cache may hold another
    # module's snapshot of "admin".
    SchoolRole.objects.update_or_create(
        key="admin", defaults={"label": "Admin", "builtin": True, "permissions": ["students", "manualCredits"]}
    )
    section_guard._matrix_cache["expires"] = 0.0
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", timezone="Europe/Rome", active=True,
    )


def _student(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT])
    student = Student.objects.create(user=user, name="Anna", school=school)
    SchoolStudent.objects.create(school=school, student=student)
    return student


def _package(student, school, *, in_lessons=True, credits="10.0"):
    """A bought package. `in_lessons`: a catalog row covering one lesson type
    whose only course costs 1.5, so the package can be told in lessons;
    otherwise credits without a catalog row (a manual grant), credits only."""
    catalog = None
    if in_lessons:
        lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
        Course.objects.create(school=school, lesson_type=lt, credit_cost=Decimal("1.5"), min_booking_notice_hours=0)
        catalog = Package.objects.create(
            school=school, credits=Decimal(credits), name_en="Ten", name_it="Dieci", allowed_lesson_types=[str(lt.id)]
        )
    return StudentPackage.objects.create(
        student=student, school=school, package=catalog, credits_total=Decimal(credits), credits_remaining=Decimal(credits),
        status="active", purchased_at=datetime(2027, 1, 1, tzinfo=dt_timezone.utc),
        expires_at=datetime(2028, 1, 1, tzinfo=dt_timezone.utc),
    )


def _client_for(user):
    client = APIClient()  # a real JWT: force_authenticate would slip past the section guard
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def _school_client(school):
    user = User.objects.create(
        email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
        first_name="Marta", last_name="Staff",
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="admin")
    return _client_for(user)


def _reverse_url(movement_id):
    return f"/api/school/credits/deductions/{movement_id}/reverse/"


def test_deduct_in_lessons_writes_the_ledger_and_the_student_history():
    school = _school()
    anna = _student(school)
    sp = _package(anna, school)
    client = _school_client(school)

    res = client.post(DEDUCT_URL, {"student_package_id": str(sp.id), "lessons": 2, "note": "3 and 10 Sep, before activation"}, format="json")
    assert res.status_code == 201, res.content
    body = res.json()
    assert Decimal(body["credits_remaining"]) == Decimal("7.0") and body["status"] == "active"
    assert body["movement"]["kind"] == "deduction" and body["movement"]["lessons"] == 2
    assert Decimal(body["movement"]["amount"]) == Decimal("3.0")
    sp.refresh_from_db()
    assert sp.credits_remaining == Decimal("7.0")

    row = ManualCreditGrant.objects.get(package=sp)
    assert row.kind == "deduction" and row.amount == Decimal("3.0") and row.note == "3 and 10 Sep, before activation"
    assert row.granted_by is not None and row.student_id == anna.id and row.package_name == "Ten"

    # The school's ledger of the package carries it, in lessons, with author
    ledger = client.get(f"/api/school/student-usage/packages/{sp.id}/").json()
    (m,) = ledger["movements"]
    assert m["id"] == str(row.id) and m["lessons"] == 2 and m["by"] == "Marta Staff" and m["reversed"] is False
    assert Decimal(ledger["package"]["credits_remaining"]) == Decimal("7.0")

    # The student sees the movement, minus its credits, never the note
    hist = _client_for(anna.user).get("/api/student/credit-history/").json()
    (entry,) = [e for e in hist if e["type"] == "school_deduction"]
    assert Decimal(entry["credits"]) == Decimal("-3.0") and entry["student_package_id"] == str(sp.id)
    assert entry["school_id"] == str(school.id) and "note" not in entry and "Sep" not in str(entry)


def test_deduct_in_credits_when_the_package_has_no_lesson_cost():
    school = _school()
    anna = _student(school)
    sp = _package(anna, school, in_lessons=False)
    client = _school_client(school)

    res = client.post(DEDUCT_URL, {"student_package_id": str(sp.id), "lessons": 1}, format="json")
    assert res.status_code == 400 and res.json()["error"] == "package_not_in_lessons"

    res = client.post(DEDUCT_URL, {"student_package_id": str(sp.id), "amount": "2.5"}, format="json")
    assert res.status_code == 201, res.content
    assert res.json()["movement"]["lessons"] is None
    sp.refresh_from_db()
    assert sp.credits_remaining == Decimal("7.5")

    res = client.post(DEDUCT_URL, {"student_package_id": str(sp.id), "amount": "0.3"}, format="json")
    assert res.status_code == 400 and res.json()["error"] == "amount_not_half_credit_step"


def test_never_below_zero_and_exhausted_at_zero():
    school = _school()
    anna = _student(school)
    sp = _package(anna, school)
    client = _school_client(school)

    res = client.post(DEDUCT_URL, {"student_package_id": str(sp.id), "lessons": 7}, format="json")  # 10.5 > 10
    assert res.status_code == 400 and res.json()["error"] == "amount_exceeds_remaining"
    sp.refresh_from_db()
    assert sp.credits_remaining == Decimal("10.0") and not ManualCreditGrant.objects.exists()

    res = client.post(DEDUCT_URL, {"student_package_id": str(sp.id), "amount": "10"}, format="json")
    assert res.status_code == 201, res.content
    sp.refresh_from_db()
    assert sp.credits_remaining == Decimal("0") and sp.status == "exhausted"

    res = client.post(DEDUCT_URL, {"student_package_id": str(sp.id), "amount": "0.5"}, format="json")
    assert res.status_code == 400 and res.json()["error"] == "package_not_active"


def test_reverse_puts_the_credits_back_once():
    school = _school()
    anna = _student(school)
    sp = _package(anna, school)
    client = _school_client(school)
    deduction_id = client.post(DEDUCT_URL, {"student_package_id": str(sp.id), "amount": "10"}, format="json").json()["movement"]["id"]
    sp.refresh_from_db()
    assert sp.status == "exhausted"

    res = client.post(_reverse_url(deduction_id), format="json")
    assert res.status_code == 201, res.content
    assert res.json()["movement"]["kind"] == "reversal" and res.json()["status"] == "active"
    sp.refresh_from_db()
    assert sp.credits_remaining == Decimal("10.0") and sp.status == "active"
    reversal = ManualCreditGrant.objects.get(kind="reversal")
    assert str(reversal.reverses_id) == deduction_id and reversal.amount == Decimal("10.0")

    # Both rows stay in the ledger; the deduction is marked as undone
    ledger = client.get(f"/api/school/student-usage/packages/{sp.id}/").json()
    kinds = {m["kind"]: m for m in ledger["movements"]}
    assert set(kinds) == {"deduction", "reversal"} and kinds["deduction"]["reversed"] is True

    res = client.post(_reverse_url(deduction_id), format="json")
    assert res.status_code == 400 and res.json()["error"] == "already_reversed"
    sp.refresh_from_db()
    assert sp.credits_remaining == Decimal("10.0")

    # The student's history shows both movements, netting to zero
    hist = _client_for(anna.user).get("/api/student/credit-history/").json()
    moves = {e["type"]: Decimal(e["credits"]) for e in hist if e["type"].startswith("school_deduction")}
    assert moves == {"school_deduction": Decimal("-10.0"), "school_deduction_reversed": Decimal("10.0")}


def test_another_schools_package_is_not_found():
    school, other = _school(), School.objects.create(
        name="O", slug=f"o-{uuid.uuid4().hex[:8]}", email="o@example.com", timezone="Europe/Rome", active=True,
    )
    anna = _student(other)
    sp = _package(anna, other, in_lessons=False)

    res = _school_client(school).post(DEDUCT_URL, {"student_package_id": str(sp.id), "amount": "1"}, format="json")
    assert res.status_code == 404
    sp.refresh_from_db()
    assert sp.credits_remaining == Decimal("10.0")


def test_reverse_is_refused_on_an_expired_package():
    school = _school()
    anna = _student(school)
    sp = _package(anna, school)
    client = _school_client(school)
    deduction_id = client.post(DEDUCT_URL, {"student_package_id": str(sp.id), "lessons": 2}, format="json").json()["movement"]["id"]
    StudentPackage.objects.filter(pk=sp.pk).update(status="expired")  # e.g. the recurring package was cancelled

    res = client.post(_reverse_url(deduction_id), format="json")
    assert res.status_code == 400 and res.json()["error"] == "package_not_active"
    sp.refresh_from_db()
    assert sp.credits_remaining == Decimal("7.0") and not ManualCreditGrant.objects.filter(kind="reversal").exists()


def test_a_note_that_is_not_text_is_a_400_not_a_500():
    school = _school()
    sp = _package(_student(school), school)

    res = _school_client(school).post(DEDUCT_URL, {"student_package_id": str(sp.id), "lessons": 1, "note": 123}, format="json")
    assert res.status_code == 400 and res.json()["error"] == "note_invalid"
    sp.refresh_from_db()
    assert sp.credits_remaining == Decimal("10.0")
