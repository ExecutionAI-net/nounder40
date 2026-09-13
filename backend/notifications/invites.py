"""Contesto condiviso degli inviti (R2-M20a).

Lo stesso template `team_invite` serve quattro flussi diversi — membro HQ,
titolare/staff di una scuola, insegnante — e la copia parlava sempre e solo
del "team di Danza Classica No Under 40": chi riceveva l'invito non sapeva
da quale scuola arrivasse ne' con quale ruolo. Il template ora nomina
`{{invite_org}}` e `{{invite_role}}`; qui si costruiscono quei due valori.

Le etichette dei ruoli vengono dal DB (`HQRole.label`, `SchoolRole.label`,
CLAUDE.md §4.5: la matrice ruoli non si incolla nel codice). L'unica etichetta
scritta a mano e' "insegnante", che non e' una riga di matrice ma il ruolo
`Role.TEACHER` del prodotto, e va comunque tradotta nelle cinque lingue.
"""

from .builtin_templates import PLATFORM_NAME

# Il "posto" a cui si viene invitati quando l'invito arriva da HQ.
HQ_ORG_NAME = f"{PLATFORM_NAME} HQ"

# Fallback quando la matrice non ha (ancora) una label per quella chiave.
_ROLE_FALLBACK = {
    "en": "team member", "it": "membro del team", "es": "miembro del equipo",
    "fr": "membre de l'équipe", "de": "Teammitglied",
}

_TEACHER_LABEL = {
    "en": "teacher", "it": "insegnante", "es": "profesora",
    "fr": "professeure", "de": "Lehrerin",
}


def _fallback(locale: str) -> str:
    return _ROLE_FALLBACK.get(locale) or _ROLE_FALLBACK["en"]


def hq_role_label(sub_role: str, locale: str = "en") -> str:
    from accounts.models import HQRole

    row = HQRole.objects.filter(key=sub_role).only("label").first() if sub_role else None
    return (row.label if row and row.label else sub_role) or _fallback(locale)


def school_role_label(sub_role: str, locale: str = "en") -> str:
    from schools.models import SchoolRole

    row = SchoolRole.objects.filter(key=sub_role).only("label").first() if sub_role else None
    return (row.label if row and row.label else sub_role) or _fallback(locale)


def teacher_role_label(locale: str = "en") -> str:
    return _TEACHER_LABEL.get(locale) or _TEACHER_LABEL["en"]


def invite_context(*, org_name: str, role_label: str, locale: str = "en") -> dict:
    """Le due variabili che ogni copia dell'invito si aspetta."""
    return {
        "invite_org": org_name or PLATFORM_NAME,
        "invite_role": role_label or _fallback(locale),
    }


def login_url(locale: str = "en") -> str:
    from django.conf import settings

    loc = locale if locale in ("en", "it", "es", "fr", "de") else "en"
    return f"{settings.FRONTEND_URL}/{loc}/login"


def send_team_added_email(user, *, org_name: str, role_label: str, locale: str = "en") -> bool:
    """`team_added`: chi ha già un account con password viene aggiunta al team
    senza link "scegli la password" (SCH-R4-05) ma con l'avviso di dove
    entrare. Stessa forma degli inviti: coda dopo il commit, ritorna se
    l'email partirà davvero (interruttore in HQ > E-mail), così il chiamante
    lo dice onestamente (R2-H15)."""
    from django.db import transaction

    from .emails import is_enabled
    from .tasks import send_transactional_email_task

    email_sent = is_enabled("team_added")
    context = {
        "user_name": user.full_name or user.email, "user_first_name": user.first_name_display,
        "platform_name": PLATFORM_NAME, "login_url": login_url(locale),
        **invite_context(org_name=org_name, role_label=role_label, locale=locale),
    }
    transaction.on_commit(
        lambda: send_transactional_email_task.delay(
            to_email=user.email, to_name=user.full_name, key="team_added", context=context, locale=locale,
        )
    )
    return email_sent
