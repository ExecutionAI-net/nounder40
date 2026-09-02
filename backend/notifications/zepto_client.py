"""ZeptoMail transactional email client (spec 19: Email Templates).

send_email() makes a real network call — every call site in this codebase
goes through send_transactional_email() in emails.py so there is exactly one
place that ever touches the network, making it easy to verify payload
construction without triggering a live send.
"""

import requests
from django.conf import settings

ZEPTO_API_URL = "https://api.zeptomail.eu/v1.1/email"


class ZeptoMailError(Exception):
    pass


def build_payload(*, to_email: str, to_name: str, subject: str, html_body: str) -> dict:
    return {
        "from": {"address": settings.ZEPTO_MAIL_FROM, "name": settings.ZEPTO_MAIL_FROM_NAME},
        "to": [{"email_address": {"address": to_email, "name": to_name or to_email}}],
        "subject": subject,
        "htmlbody": html_body,
    }


def send_email(*, to_email: str, to_name: str, subject: str, html_body: str) -> dict:
    if not settings.ZEPTO_MAIL_TOKEN:
        raise ZeptoMailError("ZEPTO_MAIL_TOKEN not configured")

    payload = build_payload(to_email=to_email, to_name=to_name, subject=subject, html_body=html_body)
    response = requests.post(
        ZEPTO_API_URL,
        json=payload,
        headers={
            "Authorization": settings.ZEPTO_MAIL_TOKEN,
            "Content-Type": "application/json",
        },
        timeout=10,
    )
    if response.status_code >= 300:
        raise ZeptoMailError(f"ZeptoMail {response.status_code}: {response.text[:500]}")
    return response.json()
