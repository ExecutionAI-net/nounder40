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
