"""The school's hand-made movements on ONE bought package, from the usage
modal: take lessons (or credits) off it, and undo that.

The mirror of the manual grant (school_views.CreditGrantView): the same
ledger row (ManualCreditGrant, told apart by `kind`), the same wallet, the
same rules as a booking — half-credit steps, never below zero, `exhausted`
at zero and back to `active` on reversal. No booking is created: bookings
drive attendance, capacity, e-mails and teacher pay, and a booking without
a lesson would pollute all four. The note is the school's own; the student
sees only the movement (students/views.StudentCreditHistoryView)."""
from decimal import Decimal

from django.db import transaction
from django.db.models import F
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.services import course_cost_index, lessons_for, student_package_lessons
from students.models import ManualCreditGrant, StudentPackage
from students.school_views import _caller_school, ensure_object_body, parse_decimal, parse_uuid


def movement_row(m: ManualCreditGrant, cost, reversed_ids: set) -> dict:
    """One ledger row for the usage modal. Lessons only when the package has
    a per-lesson cost (the same rule as its card) AND the amount is a whole
    number of them; credits always."""
    in_lessons = cost is not None and m.amount % cost == 0
    return {
        "id": str(m.id),
        "kind": m.kind,
        "amount": m.amount,
        "lessons": lessons_for(m.amount, cost) if in_lessons else None,
        "note": m.note,
        "by": (m.granted_by.full_name or m.granted_by.email) if m.granted_by_id else "",
        "at": m.created_at,
        "reversed": m.id in reversed_ids,
        "reverses": str(m.reverses_id) if m.reverses_id else None,
    }


def _lesson_cost(sp: StudentPackage, school_id):
    return student_package_lessons(sp, course_cost_index([school_id]))[0]


def _note(body) -> str | None:
    """The school's note: a string (or nothing), trimmed and bounded; None
    when the client sent some other JSON type (a 400, not a 500)."""
    note = body.get("note")
    if note is None:
        return ""
    if not isinstance(note, str):
        return None
    return note.strip()[:1000]


class CreditDeductView(APIView):
    """POST /api/school/credits/deduct/ — {student_package_id, lessons | amount,
    note}. `lessons` is converted with the package's own per-lesson cost
    (400 package_not_in_lessons when it has none: mixed costs, unlimited,
    credits without a catalog row); `amount` is credits in half steps.
    Refused above the credits left (amount_exceeds_remaining) and on a
    package that is not active. HQ may pass ?school=."""

    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        school = _caller_school(request)
        body = ensure_object_body(request.data)
        # Locked for the arithmetic below; no select_related here — Postgres
        # refuses FOR UPDATE over the outer join a nullable FK would add.
        sp = (
            StudentPackage.objects.select_for_update()
            .filter(pk=parse_uuid(body.get("student_package_id"), "student_package_id"), school=school)
            .first()
        )
        if sp is None:
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)
        if sp.status != StudentPackage.Status.ACTIVE:
            return Response({"error": "package_not_active"}, status=status.HTTP_400_BAD_REQUEST)

        cost = _lesson_cost(sp, school.id)
        if body.get("lessons") not in (None, ""):
            # A whole number, however JSON spelled it (2, "2", 2.0)
            lessons_dec = parse_decimal(body.get("lessons"), "lessons", default=Decimal("0"))
            if lessons_dec <= 0 or lessons_dec != lessons_dec.to_integral_value():
                return Response({"error": "lessons_invalid"}, status=status.HTTP_400_BAD_REQUEST)
            lessons = int(lessons_dec)
            if cost is None:
                return Response({"error": "package_not_in_lessons"}, status=status.HTTP_400_BAD_REQUEST)
            amount = Decimal(lessons) * cost
        else:
            amount = parse_decimal(body.get("amount", 0), "amount", default=Decimal("0"))
        # The same three checks as the manual grant (CreditGrantView).
        if amount <= 0:
            return Response({"error": "amount must be positive"}, status=status.HTTP_400_BAD_REQUEST)
        if amount > Decimal("99999.9"):
            return Response({"error": "amount_too_large"}, status=status.HTTP_400_BAD_REQUEST)
        if amount % Decimal("0.5") != 0:
            return Response({"error": "amount_not_half_credit_step"}, status=status.HTTP_400_BAD_REQUEST)
        if amount > sp.credits_remaining:
            return Response({"error": "amount_exceeds_remaining"}, status=status.HTTP_400_BAD_REQUEST)
        note = _note(body)
        if note is None:
            return Response({"error": "note_invalid"}, status=status.HTTP_400_BAD_REQUEST)

        StudentPackage.objects.filter(pk=sp.pk).update(credits_remaining=F("credits_remaining") - amount)
        StudentPackage.objects.filter(pk=sp.pk, credits_remaining__lte=0).update(status=StudentPackage.Status.EXHAUSTED)
        movement = ManualCreditGrant.objects.create(
            school=school, student=sp.student, package=sp, kind=ManualCreditGrant.Kind.DEDUCTION,
            # One spelling per package whoever deducts (the credits page groups
            # and filters on this column): the catalog's English name.
            package_name=sp.package.localized_name("en") if sp.package_id else "",
            granted_by=request.user, amount=amount, note=note,
        )
        sp.refresh_from_db(fields=["credits_remaining", "status"])
        return Response(
            {"movement": movement_row(movement, cost, set()), "credits_remaining": sp.credits_remaining, "status": sp.status},
            status=status.HTTP_201_CREATED,
        )


class CreditDeductionReverseView(APIView):
    """POST /api/school/credits/deductions/<pk>/reverse/ — undo one deduction:
    the credits go back to the SAME package (active again if that had
    drained it), logged as a reversal row pointing at the deduction. Once
    only (already_reversed); the ledger keeps both rows."""

    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        school = _caller_school(request)
        original = (
            ManualCreditGrant.objects.select_for_update()
            .filter(pk=pk, school=school, kind=ManualCreditGrant.Kind.DEDUCTION)
            .first()
        )
        if original is None:
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)
        if ManualCreditGrant.objects.filter(reverses=original).exists():
            return Response({"error": "already_reversed"}, status=status.HTTP_400_BAD_REQUEST)
        if original.package_id is None:
            return Response({"error": "package_gone"}, status=status.HTTP_400_BAD_REQUEST)
        # Credits go back only where they can still be spent: an expired (or
        # cancelled) package would just strand them.
        sp_id = original.package_id
        current_status = StudentPackage.objects.filter(pk=sp_id).values_list("status", flat=True).first()
        if current_status not in (StudentPackage.Status.ACTIVE, StudentPackage.Status.EXHAUSTED):
            return Response({"error": "package_not_active"}, status=status.HTTP_400_BAD_REQUEST)
        body = ensure_object_body(request.data) if request.data else {}
        note = _note(body)
        if note is None:
            return Response({"error": "note_invalid"}, status=status.HTTP_400_BAD_REQUEST)

        StudentPackage.objects.filter(pk=sp_id).update(credits_remaining=F("credits_remaining") + original.amount)
        StudentPackage.objects.filter(
            pk=sp_id, status=StudentPackage.Status.EXHAUSTED, credits_remaining__gt=0
        ).update(status=StudentPackage.Status.ACTIVE)
        reversal = ManualCreditGrant.objects.create(
            school=school, student=original.student, package_id=sp_id, kind=ManualCreditGrant.Kind.REVERSAL,
            reverses=original, package_name=original.package_name, granted_by=request.user,
            amount=original.amount, note=note,
        )
        sp = StudentPackage.objects.get(pk=sp_id)
        return Response(
            {
                "movement": movement_row(reversal, _lesson_cost(sp, school.id), {original.id}),
                "credits_remaining": sp.credits_remaining,
                "status": sp.status,
            },
            status=status.HTTP_201_CREATED,
        )
