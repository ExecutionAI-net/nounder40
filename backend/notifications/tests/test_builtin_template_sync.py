"""R3-M14 — a fix to the built-in email copy has to reach the stored rows.

`get_template()` prefers an `EmailTemplate` row over the built-in copy, and the
HQ-global rows are themselves seeds. So a PR that edits brand_templates.py and
nothing else changes what the repo says and not what the inbox gets: dev has
been sending PR #110's two known-broken lines ever since, because its rows were
seeded before that PR and nothing re-seeded them.

The fixture is not invented: it is the real render of the four affected rows at
ee646cf, the revision immediately before PR #110 -- exactly what dev holds.
"""
import json
import weakref
from pathlib import Path

import pytest
from django.apps import apps as django_apps
from django.db.models.signals import post_migrate

from notifications.brand_templates import TEMPLATES, body_html
from notifications.builtin_digests import BUILTIN_DIGESTS
from notifications.builtin_sync import builtin_rows, sync_builtin_templates, template_digest
from notifications.emails import get_template
from notifications.models import EmailTemplate
from schools.models import School

PRE_PR110 = json.loads((Path(__file__).parent / "fixtures" / "pre_pr110_seeds.json").read_text(encoding="utf-8"))


def _builtin(key: str, locale: str) -> tuple[str, str]:
    subject, text = TEMPLATES[key][locale]
    return subject, body_html(text)


def _store(row: dict) -> EmailTemplate:
    """Put the pre-PR-#110 copy in the HQ-global row, as on dev."""
    obj, _ = EmailTemplate.objects.update_or_create(
        school=None, key=row["key"], locale=row["locale"],
        defaults={"subject": row["subject"], "body_html": row["body_html"]},
    )
    return obj


def test_every_current_builtin_is_recorded():
    """The guard that makes the mechanism self-maintaining: edit the brand copy
    without `manage.py sync_email_templates --record` and this fails, naming
    what to run. Without it the next revision could not tell an old seed from
    something HQ wrote, and we would be back to hand-written re-seed
    migrations -- the ritual PR #110 forgot."""
    missing = [
        f"{key} [{locale}]"
        for key, locale, subject, body in builtin_rows()
        if template_digest(subject, body) not in BUILTIN_DIGESTS.get((key, locale), ())
    ]
    assert not missing, (
        "brand_templates.py changed without recording the new copy: "
        "run `python manage.py sync_email_templates --record`. Missing: " + ", ".join(missing)
    )


@pytest.mark.django_db
def test_pre_pr110_seeds_are_refreshed():
    """The finding itself: the rows dev is stuck with must end up holding
    PR #110's copy, without anyone editing a database by hand."""
    for row in PRE_PR110:
        stored = _store(row)
        assert "{{package_summary}}" not in stored.body_html
        assert "{{location_line}}" not in stored.body_html

    sync_builtin_templates()

    purchase = EmailTemplate.objects.get(school=None, key="student.after_purchase", locale="it")
    assert "{{package_summary}}" in purchase.body_html
    assert "{{lessons_total}}" not in purchase.body_html  # the blank "✨  lezioni" line

    booking = EmailTemplate.objects.get(school=None, key="student.booking_confirmed", locale="en")
    assert "{{location_line}}" in booking.body_html
    assert "{{room_name}}" not in booking.body_html  # the bare "📍 · " line

    for row in PRE_PR110:
        assert (
            EmailTemplate.objects.get(school=None, key=row["key"], locale=row["locale"]).body_html
            == _builtin(row["key"], row["locale"])[1]
        )


@pytest.mark.django_db
def test_the_refreshed_row_is_what_get_template_returns():
    """Refreshing the row is only worth anything if it is the row that sends."""
    _store(PRE_PR110[0])
    sync_builtin_templates()
    template = get_template("student.after_purchase", locale="it")
    assert template is not None
    assert "{{package_summary}}" in template.body_html


@pytest.mark.django_db
def test_a_template_written_in_hq_is_left_alone():
    """The whole reason DB rows win over built-ins. A body no revision ever
    produced is somebody's work, and no deploy may overwrite it."""
    mine = "<p>Ciao, questa copia l'ho scritta io.</p>"
    EmailTemplate.objects.update_or_create(
        school=None, key="student.after_purchase", locale="it",
        defaults={"subject": "Il mio oggetto", "body_html": mine},
    )

    sync_builtin_templates()

    row = EmailTemplate.objects.get(school=None, key="student.after_purchase", locale="it")
    assert (row.subject, row.body_html) == ("Il mio oggetto", mine)


@pytest.mark.django_db
def test_a_school_override_is_never_touched():
    """School-level rows exist only because a school wrote one; the sync is
    about the platform's own seeds."""
    school = School.objects.create(name="QA Sync School", slug="qa-sync-school", email="qa-sync@example.com")
    stale = PRE_PR110[0]
    EmailTemplate.objects.create(
        school=school, key=stale["key"], locale=stale["locale"],
        subject=stale["subject"], body_html=stale["body_html"],
    )

    sync_builtin_templates()

    row = EmailTemplate.objects.get(school=school, key=stale["key"], locale=stale["locale"])
    assert row.body_html == stale["body_html"]


@pytest.mark.django_db
def test_a_blank_row_is_filled_and_a_missing_one_recreated():
    """Both shapes migration 0012 had to repair by hand: a row opened in the
    editor and never filled in (which shadows the built-in and would send an
    empty email), and a key deleted from the HQ page."""
    EmailTemplate.objects.update_or_create(
        school=None, key="student.welcome", locale="it",
        defaults={"subject": "", "body_html": ""},
    )
    EmailTemplate.objects.filter(school__isnull=True, key="team_invite", locale="de").delete()

    counts = sync_builtin_templates()

    assert counts["created"] >= 1 and counts["updated"] >= 1
    welcome = EmailTemplate.objects.get(school=None, key="student.welcome", locale="it")
    assert (welcome.subject, welcome.body_html) == _builtin("student.welcome", "it")
    invite = EmailTemplate.objects.get(school=None, key="team_invite", locale="de")
    assert (invite.subject, invite.body_html) == _builtin("team_invite", "de")


@pytest.mark.django_db
def test_sync_is_idempotent():
    for row in PRE_PR110:
        _store(row)
    sync_builtin_templates()
    again = sync_builtin_templates()
    assert again["created"] == 0 and again["updated"] == 0


def test_the_sync_runs_on_every_migrate():
    """The mechanism is only a mechanism because nobody has to remember it:
    post_migrate fires on every deploy and every `make up`."""
    django_apps.get_app_config("notifications")  # the app config is the sender
    names = set()
    for entry in post_migrate.receivers:
        ref = entry[1]
        fn = ref() if isinstance(ref, weakref.ReferenceType) else ref
        names.add(getattr(fn, "__name__", ""))
    assert "_sync_builtin_templates" in names
