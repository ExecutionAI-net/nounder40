from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import HQCountry


class LocationsView(APIView):
    """Countries with their cities — powers the booking city filter."""

    permission_classes = [AllowAny]

    def get(self, request):
        countries = HQCountry.objects.prefetch_related("cities").order_by("name")
        data = [
            {
                "id": str(c.id),
                "name": c.name,
                "code": c.code,
                "cities": [{"id": str(city.id), "name": city.name} for city in c.cities.all()],
            }
            for c in countries
        ]
        return Response(data)
