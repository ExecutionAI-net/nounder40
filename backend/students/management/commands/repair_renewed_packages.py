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
left and its paid window has not ended. `deleted` and `expired` rows are
decisions (the school took it away, the subscription was cancelled) and are
never touched.
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from students.models import StudentPackage


def renewed_while_exhausted(now=None):
    now = now or timezone.now()
    return (
        StudentPackage.objects
        .exclude(stripe_subscription_id="")
        .filter(status=StudentPackage.Status.EXHAUSTED, credits_remaining__gt=0, expires_at__gt=now)
        .select_related("student__user", "school", "package")
        .order_by("school__name", "student__name")
    )


class Command(BaseCommand):
    help = "List (and with --apply, reactivate) recurring packages renewed by Stripe while exhausted."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Set the listed rows back to active.")

    def handle(self, *args, **options):
        rows = list(renewed_while_exhausted())
        if not rows:
            self.stdout.write("nothing to repair: no exhausted recurring package with credits and a live window")
            return
        for sp in rows:
            email = sp.student.user.email if sp.student.user_id else "-"
            name = (sp.package.name_it or sp.package.name_en) if sp.package_id else "-"
            renews = f"renews {sp.next_renewal_at:%Y-%m-%d}" if sp.next_renewal_at else "cancelled"
            self.stdout.write(
                f"{sp.school.name} | {sp.student.name} <{email}> | {name} | "
                f"credits {sp.credits_remaining}/{sp.credits_total} | expires {sp.expires_at:%Y-%m-%d} | {renews}"
            )
        if not options["apply"]:
            self.stdout.write(f"{len(rows)} row(s) would be set active; run again with --apply to do it")
            return
        updated = StudentPackage.objects.filter(pk__in=[sp.pk for sp in rows]).update(
            status=StudentPackage.Status.ACTIVE, credits_low_sent_at=None,
        )
        self.stdout.write(f"{updated} row(s) set active")
