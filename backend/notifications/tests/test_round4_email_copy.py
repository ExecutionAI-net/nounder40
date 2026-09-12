"""R4-L1 / HQ-R4-02 and R4-L14 / ST-R4-06: the last "📍 · " line and the
hedged refund sentence.

`school.new_booking` still hardcoded `📍 {{location_name}} · {{room_name}}`
(the exact bare line `location_line` was created to remove) and the student
cancellation e-mail said "if the cancellation was within the notice period,
the credit is back" although the server knows `credit_refunded`.
"""
from types import SimpleNamespace

import pytest

from bookings.models import Booking
from bookings.services import _refund_line
from notifications.brand_templates import TEMPLATES

LOCALES = ("it", "en", "es", "fr", "de")


@pytest.mark.parametrize("locale", LOCALES)
def test_school_new_booking_uses_the_location_line(locale):
    body = TEMPLATES["school.new_booking"][locale][1]
    assert "{{location_line}}" in body
    assert "{{location_name}}" not in body and "{{room_name}}" not in body


@pytest.mark.parametrize("locale", LOCALES)
def test_student_cancellation_carries_the_refund_line(locale):
    body = TEMPLATES["student.booking_cancelled"][locale][1]
    assert "{{refund_line}}" in body
    assert "entro i termini" not in body and "within the school" not in body


def _booking(**kw):
    base = dict(status=Booking.Status.CANCELLED, credit_refunded=False,
                access_source=Booking.AccessSource.PACKAGE, credits_deducted=1)
    base.update(kw)
    return SimpleNamespace(**base)


def test_refund_line_says_the_credit_is_back():
    assert _refund_line(_booking(credit_refunded=True), "it") == "Il credito è già tornato nel tuo pacchetto."
    assert "back in your package" in _refund_line(_booking(credit_refunded=True), "en")


def test_refund_line_says_the_credit_was_burned():
    assert "non viene rimborsato" in _refund_line(_booking(), "it")
    assert "not refunded" in _refund_line(_booking(), "en")


def test_refund_line_is_empty_for_a_free_lesson_or_a_live_booking():
    assert _refund_line(_booking(access_source=Booking.AccessSource.FREE_LESSON, credits_deducted=0), "en") == ""
    assert _refund_line(_booking(status=Booking.Status.CONFIRMED), "en") == ""


def test_unknown_locale_falls_back_to_english():
    assert _refund_line(_booking(credit_refunded=True), "pt") == "The credit is already back in your package."
