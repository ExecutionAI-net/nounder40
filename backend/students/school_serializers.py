from rest_framework import serializers

from .models import ManualCreditGrant, Student, StudentDocument


class CreditGrantSerializer(serializers.ModelSerializer):
    student = serializers.SerializerMethodField()
    granter = serializers.SerializerMethodField()

    class Meta:
        model = ManualCreditGrant
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}, "granted_by": {"required": False}}

    def get_student(self, obj):
        if not obj.student_id:
            return None
        return {"name": obj.student.name, "email": obj.student.email}

    def get_granter(self, obj):
        if not obj.granted_by_id:
            return None
        user = obj.granted_by
        return {"name": user.full_name or user.email, "email": user.email}


class SchoolDocumentSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.name", read_only=True)

    class Meta:
        model = StudentDocument
        fields = "__all__"
