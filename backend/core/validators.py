"""Shared field validators.

Anything a user can type that a template or a client later turns into an
`href` has to be checked here, on the way in. SCH-R3-11 found the school
`website` published verbatim by the anonymous `/api/schools/public/` after
`PATCH {"website": "javascript:alert(1)"}` -- latent, because nothing renders
it as a link today -- and the same missing check on
`SchoolLocation.google_maps_url`, which IS rendered as a bare href to
students (student/book, student/bookings).
"""
import re

from rest_framework import serializers

# http(s) or a site-relative path. Anything else -- javascript:, data:,
# vbscript: -- is a script sink the moment something renders it as a link.
# Same rule the HQ brand nav links have used since they were added
# (translations/views.py), now in one place instead of two.
SAFE_URL_RE = re.compile(r"^(https?://|/)", re.I)


def validate_safe_url(value, *, allow_blank: bool = True) -> str:
    value = (value or "").strip()
    if not value:
        if allow_blank:
            return value
        raise serializers.ValidationError("A URL is required.")
    if not SAFE_URL_RE.match(value):
        raise serializers.ValidationError("Use a full http:// or https:// address.")
    return value
