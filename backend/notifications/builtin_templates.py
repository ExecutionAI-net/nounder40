"""Built-in fallback templates for the account-critical transactional emails.

Most emails are content the school or HQ writes in HQ > Emails, and not having
written one yet is a legitimate "don't send". Two are different: password reset
and team invite are how a person gets *into* the platform at all. Before the
Django migration Supabase Auth sent both from its own built-in templates, so no
row for them ever existed in `email_templates`; afterwards every one of them was
dropped in silence. These fallbacks make those two flows work out of the box.

A row saved in HQ > Emails always wins (see emails.send_transactional_email) —
this is the floor, not the ceiling. The HQ email on/off switch also still wins,
so an explicitly disabled email stays disabled.

The "we miss you" courtesy emails (winback cron, 30/90 days) ship built-ins
too, so the daily task works out of the box; HQ can still rewrite the copy
in the editor at any time.

Bodies keep their {{placeholders}} so the normal render() pass fills them in
exactly as it does for DB templates. The markup mirrors BASE_HTML_TEMPLATE in
the HQ editor (560px card, #6B1F3A header, table layout for mail clients).
"""

BRAND_COLOR = "#6B1F3A"
PLATFORM_NAME = "No Under 40"
PLATFORM_TAGLINE = "Classical Dance Network"

DEFAULT_LOCALE = "en"


def _shell(*, heading: str, intro: str, cta_label: str, cta_url: str, link_hint: str, note: str) -> str:
    """The branded card every built-in email uses.

    Inline styles and nested tables (not flexbox/divs) because Outlook and
    Gmail still drop most modern CSS.
    """
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06)">

        <tr>
          <td style="background:{BRAND_COLOR};padding:28px 40px;text-align:center">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px">{PLATFORM_NAME}</h1>
            <p style="margin:6px 0 0;color:#f3d4de;font-size:12px;letter-spacing:0.5px;text-transform:uppercase">{PLATFORM_TAGLINE}</p>
          </td>
        </tr>

        <tr>
          <td style="padding:40px 40px 32px">
            <h2 style="margin:0 0 16px;color:#111827;font-size:20px;font-weight:600">{heading}</h2>
            <p style="margin:0 0 28px;color:#6b7280;font-size:15px;line-height:1.7">{intro}</p>

            <table cellpadding="0" cellspacing="0" style="margin-bottom:28px">
              <tr>
                <td style="background:{BRAND_COLOR};border-radius:10px">
                  <a href="{cta_url}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none">{cta_label}</a>
                </td>
              </tr>
            </table>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;margin-bottom:24px">
              <tr>
                <td style="padding:16px 20px">
                  <p style="margin:0 0 6px;color:#9ca3af;font-size:12px">{link_hint}</p>
                  <p style="margin:0;color:#6b7280;font-size:12px;word-break:break-all">{cta_url}</p>
                </td>
              </tr>
            </table>

            <p style="margin:0;color:#9ca3af;font-size:13px;line-height:1.6">{note}</p>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 40px;background:#f9fafb;border-top:1px solid #f3f4f6;text-align:center">
            <p style="margin:0;color:#9ca3af;font-size:12px">{PLATFORM_NAME} · {PLATFORM_TAGLINE}</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


# Per-locale copy. Keep the locale set aligned with frontend/src/i18n/routing.ts.
_PASSWORD_RESET = {
    "en": {
        "subject": "Reset your No Under 40 password",
        "heading": "Hi {{user_name}},",
        "intro": "We received a request to reset the password for your No Under 40 account. "
                 "Choose a new one using the button below.",
        "cta_label": "Reset my password →",
        "link_hint": "Or paste this link into your browser:",
        "note": "This link can be used once and expires shortly. If you didn't ask for a new "
                "password, you can safely ignore this email — your current one stays active.",
    },
    "it": {
        "subject": "Reimposta la tua password No Under 40",
        "heading": "Ciao {{user_name}},",
        "intro": "Abbiamo ricevuto una richiesta di reimpostazione della password del tuo account "
                 "No Under 40. Scegline una nuova con il pulsante qui sotto.",
        "cta_label": "Reimposta la password →",
        "link_hint": "Oppure incolla questo link nel browser:",
        "note": "Il link è utilizzabile una sola volta e scade a breve. Se non hai richiesto una "
                "nuova password puoi ignorare questa email: quella attuale resta valida.",
    },
    "es": {
        "subject": "Restablece tu contraseña de No Under 40",
        "heading": "Hola {{user_name}}:",
        "intro": "Hemos recibido una solicitud para restablecer la contraseña de tu cuenta de "
                 "No Under 40. Elige una nueva con el botón de abajo.",
        "cta_label": "Restablecer mi contraseña →",
        "link_hint": "O pega este enlace en tu navegador:",
        "note": "Este enlace se puede usar una sola vez y caduca pronto. Si no has solicitado una "
                "contraseña nueva, puedes ignorar este correo: la actual sigue siendo válida.",
    },
    "fr": {
        "subject": "Réinitialisez votre mot de passe No Under 40",
        "heading": "Bonjour {{user_name}},",
        "intro": "Nous avons reçu une demande de réinitialisation du mot de passe de votre compte "
                 "No Under 40. Choisissez-en un nouveau à l'aide du bouton ci-dessous.",
        "cta_label": "Réinitialiser mon mot de passe →",
        "link_hint": "Ou collez ce lien dans votre navigateur :",
        "note": "Ce lien est utilisable une seule fois et expire rapidement. Si vous n'avez pas "
                "demandé de nouveau mot de passe, ignorez cet e-mail : l'actuel reste valable.",
    },
    "de": {
        "subject": "Setze dein No Under 40 Passwort zurück",
        "heading": "Hallo {{user_name}},",
        "intro": "Wir haben eine Anfrage erhalten, das Passwort deines No Under 40 Kontos "
                 "zurückzusetzen. Wähle über die Schaltfläche unten ein neues.",
        "cta_label": "Passwort zurücksetzen →",
        "link_hint": "Oder füge diesen Link in deinen Browser ein:",
        "note": "Der Link ist einmalig nutzbar und läuft bald ab. Wenn du kein neues Passwort "
                "angefordert hast, ignoriere diese E-Mail — dein aktuelles bleibt gültig.",
    },
}

_TEAM_INVITE = {
    "en": {
        "subject": "You've been invited to No Under 40",
        "heading": "Hi {{user_name}},",
        "intro": "You have been invited to join No Under 40. Set up your account to get started — "
                 "it only takes a moment.",
        "cta_label": "Set up my account →",
        "link_hint": "Or paste this link into your browser:",
        "note": "If you weren't expecting this invitation, you can safely ignore this email.",
    },
    "it": {
        "subject": "Sei stato invitato su No Under 40",
        "heading": "Ciao {{user_name}},",
        "intro": "Sei stato invitato a far parte di No Under 40. Configura il tuo account per "
                 "iniziare: bastano pochi istanti.",
        "cta_label": "Configura il mio account →",
        "link_hint": "Oppure incolla questo link nel browser:",
        "note": "Se non aspettavi questo invito puoi ignorare questa email.",
    },
    "es": {
        "subject": "Te han invitado a No Under 40",
        "heading": "Hola {{user_name}}:",
        "intro": "Te han invitado a unirte a No Under 40. Configura tu cuenta para empezar; "
                 "solo llevará un momento.",
        "cta_label": "Configurar mi cuenta →",
        "link_hint": "O pega este enlace en tu navegador:",
        "note": "Si no esperabas esta invitación, puedes ignorar este correo.",
    },
    "fr": {
        "subject": "Vous avez été invité sur No Under 40",
        "heading": "Bonjour {{user_name}},",
        "intro": "Vous avez été invité à rejoindre No Under 40. Configurez votre compte pour "
                 "commencer, cela ne prend qu'un instant.",
        "cta_label": "Configurer mon compte →",
        "link_hint": "Ou collez ce lien dans votre navigateur :",
        "note": "Si vous n'attendiez pas cette invitation, vous pouvez ignorer cet e-mail.",
    },
    "de": {
        "subject": "Du wurdest zu No Under 40 eingeladen",
        "heading": "Hallo {{user_name}},",
        "intro": "Du wurdest eingeladen, No Under 40 beizutreten. Richte dein Konto ein, um "
                 "loszulegen — es dauert nur einen Moment.",
        "cta_label": "Mein Konto einrichten →",
        "link_hint": "Oder füge diesen Link in deinen Browser ein:",
        "note": "Wenn du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.",
    },
}

_WE_MISS_YOU_1M = {
    "en": {
        "subject": "We miss you, {{student_name}} 💕",
        "heading": "Hi {{student_name}},",
        "intro": "It's been a month since your last lesson at {{school_name}}, and the barre "
                 "isn't the same without you. Your spot is still there waiting — one lesson is "
                 "all it takes to find your rhythm, the music and that moment of the week "
                 "that's all yours.",
        "cta_label": "Book a lesson →",
        "link_hint": "Or paste this link into your browser:",
        "note": "See you very soon — {{school_name}}. You're receiving this email because "
                "you're enrolled at {{school_name}} on No Under 40.",
    },
    "it": {
        "subject": "Ci manchi, {{student_name}} 💕",
        "heading": "Ciao {{student_name}},",
        "intro": "È passato un mese dalla tua ultima lezione da {{school_name}} e la sbarra "
                 "non è la stessa senza di te. Il tuo posto è sempre lì che ti aspetta: basta "
                 "una lezione per ritrovare il ritmo, la musica e quel momento tutto tuo "
                 "della settimana.",
        "cta_label": "Prenota una lezione →",
        "link_hint": "Oppure incolla questo link nel browser:",
        "note": "A prestissimo — {{school_name}}. Ricevi questa email perché sei iscritta a "
                "{{school_name}} su No Under 40.",
    },
    "es": {
        "subject": "Te echamos de menos, {{student_name}} 💕",
        "heading": "Hola {{student_name}}:",
        "intro": "Ha pasado un mes desde tu última clase en {{school_name}} y la barra no es "
                 "lo mismo sin ti. Tu sitio sigue ahí, esperándote: basta una clase para "
                 "recuperar el ritmo, la música y ese momento de la semana que es solo tuyo.",
        "cta_label": "Reservar una clase →",
        "link_hint": "O pega este enlace en tu navegador:",
        "note": "Hasta muy pronto — {{school_name}}. Recibes este correo porque estás "
                "inscrita en {{school_name}} en No Under 40.",
    },
    "fr": {
        "subject": "Tu nous manques, {{student_name}} 💕",
        "heading": "Bonjour {{student_name}},",
        "intro": "Un mois s'est écoulé depuis ton dernier cours chez {{school_name}}, et la "
                 "barre n'est plus la même sans toi. Ta place t'attend toujours : un seul "
                 "cours suffit pour retrouver le rythme, la musique et ce moment de la "
                 "semaine rien qu'à toi.",
        "cta_label": "Réserver un cours →",
        "link_hint": "Ou colle ce lien dans ton navigateur :",
        "note": "À très vite — {{school_name}}. Tu reçois cet e-mail car tu es inscrite chez "
                "{{school_name}} sur No Under 40.",
    },
    "de": {
        "subject": "Wir vermissen dich, {{student_name}} 💕",
        "heading": "Hallo {{student_name}},",
        "intro": "Seit deiner letzten Stunde bei {{school_name}} ist ein Monat vergangen — "
                 "und die Stange ist ohne dich nicht dieselbe. Dein Platz wartet noch auf "
                 "dich: Eine Stunde genügt, um Rhythmus, Musik und diesen Moment der Woche "
                 "nur für dich wiederzufinden.",
        "cta_label": "Stunde buchen →",
        "link_hint": "Oder füge diesen Link in deinen Browser ein:",
        "note": "Bis ganz bald — {{school_name}}. Du erhältst diese E-Mail, weil du bei "
                "{{school_name}} auf No Under 40 angemeldet bist.",
    },
}

_WE_MISS_YOU_3M = {
    "en": {
        "subject": "Dance is still waiting for you, {{student_name}} 🌹",
        "heading": "Hi {{student_name}},",
        "intro": "Three months have passed since your last lesson, and we want you to know: "
                 "at {{school_name}}, no one has taken your place. Life gets in the way "
                 "sometimes — but dance never asks for explanations: you start again from "
                 "where you are, not from where you left off. One lesson, no pressure, just "
                 "for the joy of being back in the studio.",
        "cta_label": "Pick your moment →",
        "link_hint": "Or paste this link into your browser:",
        "note": "See you very soon — {{school_name}}. You're receiving this email because "
                "you're enrolled at {{school_name}} on No Under 40.",
    },
    "it": {
        "subject": "La danza ti aspetta ancora, {{student_name}} 🌹",
        "heading": "Ciao {{student_name}},",
        "intro": "Sono passati tre mesi dalla tua ultima lezione e ci teniamo a dirtelo: da "
                 "{{school_name}} nessuno ha preso il tuo posto. La vita a volte si mette di "
                 "mezzo, ma la danza non chiede spiegazioni: si ricomincia da dove si è, non "
                 "da dove si era rimaste. Una lezione, senza pressioni, solo per il piacere "
                 "di tornare in sala.",
        "cta_label": "Scegli il tuo momento →",
        "link_hint": "Oppure incolla questo link nel browser:",
        "note": "A prestissimo — {{school_name}}. Ricevi questa email perché sei iscritta a "
                "{{school_name}} su No Under 40.",
    },
    "es": {
        "subject": "La danza sigue esperándote, {{student_name}} 🌹",
        "heading": "Hola {{student_name}}:",
        "intro": "Han pasado tres meses desde tu última clase y queremos que lo sepas: en "
                 "{{school_name}} nadie ha ocupado tu lugar. A veces la vida se cruza en el "
                 "camino, pero la danza no pide explicaciones: se vuelve a empezar desde "
                 "donde estás, no desde donde lo dejaste. Una clase, sin presión, solo por "
                 "el placer de volver a la sala.",
        "cta_label": "Elige tu momento →",
        "link_hint": "O pega este enlace en tu navegador:",
        "note": "Hasta muy pronto — {{school_name}}. Recibes este correo porque estás "
                "inscrita en {{school_name}} en No Under 40.",
    },
    "fr": {
        "subject": "La danse t'attend encore, {{student_name}} 🌹",
        "heading": "Bonjour {{student_name}},",
        "intro": "Trois mois se sont écoulés depuis ton dernier cours, et nous tenons à te "
                 "le dire : chez {{school_name}}, personne n'a pris ta place. La vie s'en "
                 "mêle parfois, mais la danse ne demande pas d'explications : on reprend là "
                 "où l'on est, pas là où l'on s'était arrêtée. Un cours, sans pression, "
                 "juste pour le plaisir de revenir en studio.",
        "cta_label": "Choisis ton moment →",
        "link_hint": "Ou colle ce lien dans ton navigateur :",
        "note": "À très vite — {{school_name}}. Tu reçois cet e-mail car tu es inscrite chez "
                "{{school_name}} sur No Under 40.",
    },
    "de": {
        "subject": "Der Tanz wartet noch auf dich, {{student_name}} 🌹",
        "heading": "Hallo {{student_name}},",
        "intro": "Seit deiner letzten Stunde sind drei Monate vergangen, und das sollst du "
                 "wissen: Bei {{school_name}} hat niemand deinen Platz eingenommen. Manchmal "
                 "kommt das Leben dazwischen — doch der Tanz verlangt keine Erklärungen: Man "
                 "beginnt dort wieder, wo man ist, nicht dort, wo man aufgehört hat. Eine "
                 "Stunde, ohne Druck, einfach aus Freude, wieder im Saal zu sein.",
        "cta_label": "Wähl deinen Moment →",
        "link_hint": "Oder füge diesen Link in deinen Browser ein:",
        "note": "Bis ganz bald — {{school_name}}. Du erhältst diese E-Mail, weil du bei "
                "{{school_name}} auf No Under 40 angemeldet bist.",
    },
}

# key → (per-locale copy, the context variable holding the destination URL)
# La lezione si e' riempita (o e' stata annullata) mentre l'allieva pagava.
# Senza questo template la mail non partirebbe affatto: il centro notifiche
# studente non esiste come pagina, quindi l'allieva vedrebbe solo dei crediti
# comparsi nel portafoglio senza spiegazione. Il credito NON e' un rimborso in
# denaro (DROP_IN_BOOKING.md §3.3) e va detto chiaramente.
_DROP_IN_BOOKING_FAILED = {
    "en": {
        "subject": "Your payment went through, but the lesson filled up",
        "heading": "Hi {{student_name}},",
        "intro": "Your payment for the {{lesson_date}} at {{lesson_time}} lesson with "
                 "{{school_name}} went through, but the class filled up in the meantime, so we "
                 "could not book your place. Your credit is safe in your wallet and you can use "
                 "it on another lesson of the same kind whenever you like.",
        "cta_label": "Pick another lesson →",
        "link_hint": "Or paste this link into your browser:",
        "note": "This is a credit, not a refund to your card. If you would rather have your "
                "money back, reply to this email or contact {{school_name}} directly.",
    },
    "it": {
        "subject": "Il pagamento è andato a buon fine, ma la lezione si è riempita",
        "heading": "Ciao {{student_name}},",
        "intro": "Il pagamento per la lezione del {{lesson_date}} alle {{lesson_time}} con "
                 "{{school_name}} è andato a buon fine, ma nel frattempo la classe si è riempita "
                 "e non siamo riusciti a prenotare il tuo posto. Il tuo credito è al sicuro nel "
                 "portafoglio e puoi usarlo su un'altra lezione dello stesso tipo quando vuoi.",
        "cta_label": "Scegli un'altra lezione →",
        "link_hint": "Oppure incolla questo link nel browser:",
        "note": "Si tratta di un credito, non di un rimborso sulla carta. Se preferisci "
                "riavere i soldi, rispondi a questa email o contatta direttamente {{school_name}}.",
    },
    "es": {
        "subject": "Tu pago se ha completado, pero la clase se ha llenado",
        "heading": "Hola {{student_name}},",
        "intro": "El pago de la clase del {{lesson_date}} a las {{lesson_time}} con "
                 "{{school_name}} se ha completado, pero mientras tanto la clase se ha llenado y "
                 "no hemos podido reservar tu plaza. Tu crédito está a salvo en tu monedero y "
                 "puedes usarlo en otra clase del mismo tipo cuando quieras.",
        "cta_label": "Elige otra clase →",
        "link_hint": "O pega este enlace en tu navegador:",
        "note": "Es un crédito, no un reembolso a tu tarjeta. Si prefieres recuperar el "
                "dinero, responde a este correo o contacta directamente con {{school_name}}.",
    },
    "fr": {
        "subject": "Votre paiement est passé, mais le cours est complet",
        "heading": "Bonjour {{student_name}},",
        "intro": "Le paiement du cours du {{lesson_date}} à {{lesson_time}} avec "
                 "{{school_name}} est bien passé, mais le cours est entre-temps devenu complet "
                 "et nous n'avons pas pu réserver votre place. Votre crédit est en sécurité dans "
                 "votre portefeuille et vous pouvez l'utiliser sur un autre cours du même type "
                 "quand vous le souhaitez.",
        "cta_label": "Choisir un autre cours →",
        "link_hint": "Ou collez ce lien dans votre navigateur :",
        "note": "Il s'agit d'un crédit, pas d'un remboursement sur votre carte. Si vous "
                "préférez être remboursée, répondez à cet e-mail ou contactez directement "
                "{{school_name}}.",
    },
    "de": {
        "subject": "Deine Zahlung ist angekommen, aber die Stunde ist voll",
        "heading": "Hallo {{student_name}},",
        "intro": "Deine Zahlung für die Stunde am {{lesson_date}} um {{lesson_time}} bei "
                 "{{school_name}} ist angekommen, aber der Kurs ist inzwischen voll geworden, "
                 "sodass wir deinen Platz nicht buchen konnten. Dein Guthaben liegt sicher in "
                 "deiner Brieftasche und du kannst es jederzeit für eine andere Stunde derselben "
                 "Art einsetzen.",
        "cta_label": "Andere Stunde wählen →",
        "link_hint": "Oder füge diesen Link in deinen Browser ein:",
        "note": "Das ist ein Guthaben, keine Rückerstattung auf deine Karte. Wenn du lieber "
                "dein Geld zurück möchtest, antworte auf diese E-Mail oder wende dich direkt an "
                "{{school_name}}.",
    },
}


_BUILTINS = {
    "password_reset": (_PASSWORD_RESET, "reset_url"),
    "team_invite": (_TEAM_INVITE, "setup_url"),
    "student.we_miss_you_1m": (_WE_MISS_YOU_1M, "booking_url"),
    "student.we_miss_you_3m": (_WE_MISS_YOU_3M, "booking_url"),
    "student.drop_in_booking_failed": (_DROP_IN_BOOKING_FAILED, "booking_url"),
}

# The HQ editor namespaces its keys ("student.welcome"); accept both spellings
# so a namespaced call site still resolves to the same fallback.
_ALIASES = {
    "account.password_reset": "password_reset",
    "account.team_invite": "team_invite",
    "we_miss_you_1m": "student.we_miss_you_1m",
    "we_miss_you_3m": "student.we_miss_you_3m",
    "drop_in_booking_failed": "student.drop_in_booking_failed",
}


def has_builtin(key: str) -> bool:
    return _resolve_key(key) is not None


def _resolve_key(key: str) -> str | None:
    if key in _BUILTINS:
        return key
    return _ALIASES.get(key)


def get_builtin(key: str, locale: str = DEFAULT_LOCALE) -> tuple[str, str] | None:
    """(subject, body_html) with {{placeholders}} intact, or None if this key
    has no built-in fallback. Unknown locales fall back to English."""
    resolved = _resolve_key(key)
    if resolved is None:
        return None

    copy_by_locale, url_var = _BUILTINS[resolved]
    copy = copy_by_locale.get(locale) or copy_by_locale[DEFAULT_LOCALE]

    body = _shell(
        heading=copy["heading"],
        intro=copy["intro"],
        cta_label=copy["cta_label"],
        cta_url=f"{{{{{url_var}}}}}",
        link_hint=copy["link_hint"],
        note=copy["note"],
    )
    return copy["subject"], body
