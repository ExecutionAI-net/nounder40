"""Template rendering + the one place every call site uses to send a
transactional email (spec 19: {{variable}} placeholders, per-school override)."""

import re

from .models import EmailSetting, EmailTemplate
from .zepto_client import send_email

_VAR_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


def render(template_str: str, context: dict) -> str:
    return _VAR_RE.sub(lambda m: str(context.get(m.group(1), "")), template_str or "")


def get_template(key: str, *, locale: str = "en", school=None) -> EmailTemplate | None:
    """School override first, falling back to the HQ global template."""
    if school is not None:
        t = EmailTemplate.objects.filter(school=school, key=key, locale=locale).first()
        if t:
            return t
    return EmailTemplate.objects.filter(school__isnull=True, key=key, locale=locale).first()


def is_enabled(key: str) -> bool:
    setting = EmailSetting.objects.filter(key=key).first()
    return setting is None or setting.value not in ("off", "false", "0")


def send_transactional_email(*, to_email: str, to_name: str, key: str, context: dict, locale: str = "en", school=None) -> bool:
    """Returns False (no-op, not an error) if the template is missing or the
    HQ email-settings switch for this key is off — matches spec 16.1/6.11."""
    if not to_email or not is_enabled(key):
        return False
    template = get_template(key, locale=locale, school=school)
    if template is None:
        return False
    subject = render(template.subject, context)
    html_body = render(template.body_html, context)
    send_email(to_email=to_email, to_name=to_name, subject=subject, html_body=html_body)
    return True
