from rest_framework import serializers

from .models import Student, StudentDocument, StudentPackage, StudentSubscription


class StudentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Student
        fields = (
            "id", "name", "email", "phone", "date_of_birth", "address",
            "city", "country", "language_preference", "badge", "school",
        )
        read_only_fields = ("id",)


class StudentPackageSerializer(serializers.ModelSerializer):
    package_name = serializers.SerializerMethodField()
    package_color = serializers.SerializerMethodField()
    package_is_recurring = serializers.SerializerMethodField()
    package_recurring_interval = serializers.SerializerMethodField()
    school_name = serializers.CharField(source="school.name", read_only=True)

    class Meta:
        model = StudentPackage
        fields = "__all__"

    def get_package_name(self, obj):
        if not obj.package_id:
            return ""
        return obj.package.name_en or obj.package.name_it or ""

    def get_package_color(self, obj):
        return obj.package.color if obj.package_id else "#6B1F3A"

    def get_package_is_recurring(self, obj):
        return bool(obj.package_id and obj.package.is_recurring)

    def get_package_recurring_interval(self, obj):
        return obj.package.recurring_interval if obj.package_id else None


class StudentSubscriptionSerializer(serializers.ModelSerializer):
    subscription_name = serializers.SerializerMethodField()
    school_name = serializers.CharField(source="school.name", read_only=True)

    class Meta:
        model = StudentSubscription
        fields = "__all__"

    def get_subscription_name(self, obj):
        cat = obj.subscription_catalog
        if not cat:
            return ""
        return cat.name_en or cat.name_it or ""


class StudentDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentDocument
        fields = "__all__"
        read_only_fields = ("id", "status", "validated_by", "validated_at")
