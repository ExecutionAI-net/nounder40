from rest_framework import serializers

from .models import LibraryContent


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
        )

    def get_title(self, obj):
        return obj.title_en or obj.title_it or obj.title_es or obj.title_fr or ""

    def get_lesson_types(self, obj):
        return {"name_en": obj.lesson_type.name_en} if obj.lesson_type_id else None
