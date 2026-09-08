"""Parsing helpers for hand-rolled query/body parameters.

DRF's filter backends already validate what they own (`?teacher=x` on a
`filterset_fields` view answers a clean 400 "is not a valid UUID"). The views
that read `request.query_params` by hand had no such net: a non-UUID id, a
`2026-13` month or a `from=x` date reached the ORM raw and surfaced as an
unhandled `ValueError`/`ValidationError` — HTTP 500 on endpoints that are, in
several cases, anonymous (QA R2-M1 / X-R2-04).

Everything here raises `rest_framework.exceptions.ValidationError`, so DRF's
own exception handler turns it into the same 400 + JSON body the filter
backends produce. Use these instead of scattering try/except blocks.
"""

from __future__ import annotations

import uuid as _uuid
from datetime import date as _date
from decimal import Decimal as _Decimal
from decimal import InvalidOperation as _InvalidOperation
from datetime import datetime as _datetime
from datetime import time as _time

from rest_framework.exceptions import ValidationError
from rest_framework.fields import BooleanField as _BooleanField

__all__ = [
    "parse_uuid",
    "parse_uuid_list",
    "parse_int",
    "parse_date",
    "parse_time",
    "parse_month",
    "parse_bool",
    "parse_decimal",
    "ensure_object_body",
]


def _fail(name: str, value, expected: str):
    raise ValidationError({name: [f"'{value}' is not a valid {expected}."]})


def parse_uuid(value, name: str = "id", allow_blank: bool = True):
    """Return `value` as a UUID, or None when it is absent/blank.

    The UUID itself is returned (not the raw string) so the caller can pass it
    straight into a queryset filter without a second parse.
    """
    if value is None or (isinstance(value, str) and not value.strip()):
        if allow_blank:
            return None
        _fail(name, value, "UUID")
    if isinstance(value, _uuid.UUID):
        return value
    if not isinstance(value, str):
        _fail(name, value, "UUID")
    try:
        return _uuid.UUID(value.strip())
    except (ValueError, AttributeError):
        _fail(name, value, "UUID")


def parse_uuid_list(value, name: str = "id"):
    """Comma-separated multi-select param (`?school_id=a,b`) -> [UUID, ...].

    An empty/absent param yields an empty list, which callers read as
    "no filter"; every element present must be a real UUID.
    """
    if not value:
        return []
    raw = value if isinstance(value, (list, tuple)) else str(value).split(",")
    return [parse_uuid(v, name, allow_blank=False) for v in raw if str(v).strip()]


def parse_int(value, name: str = "value", default: int | None = None):
    """Integer body/query param. Blank or absent -> `default`."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return default
    if isinstance(value, bool):
        _fail(name, value, "integer")
    try:
        return int(value)
    except (TypeError, ValueError):
        _fail(name, value, "integer")


def parse_date(value, name: str = "date"):
    """ISO `YYYY-MM-DD` param -> `datetime.date`, or None when absent."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, _date) and not isinstance(value, _datetime):
        return value
    try:
        return _date.fromisoformat(str(value).strip())
    except (TypeError, ValueError):
        _fail(name, value, "date (expected YYYY-MM-DD)")


def parse_time(value, name: str = "time"):
    """`HH:MM` (seconds tolerated) param -> `datetime.time`, or None when absent.

    `datetime.strptime(s[:5], "%H:%M")` raises ValueError on "25:99" — a 500
    from a wizard field a client can send by hand (QA X-R3-06).
    """
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, _time):
        return value
    try:
        return _datetime.strptime(str(value).strip()[:5], "%H:%M").time()
    except (TypeError, ValueError):
        _fail(name, value, "time (expected HH:MM)")


def parse_month(value, name: str = "month", default: str | None = None):
    """`YYYY-MM` param, validated (so `2026-13` is a 400, not a 500 deep
    inside `monthly_compensation()`), returned as the same string the
    compensation services expect."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return default
    raw = str(value).strip()
    try:
        year, _, month = raw.partition("-")
        _date(int(year), int(month), 1)
    except (TypeError, ValueError):
        _fail(name, value, "month (expected YYYY-MM)")
    return raw


def parse_bool(value, name: str = "value", default: bool | None = None):
    """Boolean body/query param.

    `bool(x)` truthies any non-empty string — `bool("false")` is `True` — so
    hand-rolled views doing `setattr(obj, field, bool(request.data.get(field)))`
    silently ignore a client sending the JSON string "false" instead of the
    boolean `false` (SCH-R2-24). Delegates to DRF's own `BooleanField`, which
    already parses the common string/int representations ("true"/"false",
    "1"/"0", etc.) the same way query params and multipart bodies use them,
    and rejects anything else with a clean 400 instead of guessing.
    """
    if value is None or (isinstance(value, str) and not value.strip()):
        return default
    try:
        return _BooleanField().to_internal_value(value)
    except ValidationError:
        _fail(name, value, "boolean")


def parse_decimal(value, name: str = "value", default=None):
    """Money/quantity body param -> Decimal. Blank or absent -> `default`.

    `Decimal(str(x))` happily accepts "NaN" and "Infinity", and NaN compares
    False against every bound, so a range check like `if amount <= 0` waves it
    straight through (QA X-R3-06 saw exactly that on
    /school/credits/grant/ {"amount": "NaN"}). Only finite numbers get out of
    here.
    """
    if value is None or (isinstance(value, str) and not value.strip()):
        return default
    if isinstance(value, bool):
        _fail(name, value, "number")
    try:
        parsed = _Decimal(str(value).strip())
    except (_InvalidOperation, TypeError, ValueError):
        _fail(name, value, "number")
    if not parsed.is_finite():
        _fail(name, value, "number")
    return parsed


def ensure_object_body(data, name: str = "body"):
    """Guard for views that call `request.data.get(...)`.

    A perfectly valid JSON request body can be a string, a number or a list —
    and `"hello".get` is an AttributeError, i.e. a 500 (QA TCH-R2-06). Views
    that expect an object must say so.
    """
    if not isinstance(data, dict):
        raise ValidationError({name: ["Expected a JSON object."]})
    return data
