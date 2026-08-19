import re

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
    """Landing-page counters (platform_settings key/value)."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({s.key: s.value for s in PlatformSetting.objects.all()})


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

        PlatformSetting.objects.update_or_create(key="brand_color_bg", defaults={"value": color_bg.upper()})
        PlatformSetting.objects.update_or_create(key="brand_color_primary", defaults={"value": color_primary.upper()})
        PlatformSetting.objects.update_or_create(key="brand_nav_links", defaults={"value": json.dumps(nav_links)})
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
