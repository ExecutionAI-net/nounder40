from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.viewsets import HQOnlyModelViewSet

from .models import HQCity, HQCountry
from .serializers import HQCitySerializer, HQCountrySerializer


class LocationsView(APIView):
    """Countries with their cities, derived from active school profiles —
    powers the booking city filter and the student profile."""

    permission_classes = [AllowAny]

    def get(self, request):
        from schools.models import School

        from .services import ENGLISH_NAMES, country_code_for

        # Countries and cities are NOT curated by hand: they mirror what
        # schools write in their profile (per Carlo). Whatever they wrote
        # ("Italy", "Italia", "IT") resolves to the ISO code, which is the
        # id the calendar link (?country=IT) and the filters work with.
        grouped: dict[str, set[str]] = {}
        names: dict[str, str] = {}
        rows = (
            School.objects.filter(active=True)
            .exclude(city="")
            .values_list("country", "city")
        )
        for country_raw, city in rows:
            raw = (country_raw or "").strip()
            code = country_code_for(raw)
            key = code or (raw.title() if raw else "Other")
            names.setdefault(key, ENGLISH_NAMES.get(code, key) if code else key)
            grouped.setdefault(key, set()).add(city.strip())

        data = [
            {
                "id": key,
                "name": names[key],
                "code": key if len(key) == 2 else "",
                "cities": [
                    {"id": f"{key}:{city}", "name": city}
                    for city in sorted(cities)
                ],
            }
            for key, cities in sorted(grouped.items(), key=lambda kv: names[kv[0]])
        ]
        return Response(data)


class HQCountryViewSet(HQOnlyModelViewSet):
    queryset = HQCountry.objects.all().order_by("name")
    serializer_class = HQCountrySerializer


class HQCityViewSet(HQOnlyModelViewSet):
    queryset = HQCity.objects.all().order_by("name")
    serializer_class = HQCitySerializer
    filterset_fields = ["country"]
