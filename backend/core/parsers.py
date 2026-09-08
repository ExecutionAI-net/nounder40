"""The one place a bare JSON body is turned away (R3-M8 / X-R3-06).

A JSON request body does not have to be an object. `"just a string"`, `42`
and `null` are all valid JSON documents, and DRF hands them to the view as
`request.data` unchanged. Every view here then does `request.data.get(...)`,
and `"hello".get` is an `AttributeError` -- an unhandled 500. QA counted 45
such shapes across the API, four of them on anonymous endpoints
(`password-reset-confirm`, `complete-invite`, `logout`, `google`), and
`/stripe/onboard/` even echoed the Python message back to the caller
(`'str' object has no attribute 'get'`).

`core.params.ensure_object_body` was the per-view answer and is used by a
handful of views. Twenty-odd others never got it, and the next view written
will not have it either -- the same "guard one call site at a time" pattern
that kept R2-C1 and R2-M1 alive across rounds. A bare scalar is not a valid
body for a single endpoint in this codebase, so it is rejected here, once,
for all of them.

Lists are deliberately still allowed through: the attendance endpoints
(`bookings/attendance_views.py`) take a top-level JSON array by design. A
view that wants an object and nothing else still says so with
`ensure_object_body()`.
"""

from rest_framework.exceptions import ParseError
from rest_framework.parsers import JSONParser


class ObjectOrArrayJSONParser(JSONParser):
    """JSONParser that refuses a top-level scalar body."""

    def parse(self, stream, media_type=None, parser_context=None):
        data = super().parse(stream, media_type=media_type, parser_context=parser_context)
        if data is not None and not isinstance(data, (dict, list)):
            raise ParseError("Expected a JSON object or array as the request body.")
        if data is None:
            # `null` is valid JSON and would sail through as "no data", then
            # blow up on the first `.get()` exactly like a string does.
            raise ParseError("Expected a JSON object or array as the request body.")
        return data
