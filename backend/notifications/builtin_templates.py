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

# key → (per-locale copy, the context variable holding the destination URL)
_BUILTINS = {
    "password_reset": (_PASSWORD_RESET, "reset_url"),
    "team_invite": (_TEAM_INVITE, "setup_url"),
}

# The HQ editor namespaces its keys ("student.welcome"); accept both spellings
# so a namespaced call site still resolves to the same fallback.
_ALIASES = {
    "account.password_reset": "password_reset",
    "account.team_invite": "team_invite",
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
