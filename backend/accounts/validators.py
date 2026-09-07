"""Validatori di password specifici del prodotto.

Django offre ``UserAttributeSimilarityValidator``, ma confronta la password
con *tutti* gli attributi dell'utente — nome e cognome compresi — con una
soglia di somiglianza. Quel comportamento e' gia' stato provato e ritirato
(89e9059): una ballerina di nome Alina che sceglie "Alina1812" veniva
rifiutata senza capire perche', e nome+cifre e' esattamente la password che
la maggior parte delle iscritte sceglie. La regola mostrata su ogni form
resta "8+ caratteri, lettere e numeri".

QA R2-M17 segnalava pero' un caso diverso e davvero indifendibile: la
password poteva essere *identica alla parte locale dell'e-mail*
("qa-r2-student-s2" per qa-r2-student-s2@uberip.com), cioe' il dato che un
attaccante conosce sempre per primo.

Questo validatore chiude solo quel caso. Niente soglia di somiglianza: con
qualsiasi soglia utile "alina1812" e "alina" stanno a 0.714 e verrebbero
rifiutati di nuovo, riaprendo il caso del 2026-09-06. La regola qui e'
un'uguaglianza, non una distanza — la password normalizzata non puo'
coincidere con l'e-mail (o con la sua parte locale). "Alina1812" passa,
"alina" per alina@example.com no.
"""

import re

from django.core.exceptions import ValidationError
from django.utils.translation import gettext as _

# Maiuscole, punti, trattini e underscore non aggiungono segreto: "Qa-R2_S2" e
# "qar2s2" vanno trattati come la stessa cosa della parte locale dell'e-mail.
_NOISE = re.compile(r"[^a-z0-9]+")


def _normalize(value: str) -> str:
    return _NOISE.sub("", value.lower())


class EmailSimilarityValidator:
    """Rifiuta una password che coincide con l'e-mail dell'utente.

    Confronta solo con l'e-mail — mai con nome o cognome — e solo per
    uguaglianza dopo la normalizzazione, cosi' "name+digits" resta valido.
    """

    def validate(self, password, user=None):
        # Senza utente non c'e' e-mail da confrontare. I tre flussi che
        # cambiano una password (register, password-reset-confirm,
        # change-password) passano sempre `user=`.
        email = (getattr(user, "email", "") or "").strip()
        if not password or not email:
            return

        value = _normalize(password)
        if not value:
            return

        local_part = email.split("@", 1)[0]
        forbidden = {_normalize(email), _normalize(local_part)}
        forbidden.discard("")

        if value in forbidden:
            raise ValidationError(
                _("The password is too similar to the email."),
                # Codice gia' tradotto dalla pagina di reset, vedi
                # accounts/views.password_reset_confirm_view.
                code="password_too_similar",
                params={"verbose_name": _("email")},
            )

    def get_help_text(self):
        return _("Your password can't be the same as your email address.")
