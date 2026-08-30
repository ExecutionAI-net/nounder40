"""Brand copy for every HQ > Emails template, five languages.

Warm and welcoming, the voice of Danza Classica No Under 40 (Alina's
example: "Ricorda: i sogni non hanno età. 🩰"). Seeded into the HQ-global
EmailTemplate rows by a migration; HQ can then edit anything in the editor.

Body syntax (kept readable here, turned into the editor's HTML by body_html):
- blank line = new paragraph, single newline = line break;
- a line "[Label|{{url}}]" = a CTA button (same markup as the editor's 🔘).
"""

from html import escape

BRAND = "#6B1F3A"


def _button(label: str, href: str) -> str:
    return (
        f'<div data-email-button="1" data-color="{BRAND}" data-align="left" style="text-align:left;margin:12px 0">'
        f'<a href="{escape(href, quote=True)}" style="display:inline-block;background:{BRAND};color:#ffffff;'
        f'padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">{escape(label)}</a></div>'
    )


def body_html(text: str) -> str:
    parts = []
    for para in text.strip().split("\n\n"):
        para = para.strip()
        if para.startswith("[") and para.endswith("]") and "|" in para:
            label, href = para[1:-1].split("|", 1)
            parts.append(_button(label.strip(), href.strip()))
        else:
            parts.append("<p>" + "<br>".join(escape(line) for line in para.split("\n")) + "</p>")
    return "".join(parts)


SIGN = {
    "it": "A presto,\nAlina Quintana\nDanza Classica No Under 40",
    "en": "See you soon,\nAlina Quintana\nDanza Classica No Under 40",
    "es": "Hasta pronto,\nAlina Quintana\nDanza Classica No Under 40",
    "fr": "À bientôt,\nAlina Quintana\nDanza Classica No Under 40",
    "de": "Bis bald,\nAlina Quintana\nDanza Classica No Under 40",
}
TEAM = {
    "it": "Il team Danza Classica No Under 40",
    "en": "The Danza Classica No Under 40 team",
    "es": "El equipo de Danza Classica No Under 40",
    "fr": "L'équipe Danza Classica No Under 40",
    "de": "Das Team von Danza Classica No Under 40",
}

# key → locale → (subject, body text)
TEMPLATES: dict[str, dict[str, tuple[str, str]]] = {}


def _t(key: str, **per_locale: tuple[str, str]) -> None:
    TEMPLATES[key] = per_locale


_t("student.welcome",
   it=("🩰 Benvenuta in Danza Classica No Under 40!",
       "Ciao {{student_first_name}} 🌸\n\nbenvenuta nel mondo di Danza Classica No Under 40!\n\n"
       "Siamo felici di averti con noi in questo percorso dedicato alle donne che vogliono vivere o riscoprire il sogno della danza classica, a qualsiasi età. ✨\n\n"
       "Il tuo account è già attivo. Dal tuo spazio personale potrai completare il tuo profilo, gestire le tue lezioni e, quando vorrai, modificare la tua password.\n\n"
       "[✨ Vai al mio profilo|{{profile_url}}]\n\n"
       "Da oggi hai il tuo spazio personale per vivere ancora più facilmente la tua esperienza con noi.\n\n"
       "Ricorda: i sogni non hanno età. 🩰\n\n" + SIGN["it"]),
   en=("🩰 Welcome to Danza Classica No Under 40!",
       "Hi {{student_first_name}} 🌸\n\nwelcome to the world of Danza Classica No Under 40!\n\n"
       "We are so happy to have you with us on this journey for women who want to live — or rediscover — the dream of classical ballet, at any age. ✨\n\n"
       "Your account is already active. From your personal space you can complete your profile, manage your lessons and, whenever you like, change your password.\n\n"
       "[✨ Go to my profile|{{profile_url}}]\n\n"
       "From today you have a space of your own to enjoy your experience with us even more easily.\n\n"
       "Remember: dreams have no age. 🩰\n\n" + SIGN["en"]),
   es=("🩰 ¡Bienvenida a Danza Classica No Under 40!",
       "Hola {{student_first_name}} 🌸\n\n¡bienvenida al mundo de Danza Classica No Under 40!\n\n"
       "Nos alegra mucho tenerte con nosotras en este camino dedicado a las mujeres que quieren vivir o redescubrir el sueño de la danza clásica, a cualquier edad. ✨\n\n"
       "Tu cuenta ya está activa. Desde tu espacio personal podrás completar tu perfil, gestionar tus clases y, cuando quieras, cambiar tu contraseña.\n\n"
       "[✨ Ir a mi perfil|{{profile_url}}]\n\n"
       "Desde hoy tienes tu espacio personal para vivir tu experiencia con nosotras aún más fácilmente.\n\n"
       "Recuerda: los sueños no tienen edad. 🩰\n\n" + SIGN["es"]),
   fr=("🩰 Bienvenue chez Danza Classica No Under 40 !",
       "Bonjour {{student_first_name}} 🌸\n\nbienvenue dans l'univers de Danza Classica No Under 40 !\n\n"
       "Nous sommes ravies de vous accueillir dans ce parcours dédié aux femmes qui veulent vivre ou redécouvrir le rêve de la danse classique, à tout âge. ✨\n\n"
       "Votre compte est déjà actif. Depuis votre espace personnel, vous pouvez compléter votre profil, gérer vos cours et, quand vous le souhaitez, modifier votre mot de passe.\n\n"
       "[✨ Accéder à mon profil|{{profile_url}}]\n\n"
       "Dès aujourd'hui, vous avez un espace à vous pour vivre votre expérience avec nous encore plus simplement.\n\n"
       "N'oubliez pas : les rêves n'ont pas d'âge. 🩰\n\n" + SIGN["fr"]),
   de=("🩰 Willkommen bei Danza Classica No Under 40!",
       "Hallo {{student_first_name}} 🌸\n\nwillkommen in der Welt von Danza Classica No Under 40!\n\n"
       "Wir freuen uns sehr, dich auf diesem Weg zu begleiten – für Frauen, die den Traum vom klassischen Ballett leben oder wiederentdecken möchten, in jedem Alter. ✨\n\n"
       "Dein Konto ist bereits aktiv. In deinem persönlichen Bereich kannst du dein Profil vervollständigen, deine Stunden verwalten und jederzeit dein Passwort ändern.\n\n"
       "[✨ Zu meinem Profil|{{profile_url}}]\n\n"
       "Ab heute hast du deinen eigenen Bereich, um deine Zeit mit uns noch einfacher zu genießen.\n\n"
       "Denk daran: Träume haben kein Alter. 🩰\n\n" + SIGN["de"]))

_t("password_reset",
   it=("🔑 Reimposta la tua password", "Ciao {{user_name}} 🌸\n\nabbiamo ricevuto la richiesta di reimpostare la password del tuo account Danza Classica No Under 40.\n\n[🔑 Scegli una nuova password|{{reset_url}}]\n\nIl link vale una sola volta e scade a breve. Se non sei stata tu, ignora questa email: la tua password attuale resta valida.\n\n" + SIGN["it"]),
   en=("🔑 Reset your password", "Hi {{user_name}} 🌸\n\nwe received a request to reset the password of your Danza Classica No Under 40 account.\n\n[🔑 Choose a new password|{{reset_url}}]\n\nThe link works once and expires shortly. If it wasn't you, just ignore this email: your current password stays valid.\n\n" + SIGN["en"]),
   es=("🔑 Restablece tu contraseña", "Hola {{user_name}} 🌸\n\nhemos recibido la solicitud para restablecer la contraseña de tu cuenta de Danza Classica No Under 40.\n\n[🔑 Elegir una nueva contraseña|{{reset_url}}]\n\nEl enlace vale una sola vez y caduca pronto. Si no has sido tú, ignora este email: tu contraseña actual sigue siendo válida.\n\n" + SIGN["es"]),
   fr=("🔑 Réinitialisez votre mot de passe", "Bonjour {{user_name}} 🌸\n\nnous avons reçu une demande de réinitialisation du mot de passe de votre compte Danza Classica No Under 40.\n\n[🔑 Choisir un nouveau mot de passe|{{reset_url}}]\n\nLe lien est valable une seule fois et expire bientôt. Si ce n'était pas vous, ignorez cet email : votre mot de passe actuel reste valide.\n\n" + SIGN["fr"]),
   de=("🔑 Passwort zurücksetzen", "Hallo {{user_name}} 🌸\n\nwir haben eine Anfrage erhalten, das Passwort deines Kontos bei Danza Classica No Under 40 zurückzusetzen.\n\n[🔑 Neues Passwort wählen|{{reset_url}}]\n\nDer Link gilt nur einmal und läuft bald ab. Falls du das nicht warst, ignoriere diese E-Mail: dein aktuelles Passwort bleibt gültig.\n\n" + SIGN["de"]))

_t("team_invite",
   it=("✉️ Sei stata invitata nel team di Danza Classica No Under 40", "Ciao {{user_name}} 🌸\n\nsei stata invitata a far parte del team di Danza Classica No Under 40. Per iniziare basta scegliere la tua password.\n\n[✨ Completa il mio account|{{setup_url}}]\n\nIl link è personale e scade a breve. Se non ti aspettavi questo invito, puoi ignorare questa email.\n\n" + TEAM["it"]),
   en=("✉️ You've been invited to the Danza Classica No Under 40 team", "Hi {{user_name}} 🌸\n\nyou have been invited to join the Danza Classica No Under 40 team. To get started, just choose your password.\n\n[✨ Complete my account|{{setup_url}}]\n\nThe link is personal and expires shortly. If you weren't expecting this invitation, you can ignore this email.\n\n" + TEAM["en"]),
   es=("✉️ Te han invitado al equipo de Danza Classica No Under 40", "Hola {{user_name}} 🌸\n\nte han invitado a formar parte del equipo de Danza Classica No Under 40. Para empezar, solo tienes que elegir tu contraseña.\n\n[✨ Completar mi cuenta|{{setup_url}}]\n\nEl enlace es personal y caduca pronto. Si no esperabas esta invitación, puedes ignorar este email.\n\n" + TEAM["es"]),
   fr=("✉️ Vous êtes invitée dans l'équipe Danza Classica No Under 40", "Bonjour {{user_name}} 🌸\n\nvous avez été invitée à rejoindre l'équipe Danza Classica No Under 40. Pour commencer, il suffit de choisir votre mot de passe.\n\n[✨ Finaliser mon compte|{{setup_url}}]\n\nLe lien est personnel et expire bientôt. Si vous n'attendiez pas cette invitation, vous pouvez ignorer cet email.\n\n" + TEAM["fr"]),
   de=("✉️ Du bist ins Team von Danza Classica No Under 40 eingeladen", "Hallo {{user_name}} 🌸\n\ndu wurdest eingeladen, Teil des Teams von Danza Classica No Under 40 zu werden. Wähle einfach dein Passwort, um zu starten.\n\n[✨ Mein Konto abschließen|{{setup_url}}]\n\nDer Link ist persönlich und läuft bald ab. Falls du diese Einladung nicht erwartet hast, ignoriere diese E-Mail.\n\n" + TEAM["de"]))

_LESSON_IT = "🩰 {{lesson_name}}\n📅 {{lesson_date}} · 🕐 {{lesson_time}} ({{lesson_duration}})\n👩‍🏫 {{teacher_name}}\n📍 {{location_name}} · {{room_name}}\n{{location_address}}"
_LESSON_ON_IT = "🩰 {{lesson_name}} — 🌐 lezione online\n📅 {{lesson_date}} · 🕐 {{lesson_time}} ({{lesson_duration}})\n👩‍🏫 {{teacher_name}}\n🔗 Link per partecipare: {{online_link}}"
_LESSON_EN = "🩰 {{lesson_name}}\n📅 {{lesson_date}} · 🕐 {{lesson_time}} ({{lesson_duration}})\n👩‍🏫 {{teacher_name}}\n📍 {{location_name}} · {{room_name}}\n{{location_address}}"
_LESSON_ON_EN = "🩰 {{lesson_name}} — 🌐 online lesson\n📅 {{lesson_date}} · 🕐 {{lesson_time}} ({{lesson_duration}})\n👩‍🏫 {{teacher_name}}\n🔗 Join link: {{online_link}}"
_LESSON_ES = "🩰 {{lesson_name}}\n📅 {{lesson_date}} · 🕐 {{lesson_time}} ({{lesson_duration}})\n👩‍🏫 {{teacher_name}}\n📍 {{location_name}} · {{room_name}}\n{{location_address}}"
_LESSON_ON_ES = "🩰 {{lesson_name}} — 🌐 clase online\n📅 {{lesson_date}} · 🕐 {{lesson_time}} ({{lesson_duration}})\n👩‍🏫 {{teacher_name}}\n🔗 Enlace para unirte: {{online_link}}"
_LESSON_FR = "🩰 {{lesson_name}}\n📅 {{lesson_date}} · 🕐 {{lesson_time}} ({{lesson_duration}})\n👩‍🏫 {{teacher_name}}\n📍 {{location_name}} · {{room_name}}\n{{location_address}}"
_LESSON_ON_FR = "🩰 {{lesson_name}} — 🌐 cours en ligne\n📅 {{lesson_date}} · 🕐 {{lesson_time}} ({{lesson_duration}})\n👩‍🏫 {{teacher_name}}\n🔗 Lien pour participer : {{online_link}}"
_LESSON_DE = "🩰 {{lesson_name}}\n📅 {{lesson_date}} · 🕐 {{lesson_time}} ({{lesson_duration}})\n👩‍🏫 {{teacher_name}}\n📍 {{location_name}} · {{room_name}}\n{{location_address}}"
_LESSON_ON_DE = "🩰 {{lesson_name}} — 🌐 Online-Stunde\n📅 {{lesson_date}} · 🕐 {{lesson_time}} ({{lesson_duration}})\n👩‍🏫 {{teacher_name}}\n🔗 Link zur Teilnahme: {{online_link}}"


def _lesson_pair(key, it, en, es, fr, de, school_info=False):
    """In-person + .online variants from the same copy with a different lesson block.

    school_info=True appends {{school_info_block}} right after the lesson block:
    the placeholder renders empty when the school wrote nothing, otherwise a
    "❗ Importante — Informazioni dalla scuola" block (built in
    bookings/services.booking_email_context, localized there)."""
    extra = "{{school_info_block}}" if school_info else ""
    for suffix, blocks in (("", (_LESSON_IT, _LESSON_EN, _LESSON_ES, _LESSON_FR, _LESSON_DE)),
                           (".online", (_LESSON_ON_IT, _LESSON_ON_EN, _LESSON_ON_ES, _LESSON_ON_FR, _LESSON_ON_DE))):
        _t(key + suffix,
           it=(it[0], it[1].replace("{LESSON}", blocks[0] + extra)), en=(en[0], en[1].replace("{LESSON}", blocks[1] + extra)),
           es=(es[0], es[1].replace("{LESSON}", blocks[2] + extra)), fr=(fr[0], fr[1].replace("{LESSON}", blocks[3] + extra)),
           de=(de[0], de[1].replace("{LESSON}", blocks[4] + extra)))


_lesson_pair("student.booking_confirmed",
    ("✅ Prenotazione confermata — {{lesson_name}}, {{lesson_date}}", "Ciao {{student_first_name}} 🌸\n\nla tua prenotazione con {{school_name}} è confermata! Ti aspettiamo in sala. ✨\n\n{LESSON}\n\n[🩰 Le mie lezioni|{{booking_url}}]\n\nPuoi annullare senza perdere la lezione fino a {{cancellation_hours}} ore prima dell'inizio, dal tuo spazio personale.\n\n" + SIGN["it"]),
    ("✅ Booking confirmed — {{lesson_name}}, {{lesson_date}}", "Hi {{student_first_name}} 🌸\n\nyour booking with {{school_name}} is confirmed! We can't wait to see you in the studio. ✨\n\n{LESSON}\n\n[🩰 My lessons|{{booking_url}}]\n\nYou can cancel without losing the lesson up to {{cancellation_hours}} hours before it starts, from your personal space.\n\n" + SIGN["en"]),
    ("✅ Reserva confirmada — {{lesson_name}}, {{lesson_date}}", "Hola {{student_first_name}} 🌸\n\n¡tu reserva con {{school_name}} está confirmada! Te esperamos en la sala. ✨\n\n{LESSON}\n\n[🩰 Mis clases|{{booking_url}}]\n\nPuedes cancelar sin perder la clase hasta {{cancellation_hours}} horas antes del inicio, desde tu espacio personal.\n\n" + SIGN["es"]),
    ("✅ Réservation confirmée — {{lesson_name}}, {{lesson_date}}", "Bonjour {{student_first_name}} 🌸\n\nvotre réservation avec {{school_name}} est confirmée ! Nous avons hâte de vous retrouver en salle. ✨\n\n{LESSON}\n\n[🩰 Mes cours|{{booking_url}}]\n\nVous pouvez annuler sans perdre le cours jusqu'à {{cancellation_hours}} heures avant le début, depuis votre espace personnel.\n\n" + SIGN["fr"]),
    ("✅ Buchung bestätigt — {{lesson_name}}, {{lesson_date}}", "Hallo {{student_first_name}} 🌸\n\ndeine Buchung bei {{school_name}} ist bestätigt! Wir freuen uns auf dich im Saal. ✨\n\n{LESSON}\n\n[🩰 Meine Stunden|{{booking_url}}]\n\nDu kannst bis {{cancellation_hours}} Stunden vor Beginn stornieren, ohne die Stunde zu verlieren – in deinem persönlichen Bereich.\n\n" + SIGN["de"]),
    school_info=True)

_lesson_pair("student.booking_cancelled",
    ("❌ Prenotazione annullata — {{lesson_name}}, {{lesson_date}}", "Ciao {{student_first_name}} 🌸\n\nla tua prenotazione con {{school_name}} è stata annullata.\n\n{LESSON}\n\nSe l'annullamento è avvenuto entro i termini della scuola, il credito è già tornato nel tuo pacchetto.\n\n[🩰 Trova un'altra lezione|{{school_calendar_url}}]\n\nTi aspettiamo presto in sala. 🩰\n\n" + SIGN["it"]),
    ("❌ Booking cancelled — {{lesson_name}}, {{lesson_date}}", "Hi {{student_first_name}} 🌸\n\nyour booking with {{school_name}} has been cancelled.\n\n{LESSON}\n\nIf the cancellation was within the school's notice period, the credit is already back in your package.\n\n[🩰 Find another lesson|{{school_calendar_url}}]\n\nWe hope to see you in the studio soon. 🩰\n\n" + SIGN["en"]),
    ("❌ Reserva cancelada — {{lesson_name}}, {{lesson_date}}", "Hola {{student_first_name}} 🌸\n\ntu reserva con {{school_name}} ha sido cancelada.\n\n{LESSON}\n\nSi la cancelación se hizo dentro del plazo de la escuela, el crédito ya ha vuelto a tu paquete.\n\n[🩰 Buscar otra clase|{{school_calendar_url}}]\n\nTe esperamos pronto en la sala. 🩰\n\n" + SIGN["es"]),
    ("❌ Réservation annulée — {{lesson_name}}, {{lesson_date}}", "Bonjour {{student_first_name}} 🌸\n\nvotre réservation avec {{school_name}} a été annulée.\n\n{LESSON}\n\nSi l'annulation respecte le délai de l'école, le crédit est déjà revenu dans votre forfait.\n\n[🩰 Trouver un autre cours|{{school_calendar_url}}]\n\nÀ très vite en salle. 🩰\n\n" + SIGN["fr"]),
    ("❌ Buchung storniert — {{lesson_name}}, {{lesson_date}}", "Hallo {{student_first_name}} 🌸\n\ndeine Buchung bei {{school_name}} wurde storniert.\n\n{LESSON}\n\nLag die Stornierung innerhalb der Frist der Schule, ist der Credit bereits zurück in deinem Paket.\n\n[🩰 Eine andere Stunde finden|{{school_calendar_url}}]\n\nWir sehen uns bald wieder im Saal. 🩰\n\n" + SIGN["de"]))

_lesson_pair("student.lesson_cancelled_by_school",
    ("🚫 Lezione annullata — {{lesson_name}}, {{lesson_date}}", "Ciao {{student_first_name}} 🌸\n\nci dispiace: {{school_name}} ha dovuto annullare questa lezione.\n\n{LESSON}\n\nIl tuo credito è già tornato nel pacchetto, pronto per un'altra lezione.\n\n[🩰 Scegli un'altra lezione|{{school_calendar_url}}]\n\nGrazie per la comprensione, ti aspettiamo presto. 🩰\n\n" + SIGN["it"]),
    ("🚫 Lesson cancelled — {{lesson_name}}, {{lesson_date}}", "Hi {{student_first_name}} 🌸\n\nwe're sorry: {{school_name}} had to cancel this lesson.\n\n{LESSON}\n\nYour credit is already back in your package, ready for another lesson.\n\n[🩰 Pick another lesson|{{school_calendar_url}}]\n\nThank you for understanding — see you soon. 🩰\n\n" + SIGN["en"]),
    ("🚫 Clase cancelada — {{lesson_name}}, {{lesson_date}}", "Hola {{student_first_name}} 🌸\n\nlo sentimos: {{school_name}} ha tenido que cancelar esta clase.\n\n{LESSON}\n\nTu crédito ya ha vuelto a tu paquete, listo para otra clase.\n\n[🩰 Elegir otra clase|{{school_calendar_url}}]\n\nGracias por tu comprensión, te esperamos pronto. 🩰\n\n" + SIGN["es"]),
    ("🚫 Cours annulé — {{lesson_name}}, {{lesson_date}}", "Bonjour {{student_first_name}} 🌸\n\nnous sommes désolées : {{school_name}} a dû annuler ce cours.\n\n{LESSON}\n\nVotre crédit est déjà revenu dans votre forfait, prêt pour un autre cours.\n\n[🩰 Choisir un autre cours|{{school_calendar_url}}]\n\nMerci de votre compréhension, à très vite. 🩰\n\n" + SIGN["fr"]),
    ("🚫 Stunde abgesagt — {{lesson_name}}, {{lesson_date}}", "Hallo {{student_first_name}} 🌸\n\nes tut uns leid: {{school_name}} musste diese Stunde absagen.\n\n{LESSON}\n\nDein Credit ist bereits zurück in deinem Paket, bereit für eine andere Stunde.\n\n[🩰 Eine andere Stunde wählen|{{school_calendar_url}}]\n\nDanke für dein Verständnis, bis bald. 🩰\n\n" + SIGN["de"]))

_lesson_pair("student.lesson_reminder_1day",
    ("🔔 Domani hai lezione — {{lesson_name}} alle {{lesson_time}}", "Ciao {{student_first_name}} 🌸\n\nun piccolo promemoria: domani ti aspettiamo in sala. ✨\n\n{LESSON}\n\nPrepara scarpette e sorriso: i sogni non hanno età. 🩰\n\n[🩰 Le mie lezioni|{{booking_url}}]\n\n" + SIGN["it"]),
    ("🔔 Lesson tomorrow — {{lesson_name}} at {{lesson_time}}", "Hi {{student_first_name}} 🌸\n\na little reminder: we're expecting you in the studio tomorrow. ✨\n\n{LESSON}\n\nGet your slippers and your smile ready: dreams have no age. 🩰\n\n[🩰 My lessons|{{booking_url}}]\n\n" + SIGN["en"]),
    ("🔔 Mañana tienes clase — {{lesson_name}} a las {{lesson_time}}", "Hola {{student_first_name}} 🌸\n\nun pequeño recordatorio: mañana te esperamos en la sala. ✨\n\n{LESSON}\n\nPrepara las zapatillas y la sonrisa: los sueños no tienen edad. 🩰\n\n[🩰 Mis clases|{{booking_url}}]\n\n" + SIGN["es"]),
    ("🔔 Cours demain — {{lesson_name}} à {{lesson_time}}", "Bonjour {{student_first_name}} 🌸\n\nun petit rappel : nous vous attendons en salle demain. ✨\n\n{LESSON}\n\nPréparez vos chaussons et votre sourire : les rêves n'ont pas d'âge. 🩰\n\n[🩰 Mes cours|{{booking_url}}]\n\n" + SIGN["fr"]),
    ("🔔 Morgen hast du Stunde — {{lesson_name}} um {{lesson_time}}", "Hallo {{student_first_name}} 🌸\n\neine kleine Erinnerung: morgen erwarten wir dich im Saal. ✨\n\n{LESSON}\n\nSchläppchen und Lächeln bereithalten: Träume haben kein Alter. 🩰\n\n[🩰 Meine Stunden|{{booking_url}}]\n\n" + SIGN["de"]),
    school_info=True)

_lesson_pair("student.lesson_reminder_2hour",
    ("⏰ Tra due ore: {{lesson_name}} alle {{lesson_time}}", "Ciao {{student_first_name}} 🌸\n\nla tua lezione inizia tra circa due ore. Ti aspettiamo! ✨\n\n{LESSON}\n\nA tra poco. 🩰\n\n" + SIGN["it"]),
    ("⏰ In two hours: {{lesson_name}} at {{lesson_time}}", "Hi {{student_first_name}} 🌸\n\nyour lesson starts in about two hours. We're waiting for you! ✨\n\n{LESSON}\n\nSee you very soon. 🩰\n\n" + SIGN["en"]),
    ("⏰ En dos horas: {{lesson_name}} a las {{lesson_time}}", "Hola {{student_first_name}} 🌸\n\ntu clase empieza en unas dos horas. ¡Te esperamos! ✨\n\n{LESSON}\n\nHasta ahora. 🩰\n\n" + SIGN["es"]),
    ("⏰ Dans deux heures : {{lesson_name}} à {{lesson_time}}", "Bonjour {{student_first_name}} 🌸\n\nvotre cours commence dans environ deux heures. Nous vous attendons ! ✨\n\n{LESSON}\n\nÀ tout à l'heure. 🩰\n\n" + SIGN["fr"]),
    ("⏰ In zwei Stunden: {{lesson_name}} um {{lesson_time}}", "Hallo {{student_first_name}} 🌸\n\ndeine Stunde beginnt in etwa zwei Stunden. Wir warten auf dich! ✨\n\n{LESSON}\n\nBis gleich. 🩰\n\n" + SIGN["de"]),
    school_info=True)

_t("student.no_show",
   it=("👻 Ci sei mancata oggi — {{lesson_name}}", "Ciao {{student_first_name}} 🌸\n\noggi non ti abbiamo vista in sala per {{lesson_name}} ({{lesson_date}}, {{lesson_time}}) con {{school_name}}, e ci sei mancata.\n\nCome da regole della scuola, la lezione è stata conteggiata dal tuo pacchetto. Se non riesci a venire, annullare in tempo dal tuo spazio personale ti permette di non perdere il credito.\n\n[🩰 Prenota la prossima lezione|{{school_calendar_url}}]\n\nTi aspettiamo presto: i sogni non hanno età. 🩰\n\n" + SIGN["it"]),
   en=("👻 We missed you today — {{lesson_name}}", "Hi {{student_first_name}} 🌸\n\nwe didn't see you in the studio today for {{lesson_name}} ({{lesson_date}}, {{lesson_time}}) with {{school_name}}, and we missed you.\n\nAs per the school's rules, the lesson was counted from your package. If you can't make it, cancelling in time from your personal space keeps your credit safe.\n\n[🩰 Book your next lesson|{{school_calendar_url}}]\n\nSee you soon: dreams have no age. 🩰\n\n" + SIGN["en"]),
   es=("👻 Hoy te hemos echado de menos — {{lesson_name}}", "Hola {{student_first_name}} 🌸\n\nhoy no te hemos visto en la sala en {{lesson_name}} ({{lesson_date}}, {{lesson_time}}) con {{school_name}}, y te hemos echado de menos.\n\nSegún las normas de la escuela, la clase se ha descontado de tu paquete. Si no puedes venir, cancelar a tiempo desde tu espacio personal te permite no perder el crédito.\n\n[🩰 Reservar la próxima clase|{{school_calendar_url}}]\n\nTe esperamos pronto: los sueños no tienen edad. 🩰\n\n" + SIGN["es"]),
   fr=("👻 Vous nous avez manqué aujourd'hui — {{lesson_name}}", "Bonjour {{student_first_name}} 🌸\n\nnous ne vous avons pas vue en salle aujourd'hui pour {{lesson_name}} ({{lesson_date}}, {{lesson_time}}) avec {{school_name}}, et vous nous avez manqué.\n\nSelon les règles de l'école, le cours a été décompté de votre forfait. Si vous ne pouvez pas venir, annuler à temps depuis votre espace personnel vous évite de perdre le crédit.\n\n[🩰 Réserver le prochain cours|{{school_calendar_url}}]\n\nÀ très vite : les rêves n'ont pas d'âge. 🩰\n\n" + SIGN["fr"]),
   de=("👻 Du hast uns heute gefehlt — {{lesson_name}}", "Hallo {{student_first_name}} 🌸\n\nheute haben wir dich bei {{lesson_name}} ({{lesson_date}}, {{lesson_time}}) bei {{school_name}} im Saal vermisst.\n\nNach den Regeln der Schule wurde die Stunde von deinem Paket abgezogen. Wenn du nicht kommen kannst, sichert eine rechtzeitige Absage in deinem persönlichen Bereich deinen Credit.\n\n[🩰 Nächste Stunde buchen|{{school_calendar_url}}]\n\nBis bald: Träume haben kein Alter. 🩰\n\n" + SIGN["de"]))

_t("student.credits_low",
   it=("💳 Il tuo pacchetto sta per finire — {{lessons_remaining}} lezioni rimaste", "Ciao {{student_first_name}} 🌸\n\nnel tuo pacchetto {{package_name}} con {{school_name}} ti restano {{lessons_remaining}} lezioni (scade il {{package_expiry}}).\n\nPer non fermare il tuo percorso, puoi già scegliere il prossimo pacchetto: sarà pronto quando servirà. ✨\n\n[🩰 Rinnova il mio pacchetto|{{booking_url}}]\n\n" + SIGN["it"]),
   en=("💳 Your package is running low — {{lessons_remaining}} lessons left", "Hi {{student_first_name}} 🌸\n\nyour package {{package_name}} with {{school_name}} has {{lessons_remaining}} lessons left (it expires on {{package_expiry}}).\n\nTo keep your journey going, you can already pick your next package: it will be ready when you need it. ✨\n\n[🩰 Renew my package|{{booking_url}}]\n\n" + SIGN["en"]),
   es=("💳 Tu paquete se está acabando — te quedan {{lessons_remaining}} clases", "Hola {{student_first_name}} 🌸\n\nen tu paquete {{package_name}} con {{school_name}} te quedan {{lessons_remaining}} clases (caduca el {{package_expiry}}).\n\nPara no detener tu camino, ya puedes elegir el próximo paquete: estará listo cuando lo necesites. ✨\n\n[🩰 Renovar mi paquete|{{booking_url}}]\n\n" + SIGN["es"]),
   fr=("💳 Votre forfait touche à sa fin — {{lessons_remaining}} cours restants", "Bonjour {{student_first_name}} 🌸\n\nil vous reste {{lessons_remaining}} cours dans votre forfait {{package_name}} avec {{school_name}} (il expire le {{package_expiry}}).\n\nPour ne pas interrompre votre parcours, vous pouvez déjà choisir votre prochain forfait : il sera prêt quand vous en aurez besoin. ✨\n\n[🩰 Renouveler mon forfait|{{booking_url}}]\n\n" + SIGN["fr"]),
   de=("💳 Dein Paket geht zur Neige — noch {{lessons_remaining}} Stunden", "Hallo {{student_first_name}} 🌸\n\nin deinem Paket {{package_name}} bei {{school_name}} sind noch {{lessons_remaining}} Stunden übrig (es läuft am {{package_expiry}} ab).\n\nDamit dein Weg nicht stoppt, kannst du schon jetzt dein nächstes Paket wählen: es ist bereit, wenn du es brauchst. ✨\n\n[🩰 Mein Paket verlängern|{{booking_url}}]\n\n" + SIGN["de"]))

_t("student.after_purchase",
   it=("🛍️ Grazie! Il tuo pacchetto {{package_name}} è attivo", "Ciao {{student_first_name}} 🌸\n\ngrazie per il tuo acquisto! Il pacchetto {{package_name}} con {{school_name}} è già attivo.\n\n✨ {{lessons_total}} lezioni ({{credits_total}} crediti)\n💶 Importo: {{amount}}\n📅 Valido fino al {{package_expiry}}\n\nOra non resta che scegliere la prossima lezione. 🩰\n\n[🩰 Prenota una lezione|{{school_calendar_url}}]\n\n" + SIGN["it"]),
   en=("🛍️ Thank you! Your package {{package_name}} is active", "Hi {{student_first_name}} 🌸\n\nthank you for your purchase! Your package {{package_name}} with {{school_name}} is already active.\n\n✨ {{lessons_total}} lessons ({{credits_total}} credits)\n💶 Amount: {{amount}}\n📅 Valid until {{package_expiry}}\n\nAll that's left is choosing your next lesson. 🩰\n\n[🩰 Book a lesson|{{school_calendar_url}}]\n\n" + SIGN["en"]),
   es=("🛍️ ¡Gracias! Tu paquete {{package_name}} está activo", "Hola {{student_first_name}} 🌸\n\n¡gracias por tu compra! El paquete {{package_name}} con {{school_name}} ya está activo.\n\n✨ {{lessons_total}} clases ({{credits_total}} créditos)\n💶 Importe: {{amount}}\n📅 Válido hasta el {{package_expiry}}\n\nAhora solo queda elegir la próxima clase. 🩰\n\n[🩰 Reservar una clase|{{school_calendar_url}}]\n\n" + SIGN["es"]),
   fr=("🛍️ Merci ! Votre forfait {{package_name}} est actif", "Bonjour {{student_first_name}} 🌸\n\nmerci pour votre achat ! Votre forfait {{package_name}} avec {{school_name}} est déjà actif.\n\n✨ {{lessons_total}} cours ({{credits_total}} crédits)\n💶 Montant : {{amount}}\n📅 Valable jusqu'au {{package_expiry}}\n\nIl ne reste plus qu'à choisir votre prochain cours. 🩰\n\n[🩰 Réserver un cours|{{school_calendar_url}}]\n\n" + SIGN["fr"]),
   de=("🛍️ Danke! Dein Paket {{package_name}} ist aktiv", "Hallo {{student_first_name}} 🌸\n\ndanke für deinen Kauf! Dein Paket {{package_name}} bei {{school_name}} ist bereits aktiv.\n\n✨ {{lessons_total}} Stunden ({{credits_total}} Credits)\n💶 Betrag: {{amount}}\n📅 Gültig bis {{package_expiry}}\n\nJetzt musst du nur noch deine nächste Stunde wählen. 🩰\n\n[🩰 Eine Stunde buchen|{{school_calendar_url}}]\n\n" + SIGN["de"]))

_t("student.package_expiring",
   it=("⏳ Il tuo pacchetto scade tra {{days}} giorni", "Ciao {{student_first_name}} 🌸\n\nil tuo pacchetto {{package_name}} con {{school_name}} scade il {{package_expiry}}, tra {{days}} giorni, e hai ancora {{lessons_remaining}} lezioni da usare.\n\nNon lasciarle lì: prenota adesso e goditele fino all'ultima. ✨\n\n[🩰 Prenota una lezione|{{school_calendar_url}}]\n\n" + SIGN["it"]),
   en=("⏳ Your package expires in {{days}} days", "Hi {{student_first_name}} 🌸\n\nyour package {{package_name}} with {{school_name}} expires on {{package_expiry}}, in {{days}} days, and you still have {{lessons_remaining}} lessons to use.\n\nDon't leave them behind: book now and enjoy every last one. ✨\n\n[🩰 Book a lesson|{{school_calendar_url}}]\n\n" + SIGN["en"]),
   es=("⏳ Tu paquete caduca en {{days}} días", "Hola {{student_first_name}} 🌸\n\ntu paquete {{package_name}} con {{school_name}} caduca el {{package_expiry}}, dentro de {{days}} días, y todavía tienes {{lessons_remaining}} clases por usar.\n\nNo las dejes ahí: reserva ahora y disfrútalas hasta la última. ✨\n\n[🩰 Reservar una clase|{{school_calendar_url}}]\n\n" + SIGN["es"]),
   fr=("⏳ Votre forfait expire dans {{days}} jours", "Bonjour {{student_first_name}} 🌸\n\nvotre forfait {{package_name}} avec {{school_name}} expire le {{package_expiry}}, dans {{days}} jours, et il vous reste {{lessons_remaining}} cours à utiliser.\n\nNe les laissez pas de côté : réservez maintenant et profitez-en jusqu'au dernier. ✨\n\n[🩰 Réserver un cours|{{school_calendar_url}}]\n\n" + SIGN["fr"]),
   de=("⏳ Dein Paket läuft in {{days}} Tagen ab", "Hallo {{student_first_name}} 🌸\n\ndein Paket {{package_name}} bei {{school_name}} läuft am {{package_expiry}} ab, in {{days}} Tagen, und du hast noch {{lessons_remaining}} Stunden übrig.\n\nLass sie nicht verfallen: buche jetzt und genieße jede einzelne. ✨\n\n[🩰 Eine Stunde buchen|{{school_calendar_url}}]\n\n" + SIGN["de"]))

_t("student.we_miss_you_1m",
   it=("💌 Ci manchi, {{student_first_name}}", "Ciao {{student_first_name}} 🌸\n\nè passato un mese dalla tua ultima lezione con {{school_name}} ({{last_lesson_date}}) e in sala si sente la tua mancanza.\n\nLa danza ti aspetta esattamente dove l'hai lasciata: basta una lezione per ritrovare il ritmo. ✨\n\n[🩰 Torna in sala|{{school_calendar_url}}]\n\nRicorda: i sogni non hanno età. 🩰\n\n" + SIGN["it"]),
   en=("💌 We miss you, {{student_first_name}}", "Hi {{student_first_name}} 🌸\n\nit's been a month since your last lesson with {{school_name}} ({{last_lesson_date}}) and the studio isn't the same without you.\n\nBallet is waiting for you right where you left it: one lesson is all it takes to find your rhythm again. ✨\n\n[🩰 Come back to the studio|{{school_calendar_url}}]\n\nRemember: dreams have no age. 🩰\n\n" + SIGN["en"]),
   es=("💌 Te echamos de menos, {{student_first_name}}", "Hola {{student_first_name}} 🌸\n\nha pasado un mes desde tu última clase con {{school_name}} ({{last_lesson_date}}) y en la sala se nota tu ausencia.\n\nLa danza te espera justo donde la dejaste: basta una clase para recuperar el ritmo. ✨\n\n[🩰 Volver a la sala|{{school_calendar_url}}]\n\nRecuerda: los sueños no tienen edad. 🩰\n\n" + SIGN["es"]),
   fr=("💌 Vous nous manquez, {{student_first_name}}", "Bonjour {{student_first_name}} 🌸\n\nun mois s'est écoulé depuis votre dernier cours avec {{school_name}} ({{last_lesson_date}}) et la salle n'est plus la même sans vous.\n\nLa danse vous attend là où vous l'avez laissée : un seul cours suffit pour retrouver le rythme. ✨\n\n[🩰 Revenir en salle|{{school_calendar_url}}]\n\nN'oubliez pas : les rêves n'ont pas d'âge. 🩰\n\n" + SIGN["fr"]),
   de=("💌 Du fehlst uns, {{student_first_name}}", "Hallo {{student_first_name}} 🌸\n\nseit deiner letzten Stunde bei {{school_name}} ({{last_lesson_date}}) ist ein Monat vergangen, und im Saal fehlst du uns.\n\nDas Ballett wartet genau dort auf dich, wo du es gelassen hast: eine Stunde reicht, um den Rhythmus wiederzufinden. ✨\n\n[🩰 Zurück in den Saal|{{school_calendar_url}}]\n\nDenk daran: Träume haben kein Alter. 🩰\n\n" + SIGN["de"]))

_t("student.we_miss_you_3m",
   it=("🌹 La sala ti aspetta, {{student_first_name}}", "Ciao {{student_first_name}} 🌸\n\nsono passati tre mesi dalla tua ultima lezione con {{school_name}} ({{last_lesson_date}}). Sappiamo che la vita a volte corre, ma la sbarra è sempre lì per te.\n\nNon serve essere in forma o ricordare tutto: si riparte con dolcezza, un passo alla volta. ✨\n\n[🩰 Riprendi da qui|{{school_calendar_url}}]\n\nRicorda: i sogni non hanno età. 🩰\n\n" + SIGN["it"]),
   en=("🌹 The studio is waiting for you, {{student_first_name}}", "Hi {{student_first_name}} 🌸\n\nthree months have gone by since your last lesson with {{school_name}} ({{last_lesson_date}}). We know life runs fast sometimes, but the barre is always there for you.\n\nNo need to be in shape or remember everything: we start again gently, one step at a time. ✨\n\n[🩰 Pick up from here|{{school_calendar_url}}]\n\nRemember: dreams have no age. 🩰\n\n" + SIGN["en"]),
   es=("🌹 La sala te espera, {{student_first_name}}", "Hola {{student_first_name}} 🌸\n\nhan pasado tres meses desde tu última clase con {{school_name}} ({{last_lesson_date}}). Sabemos que la vida a veces corre, pero la barra siempre está ahí para ti.\n\nNo hace falta estar en forma ni acordarse de todo: se vuelve a empezar con dulzura, paso a paso. ✨\n\n[🩰 Retomar desde aquí|{{school_calendar_url}}]\n\nRecuerda: los sueños no tienen edad. 🩰\n\n" + SIGN["es"]),
   fr=("🌹 La salle vous attend, {{student_first_name}}", "Bonjour {{student_first_name}} 🌸\n\ntrois mois ont passé depuis votre dernier cours avec {{school_name}} ({{last_lesson_date}}). Nous savons que la vie va vite parfois, mais la barre est toujours là pour vous.\n\nPas besoin d'être en forme ni de tout se rappeler : on repart en douceur, un pas à la fois. ✨\n\n[🩰 Reprendre ici|{{school_calendar_url}}]\n\nN'oubliez pas : les rêves n'ont pas d'âge. 🩰\n\n" + SIGN["fr"]),
   de=("🌹 Der Saal wartet auf dich, {{student_first_name}}", "Hallo {{student_first_name}} 🌸\n\nseit deiner letzten Stunde bei {{school_name}} ({{last_lesson_date}}) sind drei Monate vergangen. Wir wissen, das Leben ist manchmal schnell, aber die Stange ist immer für dich da.\n\nDu musst weder fit sein noch alles noch wissen: wir beginnen sanft, Schritt für Schritt. ✨\n\n[🩰 Hier weitermachen|{{school_calendar_url}}]\n\nDenk daran: Träume haben kein Alter. 🩰\n\n" + SIGN["de"]))

for _days, _key in (("30", "student.document_expiring_30"), ("7", "student.document_expiring_7")):
    _t(_key,
       it=(f"📄 Un tuo documento scade tra {_days} giorni", "Ciao {{student_first_name}} 🌸\n\nil documento \"{{document_type}}\" che hai consegnato a {{school_name}} scade tra {{days}} giorni.\n\nPer continuare a prenotare senza interruzioni, carica la versione aggiornata dal tuo profilo, sezione Documenti. ✨\n\n[📄 Aggiorna il documento|{{profile_url}}]\n\n" + SIGN["it"]),
       en=(f"📄 One of your documents expires in {_days} days", "Hi {{student_first_name}} 🌸\n\nthe document \"{{document_type}}\" you gave {{school_name}} expires in {{days}} days.\n\nTo keep booking without interruptions, upload the updated version from your profile, Documents section. ✨\n\n[📄 Update the document|{{profile_url}}]\n\n" + SIGN["en"]),
       es=(f"📄 Uno de tus documentos caduca en {_days} días", "Hola {{student_first_name}} 🌸\n\nel documento \"{{document_type}}\" que entregaste a {{school_name}} caduca en {{days}} días.\n\nPara seguir reservando sin interrupciones, sube la versión actualizada desde tu perfil, sección Documentos. ✨\n\n[📄 Actualizar el documento|{{profile_url}}]\n\n" + SIGN["es"]),
       fr=(f"📄 L'un de vos documents expire dans {_days} jours", "Bonjour {{student_first_name}} 🌸\n\nle document « {{document_type}} » remis à {{school_name}} expire dans {{days}} jours.\n\nPour continuer à réserver sans interruption, téléchargez la version à jour depuis votre profil, section Documents. ✨\n\n[📄 Mettre à jour le document|{{profile_url}}]\n\n" + SIGN["fr"]),
       de=(f"📄 Eines deiner Dokumente läuft in {_days} Tagen ab", "Hallo {{student_first_name}} 🌸\n\ndas Dokument \"{{document_type}}\", das du bei {{school_name}} abgegeben hast, läuft in {{days}} Tagen ab.\n\nDamit du ohne Unterbrechung weiter buchen kannst, lade die aktuelle Version in deinem Profil unter Dokumente hoch. ✨\n\n[📄 Dokument aktualisieren|{{profile_url}}]\n\n" + SIGN["de"]))

_t("school.new_booking",
   it=("📅 Nuova prenotazione: {{student_name}} — {{lesson_name}}, {{lesson_date}}", "Ciao {{school_name}} 👋\n\nè arrivata una nuova prenotazione.\n\n👩 {{student_name}} ({{student_email}})\n🩰 {{lesson_name}}\n📅 {{lesson_date}} · 🕐 {{lesson_time}}\n👩‍🏫 {{teacher_name}}\n📍 {{location_name}} · {{room_name}}\n\n[📅 Apri le lezioni|{{dashboard_url}}]\n\n" + TEAM["it"]),
   en=("📅 New booking: {{student_name}} — {{lesson_name}}, {{lesson_date}}", "Hello {{school_name}} 👋\n\na new booking just came in.\n\n👩 {{student_name}} ({{student_email}})\n🩰 {{lesson_name}}\n📅 {{lesson_date}} · 🕐 {{lesson_time}}\n👩‍🏫 {{teacher_name}}\n📍 {{location_name}} · {{room_name}}\n\n[📅 Open lessons|{{dashboard_url}}]\n\n" + TEAM["en"]),
   es=("📅 Nueva reserva: {{student_name}} — {{lesson_name}}, {{lesson_date}}", "Hola {{school_name}} 👋\n\nha llegado una nueva reserva.\n\n👩 {{student_name}} ({{student_email}})\n🩰 {{lesson_name}}\n📅 {{lesson_date}} · 🕐 {{lesson_time}}\n👩‍🏫 {{teacher_name}}\n📍 {{location_name}} · {{room_name}}\n\n[📅 Abrir las clases|{{dashboard_url}}]\n\n" + TEAM["es"]),
   fr=("📅 Nouvelle réservation : {{student_name}} — {{lesson_name}}, {{lesson_date}}", "Bonjour {{school_name}} 👋\n\nune nouvelle réservation vient d'arriver.\n\n👩 {{student_name}} ({{student_email}})\n🩰 {{lesson_name}}\n📅 {{lesson_date}} · 🕐 {{lesson_time}}\n👩‍🏫 {{teacher_name}}\n📍 {{location_name}} · {{room_name}}\n\n[📅 Ouvrir les cours|{{dashboard_url}}]\n\n" + TEAM["fr"]),
   de=("📅 Neue Buchung: {{student_name}} — {{lesson_name}}, {{lesson_date}}", "Hallo {{school_name}} 👋\n\neine neue Buchung ist eingegangen.\n\n👩 {{student_name}} ({{student_email}})\n🩰 {{lesson_name}}\n📅 {{lesson_date}} · 🕐 {{lesson_time}}\n👩‍🏫 {{teacher_name}}\n📍 {{location_name}} · {{room_name}}\n\n[📅 Stunden öffnen|{{dashboard_url}}]\n\n" + TEAM["de"]))

_t("school.booking_cancelled",
   it=("❌ Prenotazione annullata: {{student_name}} — {{lesson_name}}, {{lesson_date}}", "Ciao {{school_name}} 👋\n\n{{student_name}} ({{student_email}}) ha annullato la sua prenotazione.\n\n🩰 {{lesson_name}}\n📅 {{lesson_date}} · 🕐 {{lesson_time}}\n👩‍🏫 {{teacher_name}}\n\nIl posto è di nuovo disponibile.\n\n[📅 Apri le lezioni|{{dashboard_url}}]\n\n" + TEAM["it"]),
   en=("❌ Booking cancelled: {{student_name}} — {{lesson_name}}, {{lesson_date}}", "Hello {{school_name}} 👋\n\n{{student_name}} ({{student_email}}) cancelled her booking.\n\n🩰 {{lesson_name}}\n📅 {{lesson_date}} · 🕐 {{lesson_time}}\n👩‍🏫 {{teacher_name}}\n\nThe spot is available again.\n\n[📅 Open lessons|{{dashboard_url}}]\n\n" + TEAM["en"]),
   es=("❌ Reserva cancelada: {{student_name}} — {{lesson_name}}, {{lesson_date}}", "Hola {{school_name}} 👋\n\n{{student_name}} ({{student_email}}) ha cancelado su reserva.\n\n🩰 {{lesson_name}}\n📅 {{lesson_date}} · 🕐 {{lesson_time}}\n👩‍🏫 {{teacher_name}}\n\nLa plaza vuelve a estar disponible.\n\n[📅 Abrir las clases|{{dashboard_url}}]\n\n" + TEAM["es"]),
   fr=("❌ Réservation annulée : {{student_name}} — {{lesson_name}}, {{lesson_date}}", "Bonjour {{school_name}} 👋\n\n{{student_name}} ({{student_email}}) a annulé sa réservation.\n\n🩰 {{lesson_name}}\n📅 {{lesson_date}} · 🕐 {{lesson_time}}\n👩‍🏫 {{teacher_name}}\n\nLa place est de nouveau disponible.\n\n[📅 Ouvrir les cours|{{dashboard_url}}]\n\n" + TEAM["fr"]),
   de=("❌ Buchung storniert: {{student_name}} — {{lesson_name}}, {{lesson_date}}", "Hallo {{school_name}} 👋\n\n{{student_name}} ({{student_email}}) hat ihre Buchung storniert.\n\n🩰 {{lesson_name}}\n📅 {{lesson_date}} · 🕐 {{lesson_time}}\n👩‍🏫 {{teacher_name}}\n\nDer Platz ist wieder frei.\n\n[📅 Stunden öffnen|{{dashboard_url}}]\n\n" + TEAM["de"]))

_t("school.stripe_connected",
   it=("💰 Stripe collegato: da oggi incassi online", "Ciao {{school_name}} 👋\n\nil collegamento con Stripe è completato: da questo momento le allieve possono acquistare pacchetti online e gli incassi arrivano direttamente sul tuo conto. ✨\n\n[💰 Vai ai pagamenti|{{dashboard_url}}]\n\n" + TEAM["it"]),
   en=("💰 Stripe connected: you can take payments online", "Hello {{school_name}} 👋\n\nyour Stripe connection is complete: from now on students can buy packages online and the money goes straight to your account. ✨\n\n[💰 Go to payments|{{dashboard_url}}]\n\n" + TEAM["en"]),
   es=("💰 Stripe conectado: desde hoy cobras online", "Hola {{school_name}} 👋\n\nla conexión con Stripe se ha completado: desde este momento las alumnas pueden comprar paquetes online y los cobros llegan directamente a tu cuenta. ✨\n\n[💰 Ir a los pagos|{{dashboard_url}}]\n\n" + TEAM["es"]),
   fr=("💰 Stripe connecté : vous encaissez désormais en ligne", "Bonjour {{school_name}} 👋\n\nla connexion avec Stripe est terminée : dès maintenant, les élèves peuvent acheter des forfaits en ligne et les paiements arrivent directement sur votre compte. ✨\n\n[💰 Voir les paiements|{{dashboard_url}}]\n\n" + TEAM["fr"]),
   de=("💰 Stripe verbunden: ab heute kassierst du online", "Hallo {{school_name}} 👋\n\ndie Verbindung mit Stripe ist abgeschlossen: ab sofort können Schülerinnen Pakete online kaufen, und die Zahlungen gehen direkt auf dein Konto. ✨\n\n[💰 Zu den Zahlungen|{{dashboard_url}}]\n\n" + TEAM["de"]))

_t("student.account_deleted",
   it=("🕊️ Il tuo account è stato eliminato",
       "Ciao {{student_first_name}} 🌸\n\nci dispiace che tu abbia deciso di eliminare il tuo account: il tuo profilo, le prenotazioni e i documenti sono stati cancellati come richiesto.\n\n"
       "Se un giorno vorrai riprendere, saremo pronte a ricominciare insieme — ti basterà creare un nuovo account. ✨\n\n[🩰 Ricomincia da qui|{{register_url}}]\n\n"
       "La sbarra resta al suo posto, e i sogni non hanno età. 🩰\n\n" + SIGN["it"]),
   en=("🕊️ Your account has been deleted",
       "Hi {{student_first_name}} 🌸\n\nwe are sorry you decided to delete your account: your profile, bookings and documents have been removed as requested.\n\n"
       "If one day you want to come back, we will be ready to start again together — you will just need to create a new account. ✨\n\n[🩰 Start again here|{{register_url}}]\n\n"
       "The barre stays right where it was, and dreams have no age. 🩰\n\n" + SIGN["en"]),
   es=("🕊️ Tu cuenta ha sido eliminada",
       "Hola {{student_first_name}} 🌸\n\nsentimos que hayas decidido eliminar tu cuenta: tu perfil, tus reservas y tus documentos se han cancelado como pediste.\n\n"
       "Si algún día quieres volver, estaremos listas para empezar de nuevo juntas — solo tendrás que crear una cuenta nueva. ✨\n\n[🩰 Empieza de nuevo aquí|{{register_url}}]\n\n"
       "La barra sigue en su sitio, y los sueños no tienen edad. 🩰\n\n" + SIGN["es"]),
   fr=("🕊️ Votre compte a été supprimé",
       "Bonjour {{student_first_name}} 🌸\n\nnous sommes désolées que vous ayez décidé de supprimer votre compte : votre profil, vos réservations et vos documents ont été effacés comme demandé.\n\n"
       "Si un jour vous souhaitez revenir, nous serons prêtes à recommencer ensemble — il vous suffira de créer un nouveau compte. ✨\n\n[🩰 Recommencer ici|{{register_url}}]\n\n"
       "La barre reste à sa place, et les rêves n'ont pas d'âge. 🩰\n\n" + SIGN["fr"]),
   de=("🕊️ Dein Konto wurde gelöscht",
       "Hallo {{student_first_name}} 🌸\n\nes tut uns leid, dass du dich entschieden hast, dein Konto zu löschen: dein Profil, deine Buchungen und deine Dokumente wurden wie gewünscht entfernt.\n\n"
       "Wenn du eines Tages zurückkommen möchtest, sind wir bereit, gemeinsam neu zu beginnen — du musst nur ein neues Konto anlegen. ✨\n\n[🩰 Hier neu beginnen|{{register_url}}]\n\n"
       "Die Stange bleibt, wo sie ist, und Träume haben kein Alter. 🩰\n\n" + SIGN["de"]))

_t("hq.new_school_registered",
   it=("🏫 Nuova scuola nella rete: {{school_name}}", "Ciao 👋\n\nuna nuova scuola è entrata in Danza Classica No Under 40.\n\n🏫 {{school_name}}\n📍 {{school_city}}\n✉️ {{school_email}}\n\n[🏫 Apri le scuole|{{school_url}}]\n\n" + TEAM["it"]),
   en=("🏫 New school in the network: {{school_name}}", "Hello 👋\n\na new school has joined Danza Classica No Under 40.\n\n🏫 {{school_name}}\n📍 {{school_city}}\n✉️ {{school_email}}\n\n[🏫 Open schools|{{school_url}}]\n\n" + TEAM["en"]),
   es=("🏫 Nueva escuela en la red: {{school_name}}", "Hola 👋\n\nuna nueva escuela se ha unido a Danza Classica No Under 40.\n\n🏫 {{school_name}}\n📍 {{school_city}}\n✉️ {{school_email}}\n\n[🏫 Abrir las escuelas|{{school_url}}]\n\n" + TEAM["es"]),
   fr=("🏫 Nouvelle école dans le réseau : {{school_name}}", "Bonjour 👋\n\nune nouvelle école a rejoint Danza Classica No Under 40.\n\n🏫 {{school_name}}\n📍 {{school_city}}\n✉️ {{school_email}}\n\n[🏫 Ouvrir les écoles|{{school_url}}]\n\n" + TEAM["fr"]),
   de=("🏫 Neue Schule im Netzwerk: {{school_name}}", "Hallo 👋\n\neine neue Schule ist Danza Classica No Under 40 beigetreten.\n\n🏫 {{school_name}}\n📍 {{school_city}}\n✉️ {{school_email}}\n\n[🏫 Schulen öffnen|{{school_url}}]\n\n" + TEAM["de"]))

_t("hq.weekly_kpi_report",
   it=("📊 La settimana di Danza Classica No Under 40", "Ciao 👋\n\necco i numeri della rete questa settimana.\n\n🏫 Scuole attive: {{active_schools}}\n👩 Allieve totali: {{total_students}}\n🩰 Lezioni in programma nei prossimi 7 giorni: {{lessons_this_week}}\n\nBuona settimana! ✨\n\n" + TEAM["it"]),
   en=("📊 This week at Danza Classica No Under 40", "Hello 👋\n\nhere are the network's numbers this week.\n\n🏫 Active schools: {{active_schools}}\n👩 Total students: {{total_students}}\n🩰 Lessons scheduled in the next 7 days: {{lessons_this_week}}\n\nHave a great week! ✨\n\n" + TEAM["en"]),
   es=("📊 La semana de Danza Classica No Under 40", "Hola 👋\n\naquí tienes los números de la red esta semana.\n\n🏫 Escuelas activas: {{active_schools}}\n👩 Alumnas totales: {{total_students}}\n🩰 Clases programadas en los próximos 7 días: {{lessons_this_week}}\n\n¡Buena semana! ✨\n\n" + TEAM["es"]),
   fr=("📊 La semaine de Danza Classica No Under 40", "Bonjour 👋\n\nvoici les chiffres du réseau cette semaine.\n\n🏫 Écoles actives : {{active_schools}}\n👩 Élèves au total : {{total_students}}\n🩰 Cours prévus dans les 7 prochains jours : {{lessons_this_week}}\n\nBonne semaine ! ✨\n\n" + TEAM["fr"]),
   de=("📊 Die Woche bei Danza Classica No Under 40", "Hallo 👋\n\nhier die Zahlen des Netzwerks in dieser Woche.\n\n🏫 Aktive Schulen: {{active_schools}}\n👩 Schülerinnen insgesamt: {{total_students}}\n🩰 Geplante Stunden in den nächsten 7 Tagen: {{lessons_this_week}}\n\nEine schöne Woche! ✨\n\n" + TEAM["de"]))
