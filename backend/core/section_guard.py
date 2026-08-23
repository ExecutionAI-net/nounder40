"""Guardia server-side della matrice ruoli scuola.

Il filtro di navigazione nasconde le sezioni nel frontend; questo middleware
chiude la porta anche alle API: un membro scuola il cui ruolo non ha una
sezione riceve 403 sugli endpoint corrispondenti, anche chiamandoli a mano.

Fail-open per design: se il token manca/non è valido decide la view (401),
se il ruolo non è in matrice non si blocca nulla.
"""

import time

from django.http import JsonResponse

# Primo segmento di /api/school/<seg>/... → sezione della matrice
SECTION_BY_SEGMENT = {
    "locations": "locations",
    "rooms": "locations",
    "closures": "settings",
    "courses": "courses",
    "courses-create": "courses",
    "courses-overview": "courses",
    "courses-reorder": "courses",
    "classes": "courses",
    "lesson-types": "courses",
    "lessons": "lessons",
    "lessons-feed": "lessons",
    "attendance": "lessons",
    "teachers": "teachers",
    "compensation-plans": "compensation",
    "compensation-payments": "compensation",
    "compensation-summary": "compensation",
    "students": "students",
    "student-lesson-ids": "students",
    "documents": "documents",
    "document-types": "documents",
    "packages": "packages",
    "subscriptions": "packages",
    "discount-codes": "packages",
    "transactions": "payments",
    "credits": "manualCredits",
    "reports": "reports",
    "attendance-statuses": "attendanceStatuses",
    "quick-replies": "inbox",
    "team": "team",
    # memberships / profile / permissions: infrastruttura, sempre consentiti
}

_MATRIX_TTL = 30  # secondi
_matrix_cache: dict = {"expires": 0.0, "roles": {}}


def _role_permissions(sub_role: str):
    now = time.monotonic()
    if now >= _matrix_cache["expires"]:
        from schools.models import SchoolRole

        _matrix_cache["roles"] = {r.key: list(r.permissions) for r in SchoolRole.objects.all()}
        _matrix_cache["expires"] = now + _MATRIX_TTL
    return _matrix_cache["roles"].get(sub_role)


class SchoolSectionGuardMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        denied = self._check(request)
        if denied is not None:
            return denied
        return self.get_response(request)

    def _check(self, request):
        path = request.path
        if not path.startswith("/api/school/"):
            return None
        segment = path[len("/api/school/"):].split("/", 1)[0]
        section = SECTION_BY_SEGMENT.get(segment)
        if section is None:
            return None

        user = self._authenticate(request)
        if user is None:
            return None  # la view risponderà 401 se serve
        roles = user.roles or []
        if "hq" in roles:
            return None  # HQ non è soggetto alla matrice scuola

        sub_role = self._school_sub_role(user)
        if not sub_role or sub_role == "owner":
            return None
        permissions = _role_permissions(sub_role)
        if permissions is None:
            return None  # ruolo fuori matrice: fail-open
        if section not in permissions:
            return JsonResponse({"error": "section_forbidden", "section": section}, status=403)
        return None

    @staticmethod
    def _authenticate(request):
        from rest_framework_simplejwt.authentication import JWTAuthentication

        try:
            result = JWTAuthentication().authenticate(request)
        except Exception:
            return None
        return result[0] if result else None

    @staticmethod
    def _school_sub_role(user):
        from schools.models import SchoolMembership

        if user.active_school_id:
            membership = SchoolMembership.objects.filter(
                profile=user, school_id=user.active_school_id
            ).only("sub_role").first()
            if membership:
                return membership.sub_role
        return user.school_sub_role or ""
