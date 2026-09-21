"""Moving a package's expiry AFTER purchase — the one place that does it
(PACKAGE_EXTENSIONS.md). Two reasons, one ledger (StudentPackageExtension):

- a school closure (SchoolClosure.extends_packages): every package valid
  during the closure gets the WHOLE closure length back, in open days after
  its expiry;
- the school extending one student's package by hand, to a day it picks
  (PackageExtendView, from the usage modal).

The expiry is never patched by deltas: `settle()` RECOMPUTES it from the
package's base (its expiry at purchase, or the last hand-picked date) and
the school's calendar, and the ledger rows are refreshed to match. So the
result does not depend on the order closures were recorded, re-dated,
toggled or deleted, and undoing a closure never moves a date the school
chose by hand. Every entry point — a closure saved or deleted, a package
created, a manual extension — ends in the same `settle()`.

"Open days": the days given back skip EVERY day the school is shut for the
whole day (this closure's own tail beyond the old expiry, any other
closure, whether or not it gives days back), otherwise a package expiring
on Dec 31 and given 10 days for a Dec 24 – Jan 2 break would start those
days on Jan 1, with the school still shut. Each closure that gives days
back does so once, when its turn comes in date order; a closure that lands
inside the window only because another one stretched it gets its turn too.
Carlo's example (2026-09-21): bought Dec 1 for one month, closure Dec 24 –
Jan 2 → owed 10 days, Jan 1 and 2 skipped, new expiry Jan 13 (last usable
day Jan 12). All of it in the school's own wall clock, so a DST change
never moves the time of day.

The booking engine already checks `expires_at` against the LESSON's date and
never flips a package to "expired" by itself (bookings/services._active_
package), so moving the date is all it takes — reminders, reports and the
student's page read the same column.

Left alone, on purpose: Stripe-billed subscriptions (`stripe_subscription_id`
set) — their expiry is rewritten by every renewal webhook and the charge date
would have to move too (phase 2, with "renew now"); drop-in and special-event
tickets, whose expiry is the lesson itself; packages with no expiry at all.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.params import ensure_object_body, parse_date, parse_uuid
from schools.models import School, SchoolClosure
from students.models import StudentPackage, StudentPackageExtension

#: statuses whose expiry is worth moving: exhausted too, because a school
#: refund brings an exhausted package back to active with its old expiry
#: (bookings/services.py) and it must then carry the extension.
EXTENDABLE_STATUSES = (StudentPackage.Status.ACTIVE, StudentPackage.Status.EXHAUSTED)


# --- which packages -----------------------------------------------------------

def refusal_code(sp: StudentPackage) -> str | None:
    """Why this package's expiry is not to be moved — the manual endpoint's
    error code — or None. `extendable_q()` is the same rule in SQL."""
    if sp.status not in EXTENDABLE_STATUSES:
        return "package_not_active"
    if sp.expires_at is None:
        return "package_has_no_expiry"
    if sp.stripe_subscription_id:
        return "managed_by_stripe"  # billed by Stripe: phase 2
    if sp.package_id and (sp.package.is_drop_in or sp.package.event_id):
        return "package_not_extendable"  # the ticket's expiry is the lesson
    return None


def is_extendable(sp: StudentPackage) -> bool:
    return refusal_code(sp) is None


def extendable_q() -> Q:
    """refusal_code() as a filter, for the closure batch."""
    return Q(status__in=EXTENDABLE_STATUSES, expires_at__isnull=False, stripe_subscription_id="") & (
        Q(package__isnull=True) | Q(package__is_drop_in=False, package__event__isnull=True)
    )


# --- days ---------------------------------------------------------------------

def closure_length(closure: SchoolClosure) -> int:
    """Calendar days the closure spans, inclusive on both ends."""
    return (closure.last_day - closure.date).days + 1


def days_of(closure: SchoolClosure) -> set[date]:
    return {closure.date + timedelta(days=i) for i in range(closure_length(closure))}


def last_covered_day(expires_at: datetime, tz: ZoneInfo) -> date:
    """The last day a lesson can still fall in: an expiry at midnight covers
    the day BEFORE (a lesson at 10:00 that day is already past it), an expiry
    at 18:30 still covers part of its own day."""
    return (expires_at - timedelta(microseconds=1)).astimezone(tz).date()


def first_covered_day(sp: StudentPackage, tz: ZoneInfo) -> date:
    """Buy-ahead: the window opens at `starts_at`, else at purchase."""
    return (sp.starts_at or sp.purchased_at).astimezone(tz).date()


def add_open_days(expires_at: datetime, days: int, tz: ZoneInfo, closed: set[date]) -> datetime:
    """`expires_at` moved forward so that `days` more days OUTSIDE `closed`
    are covered: a closed day met on the way is skipped, not counted. Walked
    in the school's wall clock (aware arithmetic keeps the time of day and
    lets ZoneInfo re-derive the offset), so a DST change in between never
    shifts the expiry by an hour — which, at midnight or at 23:59:59, is a
    whole covered day."""
    if days <= 0:
        return expires_at
    day = last_covered_day(expires_at, tz)
    added = counted = 0
    while counted < days:  # `closed` is finite: at most days + len(closed) steps
        day += timedelta(days=1)
        added += 1
        if day not in closed:
            counted += 1
    return expires_at.astimezone(tz) + timedelta(days=added)


def touches(closure: SchoolClosure, first: date, last: date) -> bool:
    """The closure falls (even partly) inside the days from `first` to `last`."""
    return closure.date <= last and closure.last_day >= first


@dataclass
class Calendar:
    """A school's closures, loaded once for a batch of packages. `ignore`: a
    closure being deleted — still in the table, no longer on the calendar."""

    school_id: object
    ignore: object = None
    closed: set[date] = field(init=False)
    giving: list[SchoolClosure] = field(init=False)

    def __post_init__(self):
        qs = SchoolClosure.objects.filter(school_id=self.school_id, type=SchoolClosure.Kind.FULL_DAY)
        if self.ignore is not None:
            qs = qs.exclude(pk=self.ignore)
        rows = list(qs.order_by("date", "id"))
        self.closed = set().union(*(days_of(c) for c in rows)) if rows else set()
        self.giving = [c for c in rows if c.extends_packages]


# --- the recompute --------------------------------------------------------------

def settle(sp: StudentPackage, *, by=None, calendar: Calendar | None = None) -> list[StudentPackageExtension]:
    """Recompute `sp.expires_at` from its ledger and the school's calendar,
    and bring the ledger in line. Idempotent; the result does not depend on
    the order anything happened in. Returns the closure rows written anew.

    Base: the last hand-picked date (kind=manual) when there is one, else the
    expiry at purchase (the first row's `expires_before`; `expires_at` itself
    when the ledger is empty). Then every closure that gives days back and
    falls in the window, in date order — each stretching the window for the
    next — gets exactly one live row; a closure the school's date already
    absorbed (its row predates the manual one) is not given again; a live
    row whose closure no longer qualifies or no longer falls in the window
    is revoked. The package row is locked for the duration, so a closure
    batch and a purchase settling the same package take turns."""
    if not is_extendable(sp):
        return []
    with transaction.atomic():
        locked = StudentPackage.objects.select_for_update().only("expires_at").get(pk=sp.pk)
        sp.expires_at = locked.expires_at
        school = sp.school
        tz = school.tzinfo()
        cal = calendar if calendar is not None else Calendar(school.pk)
        rows = list(sp.extensions.order_by("created_at", "id"))
        live = [r for r in rows if r.revoked_at is None]

        # Base: the last hand-picked date, else the expiry at purchase.
        running = rows[0].expires_before if rows else sp.expires_at
        last_manual = -1
        for i, r in enumerate(live):
            if r.kind == StudentPackageExtension.Kind.MANUAL:
                last_manual, running = i, r.expires_after
        # Closure rows older than that date are absorbed in it; the others are
        # replayed (and refreshed) below, or revoked when they no longer hold.
        absorbed: set = set()
        replayable: dict = {}
        stale: list[StudentPackageExtension] = []
        for i, r in enumerate(live):
            if r.kind != StudentPackageExtension.Kind.CLOSURE:
                continue
            if i < last_manual:
                absorbed.add(r.closure_id)
            elif r.closure_id is None:
                stale.append(r)  # orphan: the closure went away behind the ledger's back
            else:
                replayable[r.closure_id] = r

        first = first_covered_day(sp, tz)
        last = last_covered_day(running, tz)
        applied: set = set()
        created: list[StudentPackageExtension] = []
        now = timezone.now()
        for closure in cal.giving:  # date order: a stretched window reaches the next one
            if closure.id in absorbed or not touches(closure, first, last):
                continue
            before = running
            running = add_open_days(running, closure_length(closure), tz, cal.closed)
            last = last_covered_day(running, tz)
            applied.add(closure.id)
            row = replayable.get(closure.id)
            snapshot = dict(
                period_start=closure.date, period_end=closure.last_day, days=closure_length(closure),
                expires_before=before, expires_after=running,
            )
            if row is None:
                created.append(StudentPackageExtension.objects.create(
                    student_package=sp, school=school, kind=StudentPackageExtension.Kind.CLOSURE,
                    closure=closure, note=closure.notes or "", created_by=by, **snapshot,
                ))
            elif any(getattr(row, k) != v for k, v in snapshot.items()):
                for k, v in snapshot.items():
                    setattr(row, k, v)
                row.save(update_fields=list(snapshot))
        for closure_id, row in replayable.items():
            if closure_id not in applied:
                stale.append(row)
        for row in stale:
            row.revoked_at = now
            row.save(update_fields=["revoked_at"])

        if sp.expires_at != running:
            sp.expires_at = running
            sp.save(update_fields=["expires_at"])
    return created


def resettle_school(school_id, *, closure: SchoolClosure | None = None, ignore=None, by=None) -> int:
    """A closure was saved (`closure`) or is being deleted (`ignore`): settle
    every package of the school that can be affected — the ones already
    carrying closure days (the calendar they were computed on changed) and,
    for a closure that gives days back, the ones its days fall into. Returns
    how many packages hold a live row for `closure` afterwards."""
    school = School.objects.get(pk=school_id)
    cal = Calendar(school_id, ignore=ignore)
    ids = set(
        StudentPackageExtension.objects.filter(
            school_id=school_id, kind=StudentPackageExtension.Kind.CLOSURE, revoked_at__isnull=True
        ).values_list("student_package_id", flat=True)
    )
    if closure is not None and ignore is None and any(c.id == closure.id for c in cal.giving):
        tz = school.tzinfo()
        start = datetime.combine(closure.date, datetime.min.time(), tzinfo=tz)
        end = school.end_of_day(closure.last_day)
        ids |= set(
            StudentPackage.objects.filter(extendable_q(), school_id=school_id, expires_at__gt=start)
            .filter(Q(starts_at__lte=end) | Q(starts_at__isnull=True, purchased_at__lte=end))
            .values_list("id", flat=True)
        )
    packages = (
        StudentPackage.objects.filter(pk__in=ids).select_related("package", "school").order_by("expires_at", "id")
    )
    for sp in packages:
        settle(sp, by=by, calendar=cal)
    if closure is None:
        return len(ids)
    return StudentPackageExtension.objects.filter(closure=closure, revoked_at__isnull=True).count()


# --- one student, by hand -------------------------------------------------------

class ExtensionError(Exception):
    def __init__(self, code: str, http_status: int = status.HTTP_400_BAD_REQUEST):
        super().__init__(code)
        self.code = code
        self.http_status = http_status


def extend_manually(sp: StudentPackage, new_expires_at: datetime, *, note: str = "", by=None):
    """The school moves one package's expiry to a date it picked. Forward
    only — a shorter validity would strand lessons already booked. The date
    becomes the package's base: closures that already gave their days are
    absorbed in it, closures that now fall in the window give theirs."""
    code = refusal_code(sp)
    if code is not None:
        raise ExtensionError(code, status.HTTP_409_CONFLICT if code == "managed_by_stripe" else status.HTTP_400_BAD_REQUEST)
    if new_expires_at <= sp.expires_at:
        raise ExtensionError("expiry_not_later")
    tz = sp.school.tzinfo()
    with transaction.atomic():
        row = StudentPackageExtension.objects.create(
            student_package=sp, school_id=sp.school_id, kind=StudentPackageExtension.Kind.MANUAL,
            days=(last_covered_day(new_expires_at, tz) - last_covered_day(sp.expires_at, tz)).days,
            expires_before=sp.expires_at, expires_after=new_expires_at, note=note, created_by=by,
        )
        sp.expires_at = new_expires_at
        sp.save(update_fields=["expires_at"])
        settle(sp, by=by)
    return row


def extension_row(e: StudentPackageExtension) -> dict:
    """One ledger row for the school's usage modal."""
    return {
        "id": str(e.id),
        "kind": e.kind,
        "days": e.days,
        "period_start": e.period_start,
        "period_end": e.period_end,
        "expires_before": e.expires_before,
        "expires_after": e.expires_after,
        "note": e.note,
        "by": (e.created_by.full_name or e.created_by.email) if e.created_by_id else "",
        "at": e.created_at,
        "revoked": e.revoked_at is not None,
    }


class PackageExtendView(APIView):
    """POST /api/school/credits/packages/<pk>/extend/ — {expires_at, note}.
    `expires_at` is a day (YYYY-MM-DD): the package then covers that whole
    day in the school's timezone. 400 expiry_not_later / package_not_active /
    package_has_no_expiry / package_not_extendable, 409 managed_by_stripe.
    Same section as the manual grant (manualCredits). HQ may pass ?school=."""

    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        from students.credit_movements import _note
        from students.school_views import _caller_school

        school = _caller_school(request)
        body = ensure_object_body(request.data)
        sp = (
            StudentPackage.objects.select_for_update(of=("self",))
            .filter(pk=parse_uuid(pk, "pk"), school=school)
            .select_related("package", "school")
            .first()
        )
        if sp is None:
            return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)
        day = parse_date(body.get("expires_at"), "expires_at")
        if day is None:
            return Response({"error": "expires_at_invalid"}, status=status.HTTP_400_BAD_REQUEST)
        note = _note(body)
        if note is None:
            return Response({"error": "note_invalid"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            row = extend_manually(sp, school.end_of_day(day), note=note, by=request.user)
        except ExtensionError as exc:
            return Response({"error": exc.code}, status=exc.http_status)
        return Response(
            {"extension": extension_row(row), "expires_at": sp.expires_at, "status": sp.status},
            status=status.HTTP_201_CREATED,
        )
