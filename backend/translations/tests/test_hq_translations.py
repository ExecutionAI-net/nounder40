"""HQ > Translations page regression tests (QA finding H-2).

`/api/hq/deploy/` and its `VERCEL_DEPLOY_HOOK_URL` setting were leftovers
from the pre-monorepo Vercel architecture: the endpoint always 500'd
("Deploy hook not configured") because no equivalent hook exists in the
current Docker Compose / EC2 setup, and the "Publish Live" button that hit
it falsely implied edits made on this page went live. Both the button and
the endpoint were removed rather than left broken. These tests lock that
in — and confirm the still-supported manual-edit/auto-fill worklist
endpoints keep working as a DB-only tracking tool.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from translations.models import Translation

User = get_user_model()

pytestmark = pytest.mark.django_db


def _hq_client():
    hq = User.objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ]
    )
    client = APIClient()
    client.force_authenticate(hq)
    return client


def test_deploy_endpoint_removed():
    """The retired Vercel-era 'Publish Live' endpoint no longer exists."""
    client = _hq_client()
    res = client.post("/api/hq/deploy/")
    assert res.status_code == 404


def test_translations_manual_edit_round_trip_stays_db_only():
    """Manual edit/search still works as a worklist, purely against the DB
    table — it does not (and cannot) touch frontend/messages/*.json."""
    client = _hq_client()

    res = client.post(
        "/api/hq/translations/",
        {"key": "hq.dashboard.title", "locale": "en", "value": "Dashboard"},
        format="json",
    )
    assert res.status_code == 200
    assert res.json() == {"ok": True}
    assert Translation.objects.filter(
        key="hq.dashboard.title", locale="en", value="Dashboard"
    ).exists()

    listed = client.get("/api/hq/translations/").json()
    row = next(r for r in listed if r["key"] == "hq.dashboard.title")
    assert row["en"] == "Dashboard"


def test_translations_requires_hq():
    Translation.objects.create(key="k", locale="en", value="v")
    non_hq = User.objects.create(
        email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT]
    )
    client = APIClient()
    client.force_authenticate(non_hq)

    assert client.get("/api/hq/translations/").status_code == 403


def test_auto_fill_without_key_returns_clear_error_not_a_crash():
    """When ANTHROPIC_API_KEY isn't configured, auto-fill fails loudly with
    a clear 500 payload instead of throwing — this is the behavior the
    frontend banner now explains rather than silently implying success."""
    from django.test import override_settings

    Translation.objects.create(key=f"qa.autofill.{uuid.uuid4().hex[:8]}", locale="it", value="")
    client = _hq_client()

    with override_settings(ANTHROPIC_API_KEY=""):
        res = client.post("/api/hq/translations/auto-fill/")

    assert res.status_code == 500
    assert res.json() == {"error": "ANTHROPIC_API_KEY not configured"}
