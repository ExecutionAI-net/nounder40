from django.utils.text import slugify
from rest_framework import serializers

from .models import (
    School,
    SchoolClosure,
    SchoolDocumentType,
    SchoolLocation,
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


class SchoolLocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = SchoolLocation
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class SchoolRoomSerializer(serializers.ModelSerializer):
    class Meta:
        model = SchoolRoom
        fields = "__all__"


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
