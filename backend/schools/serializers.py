from django.utils.text import slugify
from rest_framework import serializers

from core.validators import validate_safe_url
from core.viewsets import is_hq

from .models import (
    School,
    SchoolClosure,
    SchoolDocumentType,
    SchoolLocation,
    SchoolMembership,
    SchoolRole,
    SchoolRoom,
)

# I cinque locale del prodotto (frontend/src/i18n/routing.ts). Tenuti qui
# perche' `School.language` decide la lingua delle e-mail transazionali: un
# valore fuori lista non ha template e ripiega su "en" senza dirlo a nessuno.
SUPPORTED_LOCALES = ("en", "it", "es", "fr", "de")



class SchoolSerializer(serializers.ModelSerializer):
    class Meta:
        model = School
        fields = "__all__"
        extra_kwargs = {"slug": {"required": False}}

    def validate_platform_fee_percentage(self, value):
        if value is None or value < 0 or value > 100:
            raise serializers.ValidationError("Must be between 0 and 100.")
        return value

    def validate_shop_commission_percentage(self, value):
        if value is None or value < 0 or value > 100:
            raise serializers.ValidationError("Must be between 0 and 100.")
        return value

    def validate_timezone(self, value):
        """X-R3-05: `School.timezone` arrived with PR #88 (the R2-H14 fix) and
        nothing ever checked it. `PATCH /school/profile/ {"timezone":
        "Mars/Olympus"}` answered 200 and stored it, and both readers fall
        back to UTC on an unknown zone -- `bookings/services.py`
        (`except ZoneInfoNotFoundError: tz = ZoneInfo("UTC")`) and
        `frontend/src/lib/school-time.ts`. The fallback is what makes it
        invisible: no error anywhere, just every cancellation and min-notice
        decision for that school silently computed an offset away from its
        real wall clock. That is exactly the R2-H14 bug PR #88 fixed, now
        re-openable by a typo in Settings.

        `available_timezones()` is the same tzdata the readers use, so a value
        that passes here cannot fall back later."""
        from zoneinfo import available_timezones

        value = (value or "").strip()
        if not value:
            # Blank is not a zone; the model default exists for a reason.
            raise serializers.ValidationError("A timezone is required.")
        if value not in available_timezones():
            raise serializers.ValidationError(
                f"Unknown timezone '{value}'. Use an IANA name such as Europe/Rome."
            )
        return value

    def validate_cancellation_policy_hours(self, value):
        # QA R2-M9: a negative threshold was accepted and inverted the refund
        # rule (`hours_until_lesson > threshold` is true for every past-due
        # cancellation), so late cancellations started being refunded. 0 is a
        # legitimate "always refund" policy; below that is nonsense.
        if value is None or value < 0:
            raise serializers.ValidationError("Cancellation policy hours cannot be negative.")
        return value

    def validate_min_booking_notice_hours(self, value):
        if value is None or value < 0:
            raise serializers.ValidationError("Minimum booking notice cannot be negative.")
        return value

    def validate_website(self, value):
        # SCH-R3-11: `javascript:alert(1)` was stored and republished verbatim
        # by the anonymous /api/schools/public/. Latent only because nothing
        # renders it as a link today — and "nothing renders it yet" is not a
        # security boundary. The UI's own normalizeWebsite() never let this
        # shape through, so the API is where it has to be refused.
        return validate_safe_url(value)

    def validate_language(self, value):
        # QA R2-M9: "xx" was accepted. This field picks the e-mail locale for
        # every school-side notification, so an unsupported value silently
        # degrades to the English fallback.
        if value not in SUPPORTED_LOCALES:
            raise serializers.ValidationError(
                f"Unsupported language. Choose one of: {', '.join(SUPPORTED_LOCALES)}."
            )
        return value

    def create(self, validated_data):
        if not validated_data.get("slug"):
            base = slugify(validated_data.get("name", "")) or "school"
            slug, i = base, 1
            while School.objects.filter(slug=slug).exists():
                i += 1
                slug = f"{base}-{i}"
            validated_data["slug"] = slug
        return super().create(validated_data)


class PublicSchoolSerializer(serializers.ModelSerializer):
    """Minimal public shape for the booking/browse pages."""

    # `country` e' testo libero e in giro c'e' di tutto: "Italy", "Spain",
    # "IT". Il client non deve indovinare — riceve il codice ISO e ci scrive
    # sopra il nome nella lingua di chi guarda (stessa risoluzione usata per
    # l'account Stripe della scuola, geography/services.py).
    country_code = serializers.SerializerMethodField()

    class Meta:
        model = School
        fields = (
            "id", "name", "slug", "city", "province", "country", "country_code",
            "logo_url", "website",
        )

    def get_country_code(self, obj) -> str | None:
        from geography.services import country_code_for

        return country_code_for(obj.country)


class SchoolRoomSerializer(serializers.ModelSerializer):
    class Meta:
        model = SchoolRoom
        fields = "__all__"

    def validate_capacity(self, value):
        if value is None or value < 1:
            raise serializers.ValidationError("Capacity must be at least 1.")
        return value

    def validate_cost(self, value):
        # QA R2-M9: `-10` was accepted. Room cost feeds the school's cost
        # reporting; a negative rent would show up as revenue.
        if value is None or value < 0:
            raise serializers.ValidationError("Cost cannot be negative.")
        return value

    def validate_location(self, value):
        # X-R2-02 / R2-H3: `location` is an unscoped PrimaryKeyRelatedField,
        # and SchoolScopedModelViewSet.create() cannot inject `school` here
        # (school_field="location__school" is reached via a relation, not a
        # direct FK) so nothing else checked that the location actually
        # belongs to the caller's own school. Without this, any school admin
        # who knew/guessed another school's location id could plant a room
        # inside that victim school's room pool. HQ (already gated to
        # godmode-only for /api/school/* by the section guard) may still
        # attach a room to any school's location.
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is not None and not is_hq(user) and value.school_id != user.active_school_id:
            raise serializers.ValidationError("Location does not belong to your school.")
        return value


class SchoolLocationSerializer(serializers.ModelSerializer):
    rooms = SchoolRoomSerializer(many=True, read_only=True)

    class Meta:
        model = SchoolLocation
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}

    def validate_google_maps_url(self, value):
        # The same missing check as School.website (SCH-R3-11), except this
        # one is not latent: any school member can write it and the student
        # booking and bookings pages render it as a bare
        # `<a href={loc.google_maps_url}>`, so a javascript: value would run
        # in the student's own origin on click.
        return validate_safe_url(value)


class SchoolClosureSerializer(serializers.ModelSerializer):
    class Meta:
        model = SchoolClosure
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}

    def validate(self, attrs):
        # QA R2-M9: due buchi qui.
        #  - un intervallo con `end_date` prima di `date` non chiude niente
        #    (ogni confronto date <= d <= end_date e' falso), quindi la
        #    scuola crede di aver chiuso e le lezioni continuano a generarsi;
        #  - una chiusura "parziale" senza `from_time` non ha l'ora da cui
        #    vale, e viene trattata come una chiusura di mezza giornata senza
        #    inizio definito.
        # Partial: si controlla su un PATCH solo se il tipo o l'ora vengono
        # scritti, cosi' un aggiornamento parziale (es. solo le note) resta
        # valido.
        instance = self.instance
        start = attrs.get("date", getattr(instance, "date", None))
        end = attrs.get("end_date", getattr(instance, "end_date", None))
        if start is not None and end is not None and end < start:
            raise serializers.ValidationError({"end_date": "The end date cannot be before the start date."})

        kind = attrs.get("type", getattr(instance, "type", SchoolClosure.Kind.FULL_DAY))
        from_time = attrs.get("from_time", getattr(instance, "from_time", None))
        if kind == SchoolClosure.Kind.PARTIAL and from_time is None:
            raise serializers.ValidationError({"from_time": "A partial closure requires a start time."})
        return attrs


class SchoolDocumentTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = SchoolDocumentType
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class SchoolRoleSerializer(serializers.ModelSerializer):
    memberCount = serializers.SerializerMethodField()

    class Meta:
        model = SchoolRole
        fields = ("key", "label", "builtin", "permissions", "created_at", "memberCount")

    def get_memberCount(self, obj):
        return SchoolMembership.objects.filter(sub_role=obj.key).count()
