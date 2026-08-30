from rest_framework import serializers

from catalog.services import lessons_for

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
    # Eligibility rules, so the booking page can tell *before* the POST whether
    # a package covers a lesson (mirror of bookings.services._active_package).
    package_allowed_lesson_types = serializers.SerializerMethodField()
    package_lesson_type_restriction = serializers.SerializerMethodField()
    package_mode_filter = serializers.SerializerMethodField()
    school_name = serializers.CharField(source="school.name", read_only=True)
    school_city = serializers.CharField(source="school.city", read_only=True)
    # Crediti tradotti in lezioni, come in vetrina e nel pannello scuola.
    lesson_credit_cost = serializers.SerializerMethodField()
    lessons_remaining = serializers.SerializerMethodField()
    lessons_total = serializers.SerializerMethodField()

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

    def get_package_allowed_lesson_types(self, obj):
        return [str(t) for t in (obj.package.allowed_lesson_types or [])] if obj.package_id else []

    def get_package_lesson_type_restriction(self, obj):
        return obj.package.lesson_type_restriction if obj.package_id else "all"

    def get_package_mode_filter(self, obj):
        return obj.package.mode_filter if obj.package_id else "all"

    def get_package_is_recurring(self, obj):
        return bool(obj.package_id and obj.package.is_recurring)

    def get_package_is_unlimited(self, obj):
        return bool(obj.package_id and obj.package.is_unlimited)

    def get_package_recurring_interval(self, obj):
        return obj.package.recurring_interval if obj.package_id else None

    def _lesson_cost(self, obj):
        from catalog.services import package_lesson_cost

        if not obj.package_id:
            return None
        return package_lesson_cost(obj.package, self.context.get("course_costs") or {})

    def get_lesson_credit_cost(self, obj) -> str | None:
        cost = self._lesson_cost(obj)
        return str(cost) if cost is not None else None

    def get_lessons_remaining(self, obj) -> int | None:
        """Quante lezioni ci fa ANCORA con questo pacchetto.

        Non si converte il totale del portafoglio: si converte pacchetto per
        pacchetto e poi si somma. Un credito non si spalma su due pacchetti —
        la prenotazione scala da uno solo (bookings/services._active_package) —
        quindi la somma delle lezioni e' esatta anche quando i pacchetti hanno
        costi-lezione diversi, mentre convertire i crediti totali no."""
        return self._lessons(obj, obj.credits_remaining)

    def get_lessons_total(self, obj) -> int | None:
        return self._lessons(obj, obj.credits_total)

    def _lessons(self, obj, credits):
        cost = self._lesson_cost(obj)
        if cost is None or (obj.package_id and obj.package.is_unlimited):
            return None
        # Lo zero si tiene: "0 lezioni rimaste" su un pacchetto esaurito e'
        # l'informazione giusta, None vorrebbe dire "non convertibile".
        return lessons_for(credits, cost)


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
