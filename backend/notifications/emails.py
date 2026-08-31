"""Template rendering + the one place every call site uses to send a
transactional email (spec 19: {{variable}} placeholders, per-school override)."""

import html
import logging
import re

from django.conf import settings as django_settings

from .builtin_templates import BRAND_COLOR, PLATFORM_NAME, PLATFORM_TAGLINE, get_builtin
from .models import EmailSetting, EmailTemplate
from .zepto_client import send_email

logger = logging.getLogger(__name__)

_VAR_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")
_TAG_RE = re.compile(r"<[a-z][\s\S]*>", re.I)
_FULL_DOC_RE = re.compile(r"<\s*(!doctype|html|body)\b", re.I)

# Mirrors previewDoc() in frontend hq/emails/page.tsx — the "Anteprima" tab is
# the promise, this is what actually reaches the inbox. Keep the two in sync.
# __HEADER__/__FOOTER__ are HQ-configurable (see _brand_frame below).
_LAYOUT = """<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
      <tr><td align="center" style="padding-bottom:24px;">
        __HEADER__
      </td></tr>
      <tr><td style="background:#ffffff;border-radius:16px;padding:40px 36px;box-shadow:0 1px 4px rgba(0,0,0,0.08);font-size:15px;color:#374151;line-height:1.7;">
        __CONTENT__
      </td></tr>
      <tr><td align="center" style="padding-top:24px;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">__FOOTER__</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>"""


def _brand_frame() -> tuple[str, str]:
    """Header + footer of the branded card, editable from HQ > Emails >
    Impostazioni (email_header_text / email_header_color / email_header_image /
    email_footer_text); the original brand look is the code default. An image
    header, when set, replaces the colored text pill."""
    keys = ("email_header_text", "email_header_color", "email_header_image", "email_footer_text")
    rows = dict(EmailSetting.objects.filter(key__in=keys).values_list("key", "value"))
    text = (rows.get("email_header_text") or "").strip() or PLATFORM_NAME
    color = (rows.get("email_header_color") or "").strip() or BRAND_COLOR
    image = (rows.get("email_header_image") or "").strip()
    footer = (rows.get("email_footer_text") or "").strip() or f"© {PLATFORM_NAME} · {PLATFORM_TAGLINE}"
    if image:
        header = (
            f'<img src="{html.escape(image, quote=True)}" alt="{html.escape(text, quote=True)}" '
            'style="display:block;max-width:100%;height:auto;border-radius:12px;margin:0 auto;" />'
        )
    else:
        header = (
            f'<div style="display:inline-block;background:{html.escape(color, quote=True)};border-radius:12px;padding:12px 24px;">'
            f'<span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px;">{html.escape(text)}</span></div>'
        )
    return header, html.escape(footer)


def _absolutize_media(doc: str) -> str:
    """The editor's image upload stores relative /media/ URLs: fine in the
    browser, broken in an inbox. Point them at the public site."""
    base = django_settings.FRONTEND_URL.rstrip("/")
    return doc.replace('src="/media/', f'src="{base}/media/')


def render(template_str: str, context: dict) -> str:
    return _VAR_RE.sub(lambda m: str(context.get(m.group(1), "")), template_str or "")


def to_html_body(body: str) -> str:
    """Turn whatever HQ > Emails stored into the document the mail client gets.

    Bodies come in three shapes:
    - plain text with newlines (the seeded templates, and anything typed in the
      HTML tab without tags): escaped, newlines → <br>, then the branded card.
      Sent raw, a mail client collapses every newline and the whole email
      lands on a single line.
    - an HTML fragment from the visual editor (<p>…</p>): the branded card.
    - a full document (the built-in fallbacks): untouched."""
    body = body or ""
    if _FULL_DOC_RE.search(body):
        return _absolutize_media(body)
    content = body if _TAG_RE.search(body) else html.escape(body, quote=False).replace("\n", "<br>")
    header, footer = _brand_frame()
    doc = _LAYOUT.replace("__CONTENT__", content).replace("__HEADER__", header).replace("__FOOTER__", footer)
    return _absolutize_media(doc)


def get_template(key: str, *, locale: str = "en", school=None) -> EmailTemplate | None:
    """School override first, falling back to the HQ global template.

    Two forgiving lookups so templates actually resolve:
    - key: call sites historically pass unprefixed keys ("booking_confirmed")
      while the HQ editor saves them namespaced ("student.booking_confirmed") —
      try both.
    - locale: if the template isn't filled in the student's language, fall
      back to English rather than silently not sending.
    - ".online" keys fall back to their in-person counterpart."""
    keys = [key] if "." in key else [key, f"student.{key}"]
    # An online lesson asks for "<key>.online"; if HQ never wrote that variant
    # the in-person one is still a far better email than none at all.
    if key.endswith(".online"):
        keys.append(key[: -len(".online")])
    locales = [locale] if locale == "en" else [locale, "en"]
    for loc in locales:
        for k in keys:
            if school is not None:
                t = EmailTemplate.objects.filter(school=school, key=k, locale=loc).first()
                if _usable(t):
                    return t
        for k in keys:
            t = EmailTemplate.objects.filter(school__isnull=True, key=k, locale=loc).first()
            if _usable(t):
                return t
    return None


def _usable(template: EmailTemplate | None) -> bool:
    """A row saved half-finished (opened in the editor, never filled in) is not
    a template: sending it would deliver a blank email, and for the keys that
    have one it would also shadow the built-in fallback."""
    return bool(template and template.subject.strip() and template.body_html.strip())


_OFF = ("off", "false", "0")


def get_setting(key: str, default: str) -> str:
    """HQ > Emails settings (credits_low_threshold, expiry_reminder_days, …)."""
    row = EmailSetting.objects.filter(key=key).first()
    return row.value if row and row.value.strip() else default


def is_enabled(key: str) -> bool:
    """HQ > Emails switches. The global "all emails" one first, then the
    template's own. A missing row means on.

    The HQ page saves the per-template switch as "enabled.<namespaced key>"
    ("enabled.student.booking_confirmed") while call sites pass bare keys
    ("booking_confirmed") — so for months neither that nor the global switch
    was ever read. Legacy bare rows ("password_reset": "off") still count."""
    keys = [key] if "." in key else [key, f"student.{key}"]
    if key.endswith(".online"):  # the online variant obeys the in-person switch too
        keys.append(key[: -len(".online")])
    lookup = ["emails_enabled", *keys, *(f"enabled.{k}" for k in keys)]
    rows = dict(EmailSetting.objects.filter(key__in=lookup).values_list("key", "value"))
    if rows.get("emails_enabled", "true") in _OFF:
        return False
    return not any(rows.get(k) in _OFF for k in lookup[1:])


def send_transactional_email(*, to_email: str, to_name: str, key: str, context: dict, locale: str = "en", school=None) -> bool:
    """Returns False (no-op, not an error) if the template is missing or the
    HQ email-settings switch for this key is off — matches spec 16.1/6.11.

    Every no-op is logged: a silently skipped email is indistinguishable from a
    broken mail provider from the outside, and that ambiguity once hid the
    password_reset regression for the whole Supabase → Django migration."""
    if not to_email:
        logger.warning("email skipped (key=%s): no recipient address", key)
        return False
    if not is_enabled(key):
        logger.info("email skipped (key=%s): switched off in HQ > Emails", key)
        return False
    template = get_template(key, locale=locale, school=school)
    if template is not None:
        subject_template, body_template = template.subject, template.body_html
    else:
        # Account-critical emails (password reset, team invite) ship a built-in
        # branded template so they work before anyone has written one in HQ.
        builtin = get_builtin(key, locale)
        if builtin is None:
            logger.warning(
                "email NOT sent (key=%s locale=%s school=%s): no template row — "
                "create it in HQ > Emails",
                key, locale, getattr(school, "id", None),
            )
            return False
        logger.info("email (key=%s locale=%s): using built-in fallback template", key, locale)
        subject_template, body_template = builtin

    subject = render(subject_template, context)
    html_body = to_html_body(render(body_template, context))
    send_email(to_email=to_email, to_name=to_name, subject=subject, html_body=html_body)
    return True
