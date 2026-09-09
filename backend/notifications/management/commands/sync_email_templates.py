"""Bring the HQ-global email templates back in line with the built-in copy.

Normally nobody runs this: it happens on `post_migrate`, so every deploy and
every `make up` does it. Two reasons to type it yourself:

    python manage.py sync_email_templates --dry-run   # what would change
    python manage.py sync_email_templates --record    # after editing the copy

`--record` is the step that keeps builtin_digests.py complete; the test suite
fails if a brand_templates.py edit ships without it.
"""

from django.core.management.base import BaseCommand

from notifications.builtin_sync import (
    BUILTIN_DIGESTS,
    builtin_rows,
    is_seeded_copy,
    record_current_digests,
    sync_builtin_templates,
)


class Command(BaseCommand):
    help = "Refresh the HQ-global email templates that are still an untouched seed."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="List what would change, write nothing.")
        parser.add_argument("--record", action="store_true", help="Add the current built-in copy to builtin_digests.py.")

    def handle(self, *args, **options):
        if options["record"]:
            added, path = record_current_digests()
            self.stdout.write(f"{path.name}: {added} new digest(s), {sum(len(v) for v in BUILTIN_DIGESTS.values())} before")
            return

        if options["dry_run"]:
            self._dry_run()
            return

        counts = sync_builtin_templates()
        self.stdout.write(
            "email templates: {created} created, {updated} refreshed, {kept} left alone".format(**counts)
        )

    def _dry_run(self):
        from notifications.models import EmailTemplate

        for key, locale, subject, body in builtin_rows():
            row = EmailTemplate.objects.filter(school__isnull=True, key=key, locale=locale).first()
            if row is None:
                self.stdout.write(f"create   {key} [{locale}]")
            elif (row.subject, row.body_html) == (subject, body):
                continue
            elif not row.subject.strip() or not row.body_html.strip():
                self.stdout.write(f"fill     {key} [{locale}] (blank row)")
            elif is_seeded_copy(key, locale, row.subject, row.body_html):
                self.stdout.write(f"refresh  {key} [{locale}] (old seed)")
            else:
                self.stdout.write(f"keep     {key} [{locale}] (edited in HQ > Emails)")
