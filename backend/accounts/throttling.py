"""Rate limits for the unauthenticated auth endpoints.

Nothing throttled these before, and it showed: 30 wrong-password logins in a row
were all accepted, and password-reset answered 20 requests in half a second —
a working mail bomb aimed at whatever address the attacker chooses
(`ops/testing/REPORT.md`).

DRF's own AnonRateThrottle exempts authenticated callers, which is wrong here:
these endpoints are reachable with a valid token in hand, and a bearer token is
exactly what an attacker enumerating passwords would keep out of the request.
So the key is the client IP, always.

Client IP means the real one. nginx is the single proxy in front of Django and
sets X-Forwarded-For (both compose files); `NUM_PROXIES = 1` in settings makes
`get_ident()` read it. Without that every request looks like it comes from
nginx, and the first attacker would lock out the entire platform.
"""

from rest_framework.throttling import SimpleRateThrottle


class IPRateThrottle(SimpleRateThrottle):
    """Keyed on the client IP whether or not the caller is authenticated."""

    def get_cache_key(self, request, view):
        return self.cache_format % {
            "scope": self.scope,
            "ident": self.get_ident(request),
        }


class LoginRateThrottle(IPRateThrottle):
    scope = "login"


class RegisterRateThrottle(IPRateThrottle):
    scope = "register"


class PasswordResetRateThrottle(IPRateThrottle):
    scope = "password_reset"
