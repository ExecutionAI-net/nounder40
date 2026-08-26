from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.viewsets import HQOnlyModelViewSet

from .models import HQCity, HQCountry
from .serializers import HQCitySerializer, HQCountrySerializer


# Countries and cities are NOT curated by hand: they mirror what schools
# write in their profile (per Carlo). Normalize the common code/name variants
# so "IT" and "Italy" group together.
COUNTRY_NAMES = {
    "IT": "Italy", "ITALY": "Italy", "ITALIA": "Italy",
    "FR": "France", "FRANCE": "France", "FRANCIA": "France",
    "ES": "Spain", "SPAIN": "Spain", "ESPAÑA": "Spain", "SPAGNA": "Spain",
    "DE": "Germany", "GERMANY": "Germany", "DEUTSCHLAND": "Germany", "GERMANIA": "Germany",
    "GB": "United Kingdom", "UK": "United Kingdom", "UNITED KINGDOM": "United Kingdom",
    "TR": "Turkey", "TURKEY": "Turkey", "TÜRKIYE": "Turkey", "TURCHIA": "Turkey",
}
COUNTRY_CODES = {
    "Italy": "IT", "France": "FR", "Spain": "ES", "Germany": "DE",
    "United Kingdom": "GB", "Turkey": "TR",
}


class LocationsView(APIView):
    """Countries with their cities, derived from active school profiles —
    powers the booking city filter and the student profile."""

    permission_classes = [AllowAny]

    def get(self, request):
        from schools.models import School

        grouped: dict[str, set[str]] = {}
        rows = (
            School.objects.filter(active=True)
            .exclude(city="")
            .values_list("country", "city")
        )
        for country_raw, city in rows:
            raw = (country_raw or "").strip()
            name = COUNTRY_NAMES.get(raw.upper(), raw.title() if raw else "Other")
            grouped.setdefault(name, set()).add(city.strip())

        data = [
            {
                "id": COUNTRY_CODES.get(name, name),
                "name": name,
                "code": COUNTRY_CODES.get(name, name[:2].upper()),
                "cities": [
                    {"id": f"{name}:{city}", "name": city}
                    for city in sorted(cities)
                ],
            }
            for name, cities in sorted(grouped.items())
        ]
        return Response(data)


class HQCountryViewSet(HQOnlyModelViewSet):
    queryset = HQCountry.objects.all().order_by("name")
    serializer_class = HQCountrySerializer


class HQCityViewSet(HQOnlyModelViewSet):
    queryset = HQCity.objects.all().order_by("name")
    serializer_class = HQCitySerializer
    filterset_fields = ["country"]
