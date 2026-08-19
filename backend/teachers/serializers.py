from rest_framework import serializers

from .models import Teacher


class TeacherSerializer(serializers.ModelSerializer):
    class Meta:
        model = Teacher
        fields = ("id", "name", "email", "phone", "address", "bio", "photo_url", "active")
        read_only_fields = ("id", "email")
