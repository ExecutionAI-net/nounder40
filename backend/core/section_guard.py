"""Guardia server-side della matrice ruoli scuola.

Il filtro di navigazione nasconde le sezioni nel frontend; questo middleware
chiude la porta anche alle API: un membro scuola il cui ruolo non ha una
sezione riceve 403 sugli endpoint corrispondenti, anche chiamandoli a mano.

Fail-open solo per l'autenticazione: se il token manca/non è valido decide
la view (401). Un ruolo che non è in matrice ora fail-closed (R2-M3): prima
un sub_role inventato (es. un refuso, o un valore accettato da un endpoint
che non lo validava contro SchoolRole) bypassava ogni restrizione invece di
riceverne una — l'esatto opposto dell'intento della matrice. `_role_permissions`
ricontrolla il DB al volo prima di dichiarare un ruolo sconosciuto, cosa che
protegge un ruolo custom appena creato dalla finestra di cache di 30s.
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

# Letture di supporto: una pagina carica anche dati di ALTRE sezioni per
# popolare filtri e select (Calendario legge insegnanti/chiusure/sedi, Corsi
# legge sedi e piani compenso, Allieve legge i pacchetti...). Senza questa
# tabella un ruolo senza "teachers" riceveva 403 su /school/teachers/ e la
# pagina Calendario restava in "Loading..." per sempre. Vale SOLO per i
# metodi safe: le scritture restano vincolate alla sezione propria.
LOOKUP_READERS = {
    "teachers": {"calendar", "courses", "lessons", "compensation"},
    "closures": {"calendar", "lessons"},
    "locations": {"calendar", "courses", "lessons"},
    "rooms": {"calendar", "courses", "lessons"},
    "compensation-plans": {"courses"},
    "lesson-types": {"calendar", "courses", "lessons"},
    "courses": {"calendar", "lessons", "students"},
    "courses-overview": {"calendar", "lessons"},
    "classes": {"calendar", "lessons", "students"},
    "lessons": {"calendar", "courses", "students"},
    "lessons-feed": {"calendar", "courses", "students"},
    "students": {"calendar", "lessons", "courses", "documents", "packages", "payments", "manualCredits"},
    "student-lesson-ids": {"calendar", "lessons"},
    "packages": {"students", "payments", "manualCredits"},
    "attendance-statuses": {"calendar", "lessons"},
}

# Raggiungibili anche senza appartenenza: sono ciò che permette all'utente di
# SCOPRIRE a quali scuole appartiene e di cambiare quella attiva. Bloccarli
# renderebbe impossibile uscire da una scuola attiva sbagliata.
MEMBERSHIP_EXEMPT_SEGMENTS = {"memberships"}

SAFE_METHODS = ("GET", "HEAD", "OPTIONS")

_MATRIX_TTL = 30  # secondi
_matrix_cache: dict = {"expires": 0.0, "roles": {}}


def _role_permissions(sub_role: str):
    now = time.monotonic()
    if now >= _matrix_cache["expires"]:
        from schools.models import SchoolRole

        _matrix_cache["roles"] = {r.key: list(r.permissions) for r in SchoolRole.objects.all()}
        _matrix_cache["expires"] = now + _MATRIX_TTL
    if sub_role in _matrix_cache["roles"]:
        return _matrix_cache["roles"][sub_role]
    # Not in the cached snapshot. Since the caller below now fails CLOSED
    # (403) when this returns None, a merely-stale cache must not be allowed
    # to masquerade as "role doesn't exist": a custom SchoolRole created up
    # to _MATRIX_TTL seconds ago (and immediately assigned to a member) would
    # otherwise lock its holder out until the cache refreshes. One direct,
    # indexed-by-PK lookup settles it either way.
    from schools.models import SchoolRole

    role = SchoolRole.objects.filter(key=sub_role).only("permissions").first()
    return list(role.permissions) if role is not None else None


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

        user = self._authenticate(request)
        if user is None:
            return None  # la view risponderà 401 se serve
        roles = user.roles or []
        if "hq" in roles:
            # R2-H2 / X-R2-03: prima un token HQ qualsiasi bypassava la
            # matrice scuola per intero (era "god-mode" implicito). Ora solo
            # un ruolo HQ con vero accesso cross-school (owner/super_admin,
            # o il permesso "schools_create_edit" — vedi hq_school_godmode())
            # bypassa; gli altri (support, tech_support, finance, analytics
            # coi soli permessi propri) ricevono 403 come chiunque privo di
            # una membership sulla scuola.
            if hq_school_godmode(user):
                return None
            return JsonResponse({"error": "hq_school_access_forbidden"}, status=403)

        membership = self._membership(user)
        if membership is None and segment not in MEMBERSHIP_EXEMPT_SEGMENTS:
            # Nessuna SchoolMembership sulla scuola attiva. Prima di questo
            # controllo bastava `active_school_id` — una colonna che nessuno
            # ripulisce — per leggere e scrivere i dati della scuola: un'allieva
            # (active_school = la sua scuola, nessuna membership) vedeva
            # l'elenco delle altre allieve e lo staff e poteva fare PATCH su
            # /school/profile/, e un membro rimosso continuava a lavorare come
            # prima. L'appartenenza è la porta; la matrice qui sotto decide
            # soltanto quali stanze.
            return JsonResponse({"error": "not_a_school_member"}, status=403)

        section = SECTION_BY_SEGMENT.get(segment)
        if section is None:
            return None

        sub_role = membership.sub_role if membership else ""
        if sub_role == "owner":
            return None
        if not sub_role:
            # Membro senza sub-ruolo: anomalo, non deve bypassare la matrice
            return JsonResponse({"error": "section_forbidden", "section": section}, status=403)
        permissions = _role_permissions(sub_role)
        if permissions is None:
            # R2-M3: ruolo genuinamente fuori matrice (non solo cache stale,
            # vedi _role_permissions) -- fail-closed, non fail-open. Un
            # sub_role inventato non deve girare a briglia sciolta.
            return JsonResponse({"error": "section_forbidden", "section": section}, status=403)
        if section in permissions:
            return None
        if request.method in SAFE_METHODS and LOOKUP_READERS.get(segment, set()) & set(permissions):
            return None  # lettura di supporto per una sezione che il ruolo ha
        return JsonResponse({"error": "section_forbidden", "section": section}, status=403)

    @staticmethod
    def _authenticate(request):
        from rest_framework_simplejwt.authentication import JWTAuthentication

        try:
            result = JWTAuthentication().authenticate(request)
        except Exception:
            return None
        return result[0] if result else None

    @staticmethod
    def _membership(user):
        """La membership sulla scuola attiva, o None.

        È insieme il permesso di entrare e la fonte del sub-ruolo. Di
        proposito NON usa `effective_school_sub_role()`: quello ripiega sulla
        colonna piatta `school_sub_role` (residuo ETL), e un residuo non deve
        poter tenere aperta una porta che la membership ha chiuso.
        """
        from schools.models import SchoolMembership

        if not user.active_school_id:
            return None
        return (
            SchoolMembership.objects
            .filter(profile=user, school_id=user.active_school_id)
            .only("sub_role")
            .first()
        )


# ---------------------------------------------------------------------------
# HQ — stessa idea, matrice diversa (`HQRole.permissions`, 18 chiavi fisse:
# vedi accounts/migrations/0004_seed_hq_roles.py). Il report QA (Alto #5) ha
# dimostrato in produzione che `IsHQ` (accounts/permissions.py) controlla
# solo `user.role == 'hq'`, mai la matrice: un sub-ruolo HQ con permessi
# minimi (support: dashboard+inbox) poteva comunque leggere E scrivere
# qualsiasi endpoint /api/hq/*, incluso `POST /api/hq/packages/` (tech_support,
# senza il permesso "packages", ha creato un pacchetto HQ reale, 201).
#
# `team` e `permissions` restano fuori dall'enforcement qui sotto: la loro
# chiusura vive già in accounts/hq_views.py (`HQMemberViewSet.initial()` /
# `HQRoleViewSet.initial()`, stesso giro di fix). Compaiono comunque nella
# tabella per documentazione — HQ_SEGMENT_ENFORCED_ELSEWHERE dice esplicitamente
# al guard di non rivalutarle, per non rischiare di divergere in futuro.
# ---------------------------------------------------------------------------

# Primo segmento di /api/hq/<seg>/... → chiave della matrice HQRole.
# "schools" non è qui: metodo e coda del path decidono view/create_edit/activate
# (vedi _hq_section_for).
HQ_SECTION_BY_SEGMENT = {
    "lesson-types": "lesson_types",
    "shop": "shop",
    "shop-sales": "shop",
    "discount-codes": "shop",  # codici HQ (school=null), spendibili nello shop HQ
    "team": "team",
    "permissions": "permissions",
    "school-permissions": "schools_create_edit",  # matrice ruoli scuola, gestita da HQ
    "invitations": "team",
    "packages": "packages",
    "transactions": "payments",
    "reports": "reports",
    "homepage-settings": "homepage_settings",
    "homepage-real-stats": "homepage_settings",
    "brand-settings": "homepage_settings",
    "student-shop-visibility": "homepage_settings",
    "student-credits-visibility": "homepage_settings",
    "translations": "translations",
    "deploy": "permissions",  # trigger di build in produzione: lato sicuro, massima fiducia
    "library": "library",
    "email-templates": "email_templates",
    "email-settings": "email_templates",
    "students": "schools_view",  # elenco studenti network-wide per i selettori HQ
}

# Enforcement già presente in accounts/hq_views.py — il guard qui non deve
# rivalutarle (vedi commento sopra): evita duplicazione/divergenza futura.
HQ_SEGMENT_ENFORCED_ELSEWHERE = {"team", "permissions"}

HQ_OWNER_EQUIVALENT_SUB_ROLES = {"owner", "super_admin"}

_HQ_MATRIX_TTL = 30  # secondi
_hq_matrix_cache: dict = {"expires": 0.0, "roles": {}}


def _hq_role_permissions(sub_role: str):
    now = time.monotonic()
    if now >= _hq_matrix_cache["expires"]:
        from accounts.models import HQRole

        _hq_matrix_cache["roles"] = {r.key: list(r.permissions) for r in HQRole.objects.all()}
        _hq_matrix_cache["expires"] = now + _HQ_MATRIX_TTL
    return _hq_matrix_cache["roles"].get(sub_role)


# ---------------------------------------------------------------------------
# HQ god-mode over /api/school/* and /api/chat/ (R2-H2 / X-R2-03).
#
# `is_hq()` used to be treated as unconditional god-mode by
# SchoolScopedModelViewSet and by chat/views.visible_conversations(): ANY HQ
# token — even a narrow role like `support`/`tech_support` whose permissions
# are only `["dashboard", "inbox"]` and which is correctly 403'd on
# /api/hq/team/ etc. by HQSectionGuardMiddleware below — could freely
# read/write/DELETE every school's operational data (courses, lessons,
# locations, rooms, closures, documents, plans, credits) and read/post into
# every school's private student/teacher chats, because neither
# SchoolSectionGuardMiddleware (school matrix, skipped entirely for any "hq"
# role) nor chat's `is_hq(user)` branch (unconditional `Conversation.objects
# .all()`) checked the HQ role's own permission matrix at all.
#
# `schools_create_edit` is the existing HQRole permission (see
# accounts/migrations/0004_seed_hq_roles.py) that already means "this HQ role
# manages schools' operational content" — `operations` holds it alongside
# owner/super_admin, while `finance`/`analytics` hold only the read-only
# `schools_view` and `support`/`tech_support` hold neither. Reusing it (rather
# than inventing a new permission key) keeps a single HQ role with genuine
# day-to-day cross-school responsibility (operations) able to act exactly as
# before, while narrow roles lose the blanket bypass.
# ---------------------------------------------------------------------------

HQ_SCHOOL_GODMODE_PERMISSION = "schools_create_edit"


def hq_permission_set(user):
    """The HQ user's effective permission list, or None when unrestricted
    (owner/super_admin-equivalent, or one of the existing HQ-guard fail-open
    states: no sub-role at all, or a sub-role outside the matrix)."""
    sub_role = user.effective_hq_sub_role()
    if sub_role in HQ_OWNER_EQUIVALENT_SUB_ROLES or not sub_role:
        return None
    permissions = _hq_role_permissions(sub_role)
    if permissions is None:
        return None
    return permissions


def hq_school_godmode(user) -> bool:
    """Whether this HQ user keeps unrestricted cross-school access to
    /api/school/* (and, in chat, to every conversation type)."""
    permissions = hq_permission_set(user)
    return permissions is None or HQ_SCHOOL_GODMODE_PERMISSION in permissions


def hq_has_permission(user, key: str) -> bool:
    permissions = hq_permission_set(user)
    return permissions is None or key in permissions


def _hq_section_for(segment, method, path):
    """La sezione della matrice richiesta da questo (segmento, metodo, path).

    Solo "schools" ha bisogno della coda del path: `SchoolViewSet` copre
    lettura, creazione/modifica e le action `activate`/`deactivate` sotto lo
    stesso segmento — tre chiavi diverse della matrice (`schools_view`,
    `schools_create_edit`, `schools_activate`). Le altre sezioni non separano
    per action nella view, quindi una sola chiave per segmento basta (lato
    sicuro, senza inventare granularità che il codice non ha).
    """
    if segment == "schools":
        tail = path[len("/api/hq/schools/"):].strip("/")
        last = tail.rsplit("/", 1)[-1] if tail else ""
        if last in ("activate", "deactivate"):
            return "schools_activate"
        if method in SAFE_METHODS:
            return "schools_view"
        return "schools_create_edit"
    return HQ_SECTION_BY_SEGMENT.get(segment)


class HQSectionGuardMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        denied = self._check(request)
        if denied is not None:
            return denied
        return self.get_response(request)

    def _check(self, request):
        path = request.path
        if not path.startswith("/api/hq/"):
            return None
        segment = path[len("/api/hq/"):].split("/", 1)[0]
        if not segment or segment in HQ_SEGMENT_ENFORCED_ELSEWHERE:
            return None

        section = _hq_section_for(segment, request.method, path)
        if section is None:
            return None  # segmento non mappato: non tocchiamo ciò che non conosciamo

        user = SchoolSectionGuardMiddleware._authenticate(request)
        if user is None:
            return None  # la view risponderà 401 se serve

        roles = user.roles or []
        if "hq" not in roles and getattr(user, "role", None) != "hq":
            return None  # non HQ: IsHQ/altre permission risponderanno

        # effective_hq_sub_role(), non la colonna piatta: HQMember.sub_role è
        # la fonte di verità (stesso problema di school_sub_role/
        # effective_school_sub_role, vedi il docstring del metodo). La colonna
        # piatta resta vuota per gli account seed di qa_platform.py (e
        # probabilmente altri percorsi) — leggerla direttamente qui avrebbe
        # fatto fail-open silenziosamente per quegli account, vanificando
        # l'intero guard proprio sugli stessi account con cui il report QA
        # aveva dimostrato il buco originale.
        sub_role = user.effective_hq_sub_role()
        if sub_role in HQ_OWNER_EQUIVALENT_SUB_ROLES:
            return None  # owner/super_admin: bypass esplicito, oltre a avere già i 18 permessi

        if not sub_role:
            # HQ senza sub-ruolo (nessuna riga HQMember e colonna piatta
            # vuota): fail-open come un ruolo fuori matrice. La chiusura reale
            # per questi endpoint resta comunque `IsHQ` a monte.
            return None

        permissions = _hq_role_permissions(sub_role)
        if permissions is None:
            return None  # sub-ruolo fuori matrice: fail-open, come il guard scuola

        if section in permissions:
            return None
        return JsonResponse({"error": "section_forbidden", "section": section}, status=403)
