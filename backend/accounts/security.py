"""Revoca degli accessi (R2-M19).

Due buchi dello stesso tipo, trovati dal giro 2 di QA:

* un membro HQ **rimosso** spariva dall'elenco ma restava a tutti gli effetti
  HQ: `User.role` continuava a valere `hq`, quindi il suo token entrava
  ancora in `/api/chat/` e in `/api/school/*?school=` — anzi, senza piu' la
  riga `HQMember` il suo sub-ruolo diventava vuoto e ogni guardia HQ, che per
  un sub-ruolo vuoto va in fail-open, gli apriva *piu'* porte di prima;
* **disattivare una scuola** fermava solo la vetrina pubblica e le
  prenotazioni: i suoi membri continuavano a fare login e a leggere/scrivere
  ogni `/api/school/*` della scuola disattivata.

Qui vivono i mattoni comuni: togliere un ruolo senza toccare gli altri (gli
account multi-ruolo del RoleSwitcher devono restare utilizzabili) e invalidare
i refresh token in circolazione. Gli access token durano al massimo
`JWT_ACCESS_MINUTES`, ma non serve aspettarli: `JWTAuthentication` ricarica
sempre l'utente dal DB, quindi il ruolo revocato qui vale gia' al prossimo
colpo di token.
"""

import logging

logger = logging.getLogger(__name__)


def blacklist_user_tokens(user) -> int:
    """Invalida ogni refresh token in circolazione dell'utente.

    `rest_framework_simplejwt.token_blacklist` e' gia' installato (vedi
    INSTALLED_APPS): senza questo passaggio un membro appena rimosso potrebbe
    continuare a rinnovarsi l'access token per giorni.
    """
    try:
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
    except ImportError:  # pragma: no cover — app non installata
        return 0

    blacklisted = 0
    for token in OutstandingToken.objects.filter(user=user):
        _, created = BlacklistedToken.objects.get_or_create(token=token)
        blacklisted += int(created)
    return blacklisted


def _has_other_access(user) -> bool:
    """L'utente ha ancora un modo legittimo di usare la piattaforma?

    Non basta guardare `roles`: un profilo puo' avere la riga Student o
    Teacher senza che il ruolo sia mai finito nell'array (dati ETL). Nel
    dubbio si lascia il profilo attivo — disattivare per sbaglio l'account di
    un'allieva sarebbe un danno peggiore del buco che stiamo chiudendo.
    """
    from schools.models import SchoolMembership

    if [r for r in (user.roles or []) if r]:
        return True
    if getattr(user, "is_superuser", False) or getattr(user, "is_staff", False):
        return True
    if SchoolMembership.objects.filter(profile=user).exists():
        return True
    from students.models import Student
    from teachers.models import Teacher

    return Student.objects.filter(user=user).exists() or Teacher.objects.filter(user=user).exists()


def revoke_role(user, role: str) -> None:
    """Toglie UN ruolo lasciando intatti gli altri (RoleSwitcher).

    Se non resta nessun ruolo ne' alcun profilo utilizzabile, il profilo viene
    disattivato: da quel momento `JWTAuthentication` risponde 401 su
    qualunque endpoint e il login non passa piu'.
    """
    fields = []
    roles = [r for r in (user.roles or []) if r and r != role]
    if roles != (user.roles or []):
        user.roles = roles
        fields.append("roles")
    if user.role == role:
        user.role = roles[0] if roles else ""
        fields.append("role")
    if role == "hq" and user.hq_sub_role:
        user.hq_sub_role = ""
        fields.append("hq_sub_role")
    if role == "school" and user.school_sub_role:
        user.school_sub_role = ""
        fields.append("school_sub_role")
    if not _has_other_access(user) and user.is_active:
        user.is_active = False
        fields.append("is_active")
    if fields:
        user.save(update_fields=fields)
    blacklist_user_tokens(user)
    logger.info("revoked role %s from user %s (remaining: %s)", role, user.pk, user.roles)


def grant_role(user, role: str, *, hq_sub_role: str | None = None) -> None:
    """Il contrario di `revoke_role`: rende di nuovo utilizzabile un accesso.

    R3-H3: `revoke_role()` disattiva il profilo quando non resta nessun ruolo
    ne' alcun altro accesso — ed e' giusto — ma nessun percorso di prodotto lo
    riattivava. Un membro HQ rimosso e poi re-invitato tornava nell'elenco del
    Team (`approve()` ricrea la riga HQMember e la pagina lo mostra) e
    continuava a ricevere 401 "No active account found" per sempre: `roles`
    era rimasto vuoto, `role` vuoto, `is_active` False. Riapprovare un invito
    e' esattamente l'atto con cui HQ ridichiara che quella persona deve poter
    entrare, quindi e' li' che l'accesso torna.

    Stesso buco, meno visibile, per un account che gia' esisteva con un altro
    ruolo (un'insegnante invitata in HQ): la riga HQMember nasceva, ma senza
    "hq" fra i `roles` nessuna guardia HQ lo riconosceva.

    Quello che NON torna sono i refresh token: la rimozione li blacklista e
    restano blacklistati. La proprieta' di sicurezza di R2-M19 (le sessioni
    aperte muoiono subito) resta intatta; la persona rientra dal link
    d'invito o dal login, con una sessione nuova.
    """
    fields = []
    roles = [r for r in (user.roles or []) if r]
    if role not in roles:
        roles.append(role)
        user.roles = roles
        fields.append("roles")
    if not user.role:
        # `role` e' il ruolo primario: si riempie solo se vuoto, altrimenti un
        # invito HQ ribalterebbe il ruolo principale di un account multi-ruolo.
        user.role = role
        fields.append("role")
    if hq_sub_role is not None and user.hq_sub_role != hq_sub_role:
        user.hq_sub_role = hq_sub_role
        fields.append("hq_sub_role")
    if not user.is_active:
        # `revoke_role` e' l'unico punto del codice che disattiva un profilo,
        # quindi riattivare qui non puo' annullare una sospensione decisa
        # altrove: non ne esistono.
        user.is_active = True
        fields.append("is_active")
    if fields:
        user.save(update_fields=fields)
    logger.info("granted role %s to user %s (now: %s)", role, user.pk, user.roles)


def grant_hq_membership(user, *, sub_role: str) -> None:
    """Approvazione di un invito HQ: il ruolo `hq` c'e' davvero."""
    grant_role(user, "hq", hq_sub_role=sub_role)


def revoke_hq_membership(user) -> None:
    """Rimozione di un membro dal team HQ: il ruolo `hq` sparisce davvero."""
    revoke_role(user, "hq")


def lock_out_school_members(school) -> int:
    """Disattivazione di una scuola: i suoi membri devono rifare login.

    Non si tocca ne' il ruolo ne' la membership — la scuola puo' essere
    riattivata e tutto deve tornare com'era. Si invalidano solo i refresh
    token: chi ha ancora un access token valido viene comunque fermato dal
    guard di sezione (`core.section_guard`), che rilegge `School.active` a
    ogni richiesta.
    """
    from schools.models import SchoolMembership

    count = 0
    for membership in SchoolMembership.objects.filter(school=school).select_related("profile"):
        blacklist_user_tokens(membership.profile)
        count += 1
    return count


def has_usable_access(user) -> bool:
    """Se questo profilo puo' avere una sessione utile (usato al login).

    Un utente il cui unico ruolo e' `school` e le cui uniche membership sono
    su scuole disattivate non deve ricevere token: non c'e' un solo endpoint
    che potrebbe usare.
    """
    from schools.models import SchoolMembership

    roles = {r for r in (user.roles or []) if r}
    if user.role:
        roles.add(user.role)
    if getattr(user, "is_superuser", False) or getattr(user, "is_staff", False):
        return True
    if roles - {"school"}:
        return True
    if not roles:
        # Nessun ruolo dichiarato: decide `is_active`, come sempre.
        return True
    return SchoolMembership.objects.filter(profile=user, school__active=True).exists()
