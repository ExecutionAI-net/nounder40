from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

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
