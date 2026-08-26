from rest_framework import serializers

from .models import CompensationPlan, CompensationPlanRate, Teacher, TeacherCompensationPayment


class TeacherSerializer(serializers.ModelSerializer):
    class Meta:
        model = Teacher
        fields = ("id", "name", "first_name", "last_name", "email", "phone", "address", "bio", "photo_url", "active")
        read_only_fields = ("id",)


class CompensationPlanRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompensationPlanRate
        fields = "__all__"


class CompensationPlanSerializer(serializers.ModelSerializer):
    rates = CompensationPlanRateSerializer(many=True, read_only=True)

    class Meta:
        model = CompensationPlan
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class TeacherCompensationPaymentSerializer(serializers.ModelSerializer):
    teacher_name = serializers.CharField(source="teacher.name", read_only=True)

    class Meta:
        model = TeacherCompensationPayment
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}
