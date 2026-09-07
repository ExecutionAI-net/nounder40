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

    def validate_base_fee(self, value):
        # QA R2-M9: `-5` was accepted (the UI blocks it, the API did not) and
        # a negative base fee turns the teacher's compensation into a debt.
        if value is None or value < 0:
            raise serializers.ValidationError("The base fee cannot be negative.")
        return value

    def validate_bonus_per_student(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("The per-student bonus cannot be negative.")
        return value

    def validate_bonus_threshold(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("The bonus threshold cannot be negative.")
        return value

    def validate(self, attrs):
        # QA R2-M9: `bonus_max_threshold < bonus_threshold` was accepted (only
        # the UI checked it), producing an empty bonus band — the plan then
        # pays no bonus at all while the summary still advertises one.
        instance = self.instance
        low = attrs.get("bonus_threshold", getattr(instance, "bonus_threshold", None))
        high = attrs.get("bonus_max_threshold", getattr(instance, "bonus_max_threshold", None))
        if low is not None and high is not None and high < low:
            raise serializers.ValidationError(
                {"bonus_max_threshold": "The maximum threshold cannot be lower than the bonus threshold."}
            )
        return attrs


class TeacherCompensationPaymentSerializer(serializers.ModelSerializer):
    teacher_name = serializers.CharField(source="teacher.name", read_only=True)

    class Meta:
        model = TeacherCompensationPayment
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}
