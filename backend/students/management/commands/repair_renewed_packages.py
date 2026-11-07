"""Recurring packages renewed by Stripe while they sat in `exhausted`.

Until 2026-11-07 the renewal webhook (commerce/webhooks.py,
`_handle_subscription_updated`) refilled the credits and moved the expiry
but left the status alone. A student who had used every lesson of the
cycle (`exhausted`) got her new credits in a row nobody reads: the school's
roster, her balance and the booking engine only look at `active`. She had
paid, and could not book.

The webhook now brings such a row back to `active`. This command finds the
rows renewed before the fix and does the same, once:

    python manage.py repair_renewed_packages          # list only, changes nothing
    python manage.py repair_renewed_packages --apply  # set them active

A row qualifies when it is a Stripe subscription, is `exhausted`, has credits
left and its paid window has not ended. The same rows whose window has
already ended are listed too, under "window over": nothing to reactivate,
but the school may owe that student a cycle. `deleted` and `expired` rows
are decisions (the school took it away, the subscription was cancelled) and
are never touched.
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from students.models import StudentPackage


def _exhausted_with_credits():
    return (
        StudentPackage.objects
        .exclude(stripe_subscription_id="")
        .filter(status=StudentPackage.Status.EXHAUSTED, credits_remaining__gt=0)
        .select_related("student__user", "school", "package")
        .order_by("school__name", "student__name")
    )


def renewed_while_exhausted(now):
    """Renewed, exhausted, credits in hand, window still open: to reactivate."""
    return _exhausted_with_credits().filter(expires_at__gt=now)


def renewed_and_window_over(now):
    """Same, but the paid window is already gone: to report, not to change."""
    return _exhausted_with_credits().filter(expires_at__lte=now)


def _line(sp: StudentPackage) -> str:
    name = sp.package.localized_name("it") if sp.package_id else "-"
    renews = f"renews {sp.next_renewal_at:%Y-%m-%d}" if sp.next_renewal_at else "cancelled"
    return (
        f"{sp.school.name} | {sp.student.name} <{sp.student.user.email}> | {name} | "
        f"credits {sp.credits_remaining}/{sp.credits_total} | expires {sp.expires_at:%Y-%m-%d} | {renews}"
    )


class Command(BaseCommand):
    help = "List (and with --apply, reactivate) recurring packages renewed by Stripe while exhausted."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Set the listed rows back to active.")

    def handle(self, *args, **options):
        now = timezone.now()
        over = list(renewed_and_window_over(now))
        if over:
            self.stdout.write("window over, not changed (the student paid a cycle she could not use):")
            for sp in over:
                self.stdout.write("  " + _line(sp))
        rows = list(renewed_while_exhausted(now))
        if not rows:
            self.stdout.write("nothing to repair: no exhausted recurring package with credits and a live window")
            return
        self.stdout.write("to reactivate:")
        for sp in rows:
            self.stdout.write("  " + _line(sp))
        if not options["apply"]:
            self.stdout.write(f"{len(rows)} row(s) would be set active; run again with --apply to do it")
            return
        # the same predicate guards the write: a row deleted or drained since
        # the listing is left alone
        updated = renewed_while_exhausted(now).filter(pk__in=[sp.pk for sp in rows]).update(
            status=StudentPackage.Status.ACTIVE, credits_low_sent_at=None,
        )
        self.stdout.write(f"{updated} row(s) set active")
