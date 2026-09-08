from rest_framework import serializers

from .models import CompensationPlan, CompensationPlanRate, Teacher, TeacherCompensationPayment


class TeacherSerializer(serializers.ModelSerializer):
    # QA TCH-R2-11: `first_name`/`last_name` are `blank=True` on the model
    # (ETL/admin need to be able to leave them empty on creation), and
    # ModelSerializer mirrors that as `allow_blank=True` by default — so
    # `PATCH /teacher/profile/ {"first_name": ""}` silently accepted an empty
    # name and re-derived `Teacher.name` from last_name alone. A teacher
    # editing their OWN profile should never be able to blank these out
    # (the frontend already marks the input `required`); override the
    # storage-level contract with the API's own non-blank one. DRF's
    # CharField trims whitespace before the blank check, so "   " is
    # rejected the same as "".
    first_name = serializers.CharField(max_length=120)
    last_name = serializers.CharField(max_length=120)
    # `bio` is a plain TextField with no model-level max_length. It's
    # rendered as plain text in the teacher panel (no HTML/script execution),
    # so raw HTML input isn't an XSS vector today, but the API had no bound
    # at all. Cap it at a sane length rather than leaving it open-ended.
    bio = serializers.CharField(max_length=5000, required=False, allow_blank=True)

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
