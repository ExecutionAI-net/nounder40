import json
import re
import time

import requests
from django.conf import settings
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.viewsets import is_hq

from .models import PlatformSetting, Translation


class TranslationsView(APIView):
    """Dynamic DB-driven UI copy. ?locale=xx returns a {key: value} map."""

    permission_classes = [AllowAny]

    def get(self, request):
        locale = request.query_params.get("locale")
        qs = Translation.objects.all()
        if locale:
            qs = qs.filter(locale=locale)
        return Response({t.key: t.value for t in qs})


class PlatformStatsView(APIView):
    """Landing-page counters + platform_settings dump.

    I quattro contatori marketing (stat_*) sono CALCOLATI dal database, non
    letti da platform_settings: i numeri sulla home devono essere veri.
    HQ può tornare ai numeri inseriti a mano spegnendo il toggle
    `homepage_real_stats` (HQ > Homepage; assente = veri). Le altre chiavi
    (es. student_shop_enabled) restano il dump grezzo che le pagine
    studente già consumano. Cache di 5 minuti: la landing è pubblica e i
    COUNT non devono girare a ogni visita.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        payload = {s.key: s.value for s in PlatformSetting.objects.all()}
        if payload.get("homepage_real_stats", "true") != "false":
            payload.update(_real_platform_stats())
        return Response(payload)


def _real_platform_stats():
    from django.core.cache import cache

    cached = cache.get("real_platform_stats")
    if cached is not None:
        return cached

    from django.utils import timezone

    from catalog.models import Lesson
    from schools.models import School, SchoolLocation
    from students.models import Student
    from teachers.models import TeacherSchool

    today = timezone.localdate()
    # "Sedi": i locali delle scuole attive; se nessuna scuola ha ancora
    # configurato le sedi, conta le scuole stesse.
    locations = SchoolLocation.objects.filter(school__active=True).count()
    schools = locations or School.objects.filter(active=True).count()
    stats = {
        "stat_schools": str(schools),
        "stat_teachers": str(
            TeacherSchool.objects.filter(active=True, school__active=True, teacher__active=True)
            .values("teacher")
            .distinct()
            .count()
        ),
        "stat_students": str(Student.objects.count()),
        "stat_lessons_monthly": str(
            Lesson.objects.filter(
                school__active=True, date__year=today.year, date__month=today.month
            )
            .exclude(status=Lesson.Status.CANCELLED)
            .count()
        ),
    }
    cache.set("real_platform_stats", stats, 300)
    return stats


class HQHomepageSettingsView(APIView):
    """GET/POST /api/hq/homepage-settings/ — the landing page's marketing
    stat counters (stat_teachers/stat_students/stat_lessons_monthly/
    stat_schools), stored in the same platform_settings key/value table
    PlatformStatsView reads publicly."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({s.key: s.value for s in PlatformSetting.objects.all()})

    def post(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        body = request.data
        updates = {
            "stat_teachers": str(int(body.get("teachers") or 0)),
            "stat_students": str(int(body.get("students") or 0)),
            "stat_lessons_monthly": str(int(body.get("lessonsMonthly") or 0)),
            "stat_schools": str(int(body.get("schools") or 0)),
        }
        for key, value in updates.items():
            PlatformSetting.objects.update_or_create(key=key, defaults={"value": value})
        return Response({"success": True})


class HQHomepageRealStatsView(APIView):
    """GET/POST /api/hq/homepage-real-stats/ — toggle: la home mostra i
    numeri veri calcolati dal database (default) oppure quelli inseriti a
    mano in HQ > Homepage. Stessa meccanica dei toggle di visibilità: chiave
    `homepage_real_stats` ("true"/"false", assente = true), letta dal dump
    pubblico /platform-stats/."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        s = PlatformSetting.objects.filter(key="homepage_real_stats").first()
        return Response({"enabled": (s.value if s else "true") != "false"})

    def post(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        enabled = bool(request.data.get("enabled"))
        PlatformSetting.objects.update_or_create(
            key="homepage_real_stats", defaults={"value": "true" if enabled else "false"}
        )
        return Response({"enabled": enabled})


class HQStudentShopVisibilityView(APIView):
    """GET/POST /api/hq/student-shop-visibility/ — platform-wide toggle to
    hide the shop from the student panel while HQ prepares the catalog.
    Stored as platform_settings key `student_shop_enabled` ("true"/"false",
    missing = true); the public /platform-stats/ dump exposes it, so the
    student layout/pages read it with the brand settings they already fetch."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        s = PlatformSetting.objects.filter(key="student_shop_enabled").first()
        return Response({"enabled": (s.value if s else "true") != "false"})

    def post(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        enabled = bool(request.data.get("enabled"))
        PlatformSetting.objects.update_or_create(
            key="student_shop_enabled", defaults={"value": "true" if enabled else "false"}
        )
        return Response({"enabled": enabled})


class HQStudentCreditsVisibilityView(APIView):
    """GET/POST /api/hq/student-credits-visibility/ — platform-wide toggle:
    show raw credit numbers in the student panel (calendar, my lessons, buy
    packages, my packages). Off = students reason only in lessons; the credit
    engine underneath is untouched. Same mechanics as the shop toggle: key
    `student_credits_visible` ("true"/"false", missing = true), exposed by the
    public /platform-stats/ dump the student pages already fetch."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        s = PlatformSetting.objects.filter(key="student_credits_visible").first()
        return Response({"enabled": (s.value if s else "true") != "false"})

    def post(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        enabled = bool(request.data.get("enabled"))
        PlatformSetting.objects.update_or_create(
            key="student_credits_visible", defaults={"value": "true" if enabled else "false"}
        )
        return Response({"enabled": enabled})


_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_SAFE_URL_RE = re.compile(r"^(https?://|/)", re.I)


class HQBrandSettingsView(APIView):
    """GET/POST /api/hq/brand-settings/ — logo/colors/nav-links for the
    student-facing shop theme. Returns the raw key/value dump (same shape
    as PlatformStatsView) — the frontend already has parseBrandSettings()
    to resolve it, since the public GET (unauthenticated shop visitors)
    needs that same resolution logic anyway."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({s.key: s.value for s in PlatformSetting.objects.all()})

    def post(self, request):
        import json

        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        body = request.data
        color_bg = str(body.get("colorBg") or "").strip()
        color_primary = str(body.get("colorPrimary") or "").strip()
        if not _HEX_RE.match(color_bg) or not _HEX_RE.match(color_primary):
            return Response({"error": "invalid_color"}, status=400)

        raw_links = body.get("navLinks") if isinstance(body.get("navLinks"), list) else []
        nav_links = [
            {"label": str(link.get("label") or "").strip(), "url": str(link.get("url") or "").strip()}
            for link in raw_links if isinstance(link, dict)
        ]
        nav_links = [link for link in nav_links if link["label"] and link["url"]]
        if any(not _SAFE_URL_RE.match(link["url"]) for link in nav_links):
            return Response({"error": "invalid_url"}, status=400)

        # Colori barra laterale per ruolo (sfondo + testo), opzionali
        sidebars = body.get("sidebars") if isinstance(body.get("sidebars"), dict) else {}
        sidebar_updates = {}
        for role in ("hq", "school", "teacher", "student"):
            entry = sidebars.get(role)
            if not isinstance(entry, dict):
                continue
            for part in ("bg", "text"):
                value = str(entry.get(part) or "").strip()
                if not value:
                    continue
                if not _HEX_RE.match(value):
                    return Response({"error": "invalid_color"}, status=400)
                sidebar_updates[f"sidebar_{role}_{part}"] = value.upper()

        PlatformSetting.objects.update_or_create(key="brand_color_bg", defaults={"value": color_bg.upper()})
        PlatformSetting.objects.update_or_create(key="brand_color_primary", defaults={"value": color_primary.upper()})
        PlatformSetting.objects.update_or_create(key="brand_nav_links", defaults={"value": json.dumps(nav_links)})
        for key, value in sidebar_updates.items():
            PlatformSetting.objects.update_or_create(key=key, defaults={"value": value})
        return Response({s.key: s.value for s in PlatformSetting.objects.all()})


class HQBrandLogoView(APIView):
    """POST (multipart 'file') / DELETE /api/hq/brand-settings/logo/ —
    upload or reset the platform logo."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from core.storage import save_public

        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        f = request.FILES.get("file")
        if not f:
            return Response({"error": "file required"}, status=400)
        if f.content_type not in ("image/jpeg", "image/png", "image/webp"):
            return Response({"error": "invalid_type"}, status=400)
        if f.size > 4 * 1024 * 1024:
            return Response({"error": "too_large"}, status=400)
        url = save_public(f, subdir="brand")
        PlatformSetting.objects.update_or_create(key="brand_logo_url", defaults={"value": url})
        return Response({"image_url": url})

    def delete(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        default_url = "/Logo.png"
        PlatformSetting.objects.update_or_create(key="brand_logo_url", defaults={"value": default_url})
        return Response({"image_url": default_url})


class HQTranslationsView(APIView):
    """GET/POST/DELETE /api/hq/translations/ — UI copy management (all
    locales grouped by key). Distinct from the public TranslationsView
    above (single-locale flat map consumed by the running app)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        by_key: dict = {}
        for t in Translation.objects.all().order_by("key"):
            by_key.setdefault(t.key, {"key": t.key})[t.locale] = t.value
        return Response(list(by_key.values()))

    def post(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        key = request.data.get("key")
        locale = request.data.get("locale")
        value = request.data.get("value")
        if not key or not locale or value is None:
            return Response({"error": "key, locale, and value are required"}, status=400)
        Translation.objects.update_or_create(key=key, locale=locale, defaults={"value": value})
        return Response({"ok": True})

    def delete(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        key = request.data.get("key")
        if not key:
            return Response({"error": "key is required"}, status=400)
        Translation.objects.filter(key=key).delete()
        return Response({"ok": True})


_LOCALE_NAMES = {"en": "English", "it": "Italian", "es": "Spanish", "fr": "French", "de": "German"}
_LOCALES_TO_FILL = ["it", "es", "fr", "de"]
_BATCH_SIZE = 50


class _TranslateAPIError(Exception):
    pass


def _derive_en_from_key(key: str) -> str:
    last_segment = key.split(".")[-1]
    spaced = re.sub(r"([A-Z])", r" \1", last_segment).replace("-", " ").replace("_", " ").strip()
    return spaced[:1].upper() + spaced[1:] if spaced else spaced


def _translate_batch(pairs: list[dict], from_locale: str, to_locale: str) -> list[dict]:
    prompt = (
        'You are a professional translator for a classical dance school SaaS platform called "No Under 40".\n\n'
        f"Translate the following UI strings from {_LOCALE_NAMES[from_locale]} to {_LOCALE_NAMES[to_locale]}.\n\n"
        "STRICT RULES:\n"
        "1. Keep {placeholders} like {email}, {name}, {count}, {date}, {amount}, {hours} EXACTLY as-is\n"
        "2. Keep emoji characters exactly as-is\n"
        '3. Do NOT translate proper nouns: "No Under 40", "Stripe", "Google", "HQ", "PayPal", "POS", "CSV"\n'
        '4. Keep symbols: "←", "→", "↑", "+", "..."\n'
        "5. Use formal/professional register for a business app\n"
        "6. Return ONLY a valid JSON array, no other text:\n"
        '[{"key": "...", "value": "...translated..."}]\n\n'
        f"Input:\n{json.dumps([{'key': p['key'], 'source': p['source']} for p in pairs], indent=2)}"
    )

    for attempt in range(1, 4):
        try:
            res = requests.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": settings.ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 8096,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=60,
            )
            if res.status_code == 429:
                raise _TranslateAPIError("rate_limit")
            if res.status_code == 401:
                raise _TranslateAPIError("invalid_api_key")
            if res.status_code == 403:
                raise _TranslateAPIError("quota_exceeded")
            if not res.ok:
                raise _TranslateAPIError(f"api_error_{res.status_code}")
            text = res.json()["content"][0]["text"].strip()
            match = re.search(r"\[[\s\S]*\]", text)
            if not match:
                raise _TranslateAPIError("no_json")
            return json.loads(match.group(0))
        except _TranslateAPIError as e:
            if str(e) in ("rate_limit", "quota_exceeded", "invalid_api_key"):
                raise
            if attempt == 3:
                return [{"key": p["key"], "value": p["source"]} for p in pairs]
            time.sleep(2 * attempt)
    return [{"key": p["key"], "value": p["source"]} for p in pairs]


class HQTranslationsAutoFillView(APIView):
    """POST /api/hq/translations/auto-fill/ — AI-assisted translation of
    missing UI copy (EN source -> IT/ES/FR/DE), via the Anthropic API."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        if not settings.ANTHROPIC_API_KEY:
            return Response({"error": "ANTHROPIC_API_KEY not configured"}, status=500)

        try:
            db: dict = {}
            for t in Translation.objects.all():
                db.setdefault(t.key, {})[t.locale] = t.value or ""

            all_keys = list(db.keys())
            total_filled = 0

            for key in all_keys:
                locale_map = db[key]
                if (locale_map.get("en") or "").strip():
                    continue
                source = ""
                for loc in _LOCALES_TO_FILL:
                    v = (locale_map.get(loc) or "").strip()
                    if v:
                        source = v
                        break
                if not source:
                    source = _derive_en_from_key(key)
                locale_map["en"] = source
                Translation.objects.update_or_create(key=key, locale="en", defaults={"value": source})
                total_filled += 1

            for locale in _LOCALES_TO_FILL:
                missing = [
                    {"key": key, "source": db[key]["en"]}
                    for key in all_keys
                    if not (db[key].get(locale) or "").strip() and (db[key].get("en") or "").strip()
                ]
                if not missing:
                    continue
                for i in range(0, len(missing), _BATCH_SIZE):
                    batch = missing[i : i + _BATCH_SIZE]
                    translated = _translate_batch(batch, "en", locale)
                    for item in translated:
                        Translation.objects.update_or_create(
                            key=item["key"], locale=locale, defaults={"value": item["value"]}
                        )
                    total_filled += len(translated)
                    time.sleep(0.3)

            return Response({"filled": total_filled})
        except _TranslateAPIError as e:
            code = str(e)
            if code == "rate_limit":
                return Response({"error": "API rate limit exceeded. Please try again later."}, status=429)
            if code == "quota_exceeded":
                return Response({"error": "Anthropic API quota exceeded. Please check your account."}, status=403)
            if code == "invalid_api_key":
                return Response({"error": "Anthropic API key invalid or expired."}, status=401)
            return Response({"error": "Anthropic API error. Please try again."}, status=502)


class HQDeployView(APIView):
    """POST /api/hq/deploy/ — trigger the production build via a deploy hook."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not is_hq(request.user):
            raise PermissionDenied("HQ only.")
        hook_url = settings.VERCEL_DEPLOY_HOOK_URL
        if not hook_url:
            return Response({"error": "Deploy hook not configured"}, status=500)
        try:
            res = requests.post(hook_url, timeout=10)
        except requests.RequestException:
            return Response({"error": "Deploy hook failed"}, status=502)
        if not res.ok:
            return Response({"error": "Deploy hook failed"}, status=502)
        return Response({"ok": True})
