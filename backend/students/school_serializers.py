from rest_framework import serializers

from .models import ManualCreditGrant, Student, StudentDocument


class SchoolStudentListSerializer(serializers.Serializer):
    """One row on the school's student list: profile + this school's wallet summary."""

    id = serializers.UUIDField()
    name = serializers.CharField()
    email = serializers.CharField()
    phone = serializers.CharField()
    credits_remaining = serializers.IntegerField()
    active_packages = serializers.IntegerField()
    active_subscriptions = serializers.IntegerField()
    documents_expired = serializers.IntegerField()
    documents_expiring = serializers.IntegerField()
    enrolled_at = serializers.DateTimeField(allow_null=True)


class CreditGrantSerializer(serializers.ModelSerializer):
    class Meta:
        model = ManualCreditGrant
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}, "granted_by": {"required": False}}


class SchoolDocumentSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.name", read_only=True)

    class Meta:
        model = StudentDocument
        fields = "__all__"
