import re
import time

import requests
from django.conf import settings
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.viewsets import is_hq

from .emails import to_html_body
from .models import EmailSetting, EmailTemplate
from .zepto_client import ZeptoMailError, send_email


class HQEmailTemplatesView(APIView):
    """GET (list) / POST (upsert one) / DELETE (remove a key, all locales)
    /api/hq/email-templates/ — the Email Templates page's template list.
    Scoped to school IS NULL (HQ's global templates)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        qs = EmailTemplate.objects.filter(school__isnull=True).order_by("key", "locale")
        return Response([
            {"key": t.key, "locale": t.locale, "subject": t.subject, "body_html": t.body_html, "updated_at": t.updated_at}
            for t in qs
        ])

    def post(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        key = request.data.get("key")
        locale = request.data.get("locale")
        if not key or not locale:
            return Response({"error": "key and locale required"}, status=400)
        EmailTemplate.objects.update_or_create(
            school=None, key=key, locale=locale,
            defaults={"subject": request.data.get("subject") or "", "body_html": request.data.get("body_html") or ""},
        )
        return Response({"ok": True})

    def delete(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        key = request.data.get("key")
        if not key:
            return Response({"error": "key required"}, status=400)
        EmailTemplate.objects.filter(school__isnull=True, key=key).delete()
        return Response({"ok": True})


class HQEmailSettingsView(APIView):
    """GET/POST /api/hq/email-settings/ — key/value dump. Unlike
    HQBrandSettingsView's open GET (that data is also public via
    PlatformStatsView/the student shop), nothing else exposes these
    per-template on/off switches, so GET is HQ-gated too."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        return Response({s.key: s.value for s in EmailSetting.objects.all()})

    def post(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        for key, value in request.data.items():
            EmailSetting.objects.update_or_create(key=key, defaults={"value": str(value)})
        return Response({"ok": True})


class HQEmailTemplateImageUploadView(APIView):
    """POST multipart 'file' /api/hq/email-templates/image/ — image upload
    for the rich-text email editor. Returns the public URL to insert."""

    permission_classes = [IsAuthenticated]

    _ALLOWED = ("image/jpeg", "image/png", "image/webp", "image/gif")
    _MAX_SIZE = 4 * 1024 * 1024

    def post(self, request):
        from core.storage import save_public

        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        f = request.FILES.get("file")
        if not f:
            return Response({"error": "file is required"}, status=400)
        if f.content_type not in self._ALLOWED:
            return Response({"error": "invalid_type"}, status=400)
        if f.size > self._MAX_SIZE:
            return Response({"error": "too_large"}, status=400)
        url = save_public(f, subdir="email-assets")
        return Response({"image_url": url})


_ALL_LOCALES = ["en", "it", "es", "fr", "de"]
_LOCALE_NAMES = {"en": "English", "it": "Italian", "es": "Spanish", "fr": "French", "de": "German"}


class _EmailTranslateAPIError(Exception):
    pass


def _translate_email_text(text: str, from_locale: str, to_locale: str) -> str:
    prompt = (
        f"Translate the following from {_LOCALE_NAMES[from_locale]} to {_LOCALE_NAMES[to_locale]} "
        "for a professional dance school platform email.\n\n"
        "RULES:\n"
        "- Keep {{variable}} placeholders EXACTLY as-is\n"
        "- Keep HTML tags intact\n"
        '- Do NOT translate: "No Under 40", proper nouns, brand names\n'
        "- Professional, warm tone\n"
        "- Return ONLY the translated text, nothing else\n\n"
        f"Text to translate:\n{text}"
    )
    res = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": settings.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=60,
    )
    if not res.ok:
        raise _EmailTranslateAPIError(f"Anthropic error {res.status_code}")
    return res.json()["content"][0]["text"].strip()


class HQEmailTemplateAutoTranslateView(APIView):
    """POST /api/hq/email-templates/auto-translate/ — translate a template's
    filled source locale into every other missing locale, via Anthropic.
    Body: {key, source?}."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        if not settings.ANTHROPIC_API_KEY:
            return Response({"error": "ANTHROPIC_API_KEY not configured"}, status=500)

        key = request.data.get("key")
        source = request.data.get("source")
        if not key:
            return Response({"error": "key required"}, status=400)

        existing = {t.locale: t for t in EmailTemplate.objects.filter(school__isnull=True, key=key)}

        def filled(locale):
            t = existing.get(locale)
            return bool(t and t.subject.strip() and t.body_html.strip())

        requested = source if source in _ALL_LOCALES else "en"
        source_locale = requested if filled(requested) else next((loc for loc in _ALL_LOCALES if filled(loc)), None)
        if not source_locale:
            return Response(
                {"error": "Nessuna lingua compilata da cui tradurre — salva prima il template"}, status=404
            )
        src = existing[source_locale]

        translated = 0
        for locale in _ALL_LOCALES:
            if locale == source_locale or filled(locale):
                continue
            try:
                new_subject = _translate_email_text(src.subject, source_locale, locale)
                new_body = _translate_email_text(src.body_html, source_locale, locale)
                EmailTemplate.objects.update_or_create(
                    school=None, key=key, locale=locale,
                    defaults={"subject": new_subject, "body_html": new_body},
                )
                translated += 1
                time.sleep(0.2)
            except _EmailTranslateAPIError:
                continue

        return Response({"translated": translated})


# Fallback values for the placeholders a real booking cannot supply (credits,
# packages, account links). Keep the key set aligned with SAMPLE_VARS in
# frontend hq/emails/page.tsx.
_SAMPLE_VARS = {
    "user_name": "Maria Rossi", "reset_url": "#", "setup_url": "#",
    "student_name": "Maria Rossi", "student_email": "maria.rossi@example.com",
    "school_name": "Dance Studio Roma", "school_city": "Roma", "school_email": "info@dancestudioroma.it",
    "lesson_name": "Ballet Fundamentals", "lesson_date": "25-04-2026",
    "lesson_time": "18:00", "lesson_duration": "60 min", "teacher_name": "Sofia Ferrari",
    "location_name": "Studio Roma Centro", "location_address": "Via Roma 12, 00184 Roma",
    "room_name": "Sala A", "online_link": "https://zoom.us/j/123456789",
    "credits_remaining": "3", "credits_used": "7", "credits_threshold": "5",
    "package_name": "Monthly 10 Credits", "package_expiry": "30 April 2026",
    "subscription_name": "Monthly Unlimited", "subscription_expiry": "30 April 2026",
    "accesses_remaining": "5", "amount": "€45.00",
    "days_absent": "30", "last_lesson_date": "25 March 2026", "document_type": "Medical certificate",
    "platform_name": "No Under 40",
}


def _test_send_context(locale: str) -> dict:
    """The test email should look like the real one: take the latest booking
    on the platform and run it through the same context builder the booking
    flow uses, so a placeholder the builder does not fill shows up here before
    it shows up in a student's inbox. Sample values only fill what a booking
    cannot (credits, packages…) — or everything, on an empty database."""
    from bookings.models import Booking
    from bookings.services import booking_email_context

    context = {
        **_SAMPLE_VARS,
        "booking_url": f"{settings.FRONTEND_URL}/{locale}/student/bookings",
        "dashboard_url": f"{settings.FRONTEND_URL}/{locale}/school/lessons",
        "school_url": f"{settings.FRONTEND_URL}/{locale}/hq/schools",
    }
    booking = (
        Booking.objects.filter(status=Booking.Status.CONFIRMED)
        .select_related(
            "student", "school", "lesson__lesson_type", "lesson__teacher", "lesson__room__location",
            "lesson__course__teacher", "lesson__course__room__location",
        )
        .order_by("-lesson__date", "-lesson__start_time")
        .first()
    )
    if booking is not None:
        context.update(booking_email_context(booking, locale))
    return context


_VAR_RE = re.compile(r"\{\{(\w+)\}\}")


class HQEmailTemplateTestSendView(APIView):
    """POST /api/hq/email-templates/test-send/ — sends a real test email via
    ZeptoMail, rendered with the latest real booking (see _test_send_context).
    Body: subject, body_html, to_email, locale (optional, default en)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        subject = request.data.get("subject")
        body_html = request.data.get("body_html")
        to_email = request.data.get("to_email")
        if not subject or not body_html or not to_email:
            return Response({"error": "subject, body_html and to_email required"}, status=400)

        context = _test_send_context(request.data.get("locale") or "en")
        rendered_subject = _VAR_RE.sub(lambda m: context.get(m.group(1), m.group(0)), subject)
        rendered_body = to_html_body(_VAR_RE.sub(lambda m: context.get(m.group(1), m.group(0)), body_html))

        try:
            send_email(to_email=to_email, to_name="", subject=f"[TEST] {rendered_subject}", html_body=rendered_body)
        except ZeptoMailError as e:
            return Response({"error": str(e)}, status=500)
        return Response({"ok": True})
