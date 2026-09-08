"""R3-H5 (QA_REGRESSION_ROUND3_STUDENT.md ST-R3-01): fulfilment depended on
the browser surviving the Stripe redirect.

Round 3 measured **0 of 10** real payments fulfilled by the webhook; every
one was activated 13–20 s later by the return page's `verify-session` call.
Three controlled runs with the return navigation aborted sat unfulfilled —
money taken, package not credited — one of them for 22 minutes, until it was
released by hand.

Registering the webhook endpoint in the Stripe dashboard is an ops action
outside this repo. What is inside it is a third road to activation that
depends on neither the webhook nor the browser:
`reconcile_stripe_checkout_sessions_task` asks Stripe for paid Checkout
sessions in a window and runs the *same* activation path `verify-session`
uses.

Stripe is mocked throughout — the keys in this environment are masked and a
test must never reach the real API.
"""
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from catalog.models import Package
from commerce.models import Transaction
from commerce.tasks import (
    RECONCILE_AFTER_MINUTES,
    RECONCILE_LOOKBACK_HOURS,
    reconcile_stripe_checkout_sessions_task,
)
from schools.models import School
from students.models import Student, StudentPackage

pytestmark = pytest.mark.django_db


@pytest.fixture
def school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com",
        active=True, platform_fee_percentage=Decimal("10.00"),
    )


@pytest.fixture
def student(school):
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    return Student.objects.create(user=user, name="Stu", school=school)


@pytest.fixture
def package(school):
    return Package.objects.create(
        school=school, name_it="QA 10 lezioni", name_en="QA 10 lessons",
        credits=Decimal("10"), price=Decimal("100.00"),
    )


class _Session:
    """The little of a Stripe Checkout Session the activation path reads."""

    def __init__(self, *, id, metadata, payment_status="paid", payment_intent=None,
                 amount_total=10000, subscription=None):
        self.id = id
        self.metadata = metadata
        self.payment_status = payment_status
        self.payment_intent = payment_intent
        self.amount_total = amount_total
        self.subscription = subscription


class _Page:
    def __init__(self, sessions):
        self._sessions = sessions

    def auto_paging_iter(self):
        return iter(self._sessions)


def _meta(school, student, package):
    return {
        "kind": "package", "school_id": str(school.id),
        "student_id": str(student.id), "item_id": str(package.id),
    }


def _run(sessions, **kwargs):
    with patch("stripe.checkout.Session.list", return_value=_Page(sessions)) as listed:
        return reconcile_stripe_checkout_sessions_task(**kwargs), listed


def test_an_abandoned_paid_session_is_activated(school, student, package):
    """The live scenario: payment completed, return navigation aborted, the
    webhook never delivered — nothing credited until a human intervened."""
    session = _Session(id="cs_abandoned", metadata=_meta(school, student, package), payment_intent="pi_abandoned")

    recovered, _ = _run([session])

    assert recovered == 1
    assert StudentPackage.objects.filter(student=student, package=package).exists()
    assert Transaction.objects.filter(stripe_payment_id="pi_abandoned", status=Transaction.Status.COMPLETED).exists()


def test_an_unpaid_session_is_left_alone(school, student, package):
    session = _Session(
        id="cs_unpaid", metadata=_meta(school, student, package),
        payment_status="unpaid", payment_intent="pi_unpaid",
    )

    recovered, _ = _run([session])

    assert recovered == 0
    assert not StudentPackage.objects.filter(student=student).exists()
    assert not Transaction.objects.filter(stripe_payment_id="pi_unpaid").exists()


def test_a_session_already_credited_is_a_no_op(school, student, package):
    """The sweep runs alongside the webhook and the return page: passing over
    the same session again must not credit a second package."""
    session = _Session(id="cs_twice", metadata=_meta(school, student, package), payment_intent="pi_twice")

    first, _ = _run([session])
    second, _ = _run([session])

    assert (first, second) == (1, 0)
    assert StudentPackage.objects.filter(student=student, package=package).count() == 1
    assert Transaction.objects.filter(stripe_payment_id="pi_twice").count() == 1


def test_the_window_leaves_a_fresh_session_to_the_return_page(school, student, package):
    """The return page credits within ~15 s; the sweep must not race it."""
    _, listed = _run([])

    window = listed.call_args.kwargs["created"]
    now = timezone.now()
    newest_considered = datetime.fromtimestamp(window["lte"], tz=dt_timezone.utc)
    oldest_considered = datetime.fromtimestamp(window["gte"], tz=dt_timezone.utc)
    assert now - newest_considered >= timedelta(minutes=RECONCILE_AFTER_MINUTES) - timedelta(seconds=5)
    assert now - oldest_considered >= timedelta(hours=RECONCILE_LOOKBACK_HOURS) - timedelta(seconds=5)
    assert listed.call_args.kwargs["status"] == "complete"


def test_one_broken_session_does_not_stop_the_others(school, student, package):
    """A session whose product is long gone must not abort the sweep."""
    broken = _Session(id="cs_broken", metadata={"kind": "package", "school_id": str(school.id)},
                      payment_intent="pi_broken")
    good = _Session(id="cs_good", metadata=_meta(school, student, package), payment_intent="pi_good")

    recovered, _ = _run([broken, good])

    assert recovered == 1
    assert Transaction.objects.filter(stripe_payment_id="pi_good").exists()
    assert not Transaction.objects.filter(stripe_payment_id="pi_broken").exists()


def test_the_cap_bounds_one_run(school, student, package):
    sessions = [
        _Session(id=f"cs_{i}", metadata=_meta(school, student, package), payment_intent=f"pi_{i}")
        for i in range(5)
    ]

    recovered, _ = _run(sessions, max_sessions=2)

    assert recovered == 2
    assert Transaction.objects.filter(stripe_payment_id__in=["pi_0", "pi_1"]).count() == 2
    assert not Transaction.objects.filter(stripe_payment_id__in=["pi_2", "pi_3", "pi_4"]).exists()


def test_a_stripe_outage_is_logged_not_raised():
    """Masked keys on dev, a rate limit in prod: the sweep returns 0 and comes
    back in an hour instead of failing the task."""
    with patch("stripe.checkout.Session.list", side_effect=RuntimeError("no api key")):
        assert reconcile_stripe_checkout_sessions_task() == 0


def test_the_periodic_task_is_scheduled():
    """The task is useless if nothing runs it — the beat row is seeded by
    commerce/migrations/0009."""
    from django_celery_beat.models import PeriodicTask

    task = PeriodicTask.objects.filter(task="commerce.tasks.reconcile_stripe_checkout_sessions_task").first()
    assert task is not None
    assert task.crontab is not None


def test_the_return_page_and_the_sweep_share_one_activation_path():
    """Two copies of the crediting logic would be the fastest way to make the
    return page and the sweep disagree."""
    import inspect

    from commerce.checkout_activation import activate_checkout_session
    from commerce.stripe_views import VerifySessionView

    assert "activate_checkout_session" in inspect.getsource(VerifySessionView._activate)
    assert callable(activate_checkout_session)
