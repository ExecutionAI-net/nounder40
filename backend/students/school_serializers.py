from rest_framework import serializers

from .models import ManualCreditGrant, Student, StudentDocument


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
