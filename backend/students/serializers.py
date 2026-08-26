from rest_framework import serializers

from .models import Student, StudentDocument, StudentPackage, StudentSubscription


class StudentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Student
        fields = (
            "id", "name", "first_name", "last_name", "email", "phone", "date_of_birth", "address",
            "city", "country", "language_preference", "badge", "school",
        )
        read_only_fields = ("id",)


class StudentPackageSerializer(serializers.ModelSerializer):
    package_name = serializers.SerializerMethodField()
    package_color = serializers.SerializerMethodField()
    package_description_en = serializers.SerializerMethodField()
    package_is_recurring = serializers.SerializerMethodField()
    package_is_unlimited = serializers.SerializerMethodField()
    package_recurring_interval = serializers.SerializerMethodField()
    school_name = serializers.CharField(source="school.name", read_only=True)
    school_city = serializers.CharField(source="school.city", read_only=True)

    class Meta:
        model = StudentPackage
        fields = "__all__"

    def get_package_name(self, obj):
        if not obj.package_id:
            return ""
        # One package, four languages: show the student's own language first.
        request = self.context.get("request")
        lang = getattr(getattr(request, "user", None), "language_preference", "") or "en"
        return (
            getattr(obj.package, f"name_{lang}", "")
            or obj.package.name_en or obj.package.name_it
            or obj.package.name_fr or obj.package.name_es or ""
        )

    def get_package_color(self, obj):
        return obj.package.color if obj.package_id else "#6B1F3A"

    def get_package_description_en(self, obj):
        return obj.package.description_en if obj.package_id else None

    def get_package_is_recurring(self, obj):
        return bool(obj.package_id and obj.package.is_recurring)

    def get_package_is_unlimited(self, obj):
        return bool(obj.package_id and obj.package.is_unlimited)

    def get_package_recurring_interval(self, obj):
        return obj.package.recurring_interval if obj.package_id else None


class StudentSubscriptionSerializer(serializers.ModelSerializer):
    subscription_name = serializers.SerializerMethodField()
    subscription_color = serializers.SerializerMethodField()
    subscription_period_value = serializers.SerializerMethodField()
    subscription_period_unit = serializers.SerializerMethodField()
    subscription_is_vip = serializers.SerializerMethodField()
    school_name = serializers.CharField(source="school.name", read_only=True)
    school_city = serializers.CharField(source="school.city", read_only=True)

    class Meta:
        model = StudentSubscription
        fields = "__all__"

    def get_subscription_name(self, obj):
        cat = obj.subscription_catalog
        if not cat:
            return ""
        return cat.name_en or cat.name_it or ""

    def get_subscription_color(self, obj):
        return obj.subscription_catalog.color if obj.subscription_catalog_id else "#1F3A6B"

    def get_subscription_period_value(self, obj):
        return obj.subscription_catalog.period_value if obj.subscription_catalog_id else None

    def get_subscription_period_unit(self, obj):
        return obj.subscription_catalog.period_unit if obj.subscription_catalog_id else None

    def get_subscription_is_vip(self, obj):
        return bool(obj.subscription_catalog_id and obj.subscription_catalog.is_vip)


class StudentDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentDocument
        fields = "__all__"
        read_only_fields = ("id", "status", "validated_by", "validated_at")
