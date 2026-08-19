from rest_framework import generics
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.viewsets import HQOnlyModelViewSet, SchoolScopedModelViewSet, is_hq

from .models import School, SchoolClosure, SchoolDocumentType, SchoolLocation, SchoolRoom
from .serializers import (
    PublicSchoolSerializer,
    SchoolClosureSerializer,
    SchoolDocumentTypeSerializer,
    SchoolLocationSerializer,
    SchoolRoomSerializer,
    SchoolSerializer,
)


class PublicSchoolsView(generics.ListAPIView):
    """Active schools, public (booking/browse). Filter with ?city= ?country=."""

    permission_classes = [AllowAny]
    serializer_class = PublicSchoolSerializer

    def get_queryset(self):
        qs = School.objects.filter(active=True).order_by("name")
        p = self.request.query_params
        if p.get("city"):
            qs = qs.filter(city__iexact=p["city"])
        if p.get("country"):
            qs = qs.filter(country__iexact=p["country"])
        return qs


class SchoolViewSet(HQOnlyModelViewSet):
    """HQ manages every school; a school user can read their own."""

    queryset = School.objects.all().order_by("name")
    serializer_class = SchoolSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["active", "city", "country"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if is_hq(user):
            return qs
        return qs.filter(id=user.active_school_id)

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        self._require_hq()
        school = self.get_object()
        school.active = True
        school.save(update_fields=["active"])
        return Response(self.get_serializer(school).data)

    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        self._require_hq()
        school = self.get_object()
        school.active = False
        school.save(update_fields=["active"])
        return Response(self.get_serializer(school).data)


class SchoolLocationViewSet(SchoolScopedModelViewSet):
    queryset = SchoolLocation.objects.all()
    serializer_class = SchoolLocationSerializer


class SchoolRoomViewSet(SchoolScopedModelViewSet):
    queryset = SchoolRoom.objects.select_related("location").all()
    serializer_class = SchoolRoomSerializer
    school_field = "location__school"


class SchoolClosureViewSet(SchoolScopedModelViewSet):
    queryset = SchoolClosure.objects.all()
    serializer_class = SchoolClosureSerializer


class SchoolDocumentTypeViewSet(SchoolScopedModelViewSet):
    queryset = SchoolDocumentType.objects.all().order_by("sort_order")
    serializer_class = SchoolDocumentTypeSerializer
