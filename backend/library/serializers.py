from rest_framework import serializers

from .models import TUTORIAL_LANGUAGES, LibraryContent, Tutorial


class LibraryContentSerializer(serializers.ModelSerializer):
    title = serializers.SerializerMethodField()
    lesson_types = serializers.SerializerMethodField()

    class Meta:
        model = LibraryContent
        fields = (
            "id", "school", "lesson_type", "lesson_types", "title",
            "title_it", "title_en", "title_fr", "title_es",
            "description", "file_url", "thumbnail_url", "type", "duration_seconds",
            "level", "language", "visible_to_students", "student_access", "price", "active",
            "created_at",
        )

    def get_title(self, obj):
        return obj.title_en or obj.title_it or obj.title_es or obj.title_fr or ""

    def get_lesson_types(self, obj):
        return {"name_en": obj.lesson_type.name_en} if obj.lesson_type_id else None


_URL_SCHEMES = ("http://", "https://")


class TutorialSerializer(serializers.ModelSerializer):
    """One shape for HQ (read/write) and the public list (read). `file_url`
    is the public streaming route, never the private storage key."""

    file_url = serializers.SerializerMethodField()

    class Meta:
        model = Tutorial
        fields = (
            "id", "title", "description", "type", "language", "topic",
            "video_url", "file_url", "file_name", "file_size", "thumbnail_url",
            "sort_order", "active", "created_at", "updated_at",
        )
        read_only_fields = ("id", "file_url", "file_name", "file_size", "created_at", "updated_at")

    def get_file_url(self, obj):
        return f"/api/tutorials/{obj.id}/file/" if obj.file_path else None

    def validate_title(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("title is required")
        return value

    def validate_language(self, value):
        value = (value or "").strip().lower()
        if value not in TUTORIAL_LANGUAGES:
            raise serializers.ValidationError(f"language must be one of {', '.join(TUTORIAL_LANGUAGES)}")
        return value

    def validate_topic(self, value):
        # One label, one spelling: trailing spaces and double spaces would
        # otherwise split "Bookings" and "Bookings " into two groups.
        return " ".join((value or "").split())

    def _validate_url(self, value):
        value = (value or "").strip()
        if value and not value.lower().startswith(_URL_SCHEMES):
            raise serializers.ValidationError("must be an http(s) URL")
        return value

    def validate_video_url(self, value):
        return self._validate_url(value)

    def validate_thumbnail_url(self, value):
        return self._validate_url(value)

    def validate(self, attrs):
        content_type = attrs.get("type", getattr(self.instance, "type", None))
        video_url = attrs.get("video_url", getattr(self.instance, "video_url", ""))
        if content_type == Tutorial.Type.VIDEO and not video_url:
            raise serializers.ValidationError({"video_url": "video_url is required for a video tutorial"})
        return attrs
