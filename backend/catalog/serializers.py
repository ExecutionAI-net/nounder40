from rest_framework import serializers

from .models import AttendanceStatus, Course, Lesson, LessonType, Package, SubscriptionCatalog


class LessonTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LessonType
        fields = "__all__"


class CourseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Course
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class PackageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Package
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class SubscriptionCatalogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubscriptionCatalog
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class AttendanceStatusSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttendanceStatus
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class LessonSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lesson
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class LessonBrowseSerializer(serializers.ModelSerializer):
    """Student-facing read shape for the booking browse page."""

    school_name = serializers.CharField(source="school.name", read_only=True)
    city = serializers.CharField(source="school.city", read_only=True)
    teacher_name = serializers.SerializerMethodField()
    lesson_type_name = serializers.SerializerMethodField()
    room_name = serializers.CharField(source="room.name", read_only=True, default="")
    spots_available = serializers.SerializerMethodField()

    class Meta:
        model = Lesson
        fields = (
            "id", "school", "school_name", "city", "teacher", "teacher_name",
            "lesson_type", "lesson_type_name", "room", "room_name",
            "date", "start_time", "end_time", "max_capacity", "current_bookings",
            "spots_available", "status", "color", "is_online", "online_link",
        )

    def get_teacher_name(self, obj):
        return obj.teacher.name if obj.teacher_id else ""

    def get_lesson_type_name(self, obj):
        lt = obj.lesson_type
        if not lt:
            return ""
        return lt.name_en or lt.name_it or lt.code

    def get_spots_available(self, obj):
        return max(0, (obj.max_capacity or 0) - (obj.current_bookings or 0))
