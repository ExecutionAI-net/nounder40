"""Template rendering + the one place every call site uses to send a
transactional email (spec 19: {{variable}} placeholders, per-school override)."""

import logging
import re

from .builtin_templates import get_builtin
from .models import EmailSetting, EmailTemplate
from .zepto_client import send_email

logger = logging.getLogger(__name__)

_VAR_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


def render(template_str: str, context: dict) -> str:
    return _VAR_RE.sub(lambda m: str(context.get(m.group(1), "")), template_str or "")


def get_template(key: str, *, locale: str = "en", school=None) -> EmailTemplate | None:
    """School override first, falling back to the HQ global template.

    Two forgiving lookups so templates actually resolve:
    - key: call sites historically pass unprefixed keys ("booking_confirmed")
      while the HQ editor saves them namespaced ("student.booking_confirmed") —
      try both.
    - locale: if the template isn't filled in the student's language, fall
      back to English rather than silently not sending."""
    keys = [key] if "." in key else [key, f"student.{key}"]
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


def is_enabled(key: str) -> bool:
    setting = EmailSetting.objects.filter(key=key).first()
    return setting is None or setting.value not in ("off", "false", "0")


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
        logger.info("email skipped (key=%s): switched off in HQ email settings", key)
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
    html_body = render(body_template, context)
    send_email(to_email=to_email, to_name=to_name, subject=subject, html_body=html_body)
    return True
