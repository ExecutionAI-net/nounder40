from django.utils.text import slugify
from rest_framework import serializers

from .models import (
    School,
    SchoolClosure,
    SchoolDocumentType,
    SchoolLocation,
    SchoolMembership,
    SchoolRole,
    SchoolRoom,
)


class SchoolSerializer(serializers.ModelSerializer):
    class Meta:
        model = School
        fields = "__all__"
        extra_kwargs = {"slug": {"required": False}}

    def create(self, validated_data):
        if not validated_data.get("slug"):
            base = slugify(validated_data.get("name", "")) or "school"
            slug, i = base, 1
            while School.objects.filter(slug=slug).exists():
                i += 1
                slug = f"{base}-{i}"
            validated_data["slug"] = slug
        return super().create(validated_data)


class PublicSchoolSerializer(serializers.ModelSerializer):
    """Minimal public shape for the booking/browse pages."""

    # `country` e' testo libero e in giro c'e' di tutto: "Italy", "Spain",
    # "IT". Il client non deve indovinare — riceve il codice ISO e ci scrive
    # sopra il nome nella lingua di chi guarda (stessa risoluzione usata per
    # l'account Stripe della scuola, geography/services.py).
    country_code = serializers.SerializerMethodField()

    class Meta:
        model = School
        fields = (
            "id", "name", "slug", "city", "province", "country", "country_code",
            "logo_url", "website",
        )

    def get_country_code(self, obj) -> str | None:
        from geography.services import country_code_for

        return country_code_for(obj.country)


class SchoolRoomSerializer(serializers.ModelSerializer):
    class Meta:
        model = SchoolRoom
        fields = "__all__"


class SchoolLocationSerializer(serializers.ModelSerializer):
    rooms = SchoolRoomSerializer(many=True, read_only=True)

    class Meta:
        model = SchoolLocation
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class SchoolClosureSerializer(serializers.ModelSerializer):
    class Meta:
        model = SchoolClosure
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class SchoolDocumentTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = SchoolDocumentType
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class SchoolRoleSerializer(serializers.ModelSerializer):
    memberCount = serializers.SerializerMethodField()

    class Meta:
        model = SchoolRole
        fields = ("key", "label", "builtin", "permissions", "created_at", "memberCount")

    def get_memberCount(self, obj):
        return SchoolMembership.objects.filter(sub_role=obj.key).count()
