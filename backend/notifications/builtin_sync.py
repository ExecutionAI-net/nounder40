"""Carry a change in the built-in brand copy through to the stored templates.

`get_template()` prefers an `EmailTemplate` row over the built-in copy, and
every HQ-global row was put there by a seed migration in the first place. So
editing `brand_templates.py` changes nothing on an environment that has already
been seeded: the row still holds the copy from the previous revision and that
is what reaches the inbox.

Five migrations exist only to paper over this (0007, 0009, 0010, 0011, 0013):
each re-seeds by hand the handful of keys its PR touched. PR #110 was the sixth
copy change and did not write the sixth migration, so its two fixes -- the blank
lesson count in `student.after_purchase` and the bare "P . " line in every
lesson email -- have never been in effect on dev (R3-M14 / ST-R3-02).

The rule here replaces that ritual: a stored HQ-global row whose content is
byte-identical to *some* revision of the built-in copy is not a customisation,
it is an old seed, and the current built-in wins. Anything HQ actually wrote in
the editor has a body no revision ever produced, so it is left alone -- and a
school-level override is never touched at all.

`BUILTIN_DIGESTS` in builtin_digests.py is what "some revision" means: the
digest of every (subject, body) this repo has ever seeded, per key and locale.
It is generated -- `manage.py sync_email_templates --record` -- and
test_builtin_template_sync.py fails if a brand-copy edit ships without it, so
the next copy change cannot repeat PR #110's omission.

The sync itself runs on `post_migrate` (see apps.py), i.e. on every deploy and
every `make up`, which is why this needs no migration of its own.
"""

import hashlib
import logging
from pathlib import Path

from .brand_templates import TEMPLATES, body_html
from .builtin_digests import BUILTIN_DIGESTS

logger = logging.getLogger(__name__)

_MODULE_HEADER = '''"""Digest of every built-in email body this repo has ever seeded.

Generated file -- do not edit by hand. After changing brand_templates.py run:

    python manage.py sync_email_templates --record

A row in `email_templates` whose (subject, body_html) hashes to one of these is
a seed nobody rewrote, so builtin_sync.py may refresh it from the current copy.
Digests are only ever added: an environment can still be sitting on any older
revision. See notifications/builtin_sync.py for the why.
"""

BUILTIN_DIGESTS: dict[tuple[str, str], tuple[str, ...]] = {
'''


def template_digest(subject: str, body: str) -> str:
    return hashlib.sha256(f"{subject}\n{body}".encode()).hexdigest()


def builtin_rows():
    """(key, locale, subject, body_html) for every built-in template."""
    for key, per_locale in sorted(TEMPLATES.items()):
        for locale, (subject, text) in sorted(per_locale.items()):
            yield key, locale, subject, body_html(text)


def is_seeded_copy(key: str, locale: str, subject: str, body: str) -> bool:
    """True when this exact text came out of some revision of the built-ins."""
    return template_digest(subject, body) in BUILTIN_DIGESTS.get((key, locale), ())


def sync_builtin_templates() -> dict[str, int]:
    """Refresh the HQ-global rows that are still an untouched seed.

    Returns counts for the caller to log; never raises on a row it decides not
    to touch. School overrides (school_id is not null) are out of scope."""
    from .models import EmailTemplate

    counts = {"created": 0, "updated": 0, "kept": 0}
    for key, locale, subject, body in builtin_rows():
        row = EmailTemplate.objects.filter(school__isnull=True, key=key, locale=locale).first()
        if row is None:
            EmailTemplate.objects.create(
                school=None, key=key, locale=locale, subject=subject, body_html=body
            )
            counts["created"] += 1
            continue
        if (row.subject, row.body_html) == (subject, body):
            counts["kept"] += 1
            continue
        # A row opened in the editor and never filled in shadows the built-in
        # and would send a blank email (see emails._usable, migration 0012).
        blank = not row.subject.strip() or not row.body_html.strip()
        if blank or is_seeded_copy(key, locale, row.subject, row.body_html):
            row.subject, row.body_html = subject, body
            row.save(update_fields=["subject", "body_html", "updated_at"])
            counts["updated"] += 1
        else:
            counts["kept"] += 1
    return counts


def digests_path() -> Path:
    return Path(__file__).with_name("builtin_digests.py")


def format_digests_module(digests: dict[tuple[str, str], set[str]]) -> str:
    """Render builtin_digests.py from {(key, locale): {digest, ...}}."""
    out = [_MODULE_HEADER]
    for key, locale in sorted(digests):
        out.append(f'    ("{key}", "{locale}"): (\n')
        for digest in sorted(digests[(key, locale)]):
            out.append(f'        "{digest}",\n')
        out.append("    ),\n")
    out.append("}\n")
    return "".join(out)


def record_current_digests() -> tuple[int, Path]:
    """Add the current built-in renders to builtin_digests.py.

    Returns (how many were new, path written)."""
    merged = {pair: set(values) for pair, values in BUILTIN_DIGESTS.items()}
    added = 0
    for key, locale, subject, body in builtin_rows():
        bucket = merged.setdefault((key, locale), set())
        digest = template_digest(subject, body)
        if digest not in bucket:
            bucket.add(digest)
            added += 1
    path = digests_path()
    path.write_text(format_digests_module(merged), encoding="utf-8", newline="\n")
    return added, path
