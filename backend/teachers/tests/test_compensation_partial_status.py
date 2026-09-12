"""R4-M6 (QA_REGRESSION_ROUND4 TCH-R4-10): a month recorded as paid kept
its "Paid" badge after later attendance raised the total -- the teacher read
"€65.00 · Paid" while €40 had been paid, and the school's summary showed the
two numbers side by side with no state for the gap. Both rows now carry
`outstanding` and `effective_status` (`partial` when a paid row no longer
covers the month).
"""
from datetime import datetime, timezone as dt_timezone

import pytest

from teachers.views import _payment_row


class _Payment:
    def __init__(self, amount, status, note="", method="bank_transfer"):
        self.amount = amount
        self.status = status
        self.paid_at = datetime(2026, 9, 10, tzinfo=dt_timezone.utc) if status == "paid" else None
        self.note = note
        self.payment_method = method


def test_no_payment_row_stays_none():
    assert _payment_row(None, 65.0) is None


def test_a_paid_month_that_grew_is_partial_with_the_gap():
    row = _payment_row(_Payment(40, "paid"), 65.0, with_method=True)
    assert row["status"] == "paid"
    assert row["effective_status"] == "partial"
    assert row["outstanding"] == 25.0
    assert row["payment_method"] == "bank_transfer"


def test_a_paid_month_that_did_not_grow_is_simply_paid():
    row = _payment_row(_Payment(65, "paid"), 65.0)
    assert (row["effective_status"], row["outstanding"]) == ("paid", 0.0)
    assert "payment_method" not in row


def test_an_overpaid_month_never_reports_a_negative_gap():
    row = _payment_row(_Payment(70, "paid"), 65.0)
    assert (row["effective_status"], row["outstanding"]) == ("paid", 0.0)


def test_a_pending_row_reports_no_gap():
    row = _payment_row(_Payment(40, "pending"), 65.0)
    assert (row["effective_status"], row["outstanding"]) == ("pending", 0.0)


@pytest.mark.django_db
def test_the_helper_is_what_the_overview_serialises():
    """Guard against the two views drifting apart again: the same helper
    feeds `/api/teacher/compensation-overview/` and the school summary."""
    import inspect

    from teachers import views

    src = inspect.getsource(views)
    assert src.count("_payment_row(") >= 3  # definition + two call sites
