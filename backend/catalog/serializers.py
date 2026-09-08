from decimal import Decimal

from django.core.exceptions import ValidationError
from rest_framework import serializers

from .models import AttendanceStatus, Course, Lesson, LessonType, Package, SubscriptionCatalog
from .services import lessons_for


class LessonTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LessonType
        fields = "__all__"


class CourseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Course
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class PackageLessonMathMixin:
    """Crediti tradotti in lezioni — la lettura che serve sia all'allieva in
    vetrina sia alla scuola in pannello, ed e' importante che sia LA STESSA:
    la scuola deve vedere il numero che vedra' chi compra.

    Null quando i tipi coperti costano crediti diversi (un "numero di lezioni"
    non esiste) o per i pacchetti HQ, che non appartengono a una scuola e
    quindi non hanno corsi da cui dedurre il costo. Serve `course_costs` nel
    context: lo prepara la vista con una query sola (catalog/services.py)."""

    def _lesson_cost(self, obj):
        from .services import package_lesson_cost

        return package_lesson_cost(obj, self.context.get("course_costs") or {})

    def get_lesson_credit_cost(self, obj) -> str | None:
        cost = self._lesson_cost(obj)
        return str(cost) if cost is not None else None

    def get_lessons_included(self, obj) -> int | None:
        """Quante lezioni ci fa davvero. Un pacchetto illimitato non ha un
        numero (il limite e' la scadenza + il tetto settimanale)."""
        cost = self._lesson_cost(obj)
        if cost is None or obj.is_unlimited:
            return None
        # 0 → None: un pacchetto che non paga nemmeno una lezione si
        # descrive meglio in crediti (la card ripiega da sola).
        return lessons_for(obj.credits, cost) or None

    def get_price_per_lesson(self, obj) -> str | None:
        """Il numero con cui confronta: quanto le costa UNA lezione."""
        lessons = self.get_lessons_included(obj)
        if not lessons:
            return None
        return str((Decimal(obj.price) / lessons).quantize(Decimal("0.01")))


class PackageSerializer(PackageLessonMathMixin, serializers.ModelSerializer):
    # Never-purchased packages can be deleted outright; purchased ones can
    # only be deactivated (student history keeps pointing at them).
    has_purchases = serializers.SerializerMethodField()

    # Dichiarati qui e non nel mixin: DRF raccoglie i campi solo dalle basi
    # che sono gia' serializer, quindi su un mixin semplice resterebbero
    # invisibili. La logica pero' e' una sola (PackageLessonMathMixin).
    lesson_credit_cost = serializers.SerializerMethodField()
    lessons_included = serializers.SerializerMethodField()
    price_per_lesson = serializers.SerializerMethodField()


    class Meta:
        model = Package
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}

    def get_has_purchases(self, obj):
        return obj.purchases.exists()

    def validate_credits(self, value):
        # A package that grants zero or negative credits is meaningless (or
        # actively wrong — it would let a "purchase" drain a student's
        # balance). Half-credit steps are a domain rule, not enforced here;
        # this only guards the sign.
        if value is None or value <= 0:
            raise serializers.ValidationError("Credits must be greater than zero.")
        return value

    def validate_price(self, value):
        # Free packages (price 0) are a legitimate promo case; negative
        # prices are not — they'd mean paying the student to "buy" credits.
        if value is None or value < 0:
            raise serializers.ValidationError("Price cannot be negative.")
        return value

    def validate_validity_days(self, value):
        # QA R2-M9: `0` was accepted and the storefront then advertised
        # "Valid for 0 days" — a package that expires the instant it is
        # bought. The column holds N units of `validity_unit` (days OR
        # months), so the only sane floor is 1 either way.
        if value is None or value < 1:
            raise serializers.ValidationError("Validity must be at least 1.")
        return value

    def validate_weekly_booking_cap(self, value):
        # QA R2-M9: `-1` was accepted and rendered verbatim ("up to -1 per
        # week"). null = no cap; anything set must allow at least one booking.
        if value is not None and value < 1:
            raise serializers.ValidationError("The weekly booking cap must be at least 1.")
        return value

    def validate_allowed_lesson_types(self, value):
        # QA R2-M9: this is a plain JSON list of ids, so nothing checked that
        # the ids exist — a package could be scoped to a lesson type that had
        # never existed, making it silently unusable (no course matches) while
        # looking correctly configured. LessonType is the HQ-wide Metodo
        # catalog (not school-scoped), so existence is the whole check.
        from .models import LessonType

        if value in (None, ""):
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError("Expected a list of lesson-type ids.")
        ids = [str(v) for v in value]
        try:
            known = set(
                str(pk) for pk in LessonType.objects.filter(id__in=ids).values_list("id", flat=True)
            )
        except (ValueError, ValidationError):
            raise serializers.ValidationError("Unknown lesson type.")
        missing = [i for i in ids if i not in known]
        if missing:
            raise serializers.ValidationError(f"Unknown lesson type(s): {', '.join(sorted(missing))}.")
        return ids

    def validate(self, attrs):
        # Un pacchetto deve dichiarare cosa copre. "Vuoto = tutti i tipi" era
        # comodo ma rendeva impossibile dire quanto costa una lezione dentro il
        # pacchetto (corsi da 1 e da 20 crediti nello stesso calcolo), e ora
        # quel numero lo leggono le allieve nella modale di prenotazione.
        # Si controlla solo quando il campo viene scritto: un PATCH parziale
        # che non lo tocca (es. auto-traduzione) resta valido.
        if self.instance is None or "allowed_lesson_types" in attrs:
            # QA H-6: the previous guard here was `was_already_empty` (was
            # THIS row already [] before the edit?), which only ever fixed
            # in-place edits -- self.instance is None on every CREATE
            # (including a Duplicate, which the frontend implements as a
            # POST), so was_already_empty was always False there and it
            # became impossible to ever create a new all-types package or
            # duplicate an existing one; every attempt 400'd.
            #
            # Fix: when the request itself says `lesson_type_restriction`
            # ("all" or anything else), that explicit signal decides. It's
            # the only reliable signal on a CREATE -- there's no prior row
            # to fall back on, so PackagesManager.tsx now sends this legacy
            # field explicitly on every save ("all" / "custom", mirroring
            # its "All lesson types" toggle) precisely so New Package and
            # Duplicate both carry it.
            #
            # On an EDIT that doesn't send the field, `was_already_empty`
            # is kept as the fallback rather than the instance's *current*
            # lesson_type_restriction: that column is legacy and normally
            # stuck at its "all" default regardless of a package's real,
            # allowed_lesson_types-based scope, so trusting it here would
            # let ANY previously-scoped package be widened back to empty
            # silently just because nobody ever bothered updating it.
            if "lesson_type_restriction" in attrs:
                is_all_types = attrs["lesson_type_restriction"] == "all"
            elif self.instance is not None:
                is_all_types = not self.instance.allowed_lesson_types
            else:
                # Bare CREATE, field omitted, no prior row to consult: fail
                # closed and still require an explicit type (or an explicit
                # "all") -- this is the exact case the pre-existing
                # "creating a brand new package still requires a lesson
                # type" regression test pins.
                is_all_types = False
            if not attrs.get("allowed_lesson_types") and not is_all_types:
                raise serializers.ValidationError(
                    {"allowed_lesson_types": "Pick at least one lesson type."}
                )

        current = {} if self.instance is None else {
            "is_drop_in": self.instance.is_drop_in,
            "is_recurring": self.instance.is_recurring,
            "is_unlimited": self.instance.is_unlimited,
            "weekly_booking_cap": self.instance.weekly_booking_cap,
        }
        merged = {**current, **attrs}
        if not merged.get("is_drop_in"):
            return attrs

        # Un drop-in ricorrente e' una contraddizione: il prezzo della lezione
        # singola si paga una volta, non si abbona. Errore esplicito.
        if merged.get("is_recurring"):
            raise serializers.ValidationError(
                {"is_drop_in": "A drop-in package cannot be recurring."}
            )

        # "Illimitato" e il tetto settimanale non sono contraddittori, sono
        # solo privi di senso su un pacchetto che compra UNA lezione: la UI li
        # nasconde, qui si azzerano perche' un client vecchio (o una chiamata
        # diretta) non lasci addosso valori che nessuno potra' piu' vedere.
        if merged.get("is_unlimited"):
            attrs["is_unlimited"] = False
        if merged.get("weekly_booking_cap") is not None:
            attrs["weekly_booking_cap"] = None
        return attrs


class PublicPackageSerializer(PackageLessonMathMixin, serializers.ModelSerializer):
    """Student-facing catalog shape for the /student/buy page — adds a
    nested `schools` object (name/city) for the anonymous cross-network
    browsing view, alongside the raw `school` FK."""

    schools = serializers.SerializerMethodField()

    # Dichiarati qui e non nel mixin: DRF raccoglie i campi solo dalle basi
    # che sono gia' serializer, quindi su un mixin semplice resterebbero
    # invisibili. La logica pero' e' una sola (PackageLessonMathMixin).
    lesson_credit_cost = serializers.SerializerMethodField()
    lessons_included = serializers.SerializerMethodField()
    price_per_lesson = serializers.SerializerMethodField()

    class Meta:
        model = Package
        fields = (
            "id", "name_it", "name_en", "name_fr", "name_es",
            "description_it", "description_en", "description_fr", "description_es",
            "credits", "validity_days", "validity_unit", "price",
            "color", "language", "image_url", "is_popular", "is_vip",
            "is_recurring", "recurring_interval", "credits_rollover", "is_drop_in", "school", "schools",
            "allowed_lesson_types", "mode_filter", "is_unlimited", "weekly_booking_cap",
            "lesson_credit_cost", "lessons_included", "price_per_lesson",
        )

    def get_schools(self, obj):
        # Un pacchetto HQ non ha scuola: prima esplodeva su obj.school.name.
        # Stessa cautela che LessonBookingSerializer usa poche righe piu' giu'.
        if not obj.school_id:
            return None
        return {"id": str(obj.school_id), "name": obj.school.name, "city": obj.school.city}



class SubscriptionCatalogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubscriptionCatalog
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class AttendanceStatusSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttendanceStatus
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}

    def create(self, validated_data):
        instance = super().create(validated_data)
        self._unset_other_defaults(instance)
        return instance

    def update(self, instance, validated_data):
        instance = super().update(instance, validated_data)
        self._unset_other_defaults(instance)
        return instance

    def _unset_other_defaults(self, instance):
        # SCH-R2-23: only one attendance status per school can be "the"
        # default — which one is undefined once two rows both carry
        # is_default=True. Saving a new default silently unsets any
        # previous one for the same school, so the invariant always holds.
        if instance.is_default:
            AttendanceStatus.objects.filter(
                school=instance.school, is_default=True
            ).exclude(pk=instance.pk).update(is_default=False)


class LessonSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lesson
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class LessonBrowseSerializer(serializers.ModelSerializer):
    """Student-facing read shape for the booking browse page."""

    school_name = serializers.CharField(source="school.name", read_only=True)
    city = serializers.CharField(source="school.city", read_only=True)
    teacher_name = serializers.SerializerMethodField()
    lesson_type_name = serializers.SerializerMethodField()
    room_name = serializers.CharField(source="room.name", read_only=True, default="")
    location_name = serializers.CharField(source="room.location.name", read_only=True, default="")
    spots_available = serializers.SerializerMethodField()

    class Meta:
        model = Lesson
        fields = (
            "id", "school", "school_name", "city", "teacher", "teacher_name",
            "lesson_type", "lesson_type_name", "room", "room_name", "location_name",
            "date", "start_time", "end_time", "max_capacity", "current_bookings",
            "spots_available", "status", "color", "is_online", "online_link",
        )

    def get_teacher_name(self, obj):
        return obj.teacher.name if obj.teacher_id else ""

    def get_lesson_type_name(self, obj):
        lt = obj.lesson_type
        if not lt:
            return ""
        return lt.name_en or lt.name_it or lt.code

    def get_spots_available(self, obj):
        return max(0, (obj.max_capacity or 0) - (obj.current_bookings or 0))


class _BookingCourseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Course
        fields = (
            "name", "color", "credit_cost", "min_booking_notice_hours", "language",
            "notes", "is_online", "image_url",
        )


class _BookingLessonTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LessonType
        fields = (
            "id", "code", "level", "name_en", "name_it", "name_fr", "name_es",
            "description_it", "description_en", "description_fr", "description_es",
            "image_url", "image_url_it", "image_url_en", "image_url_fr", "image_url_es",
            "video_url_it", "video_url_en", "video_url_fr", "video_url_es",
        )


class _BookingTeacherSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    photo_url = serializers.CharField()


class _BookingLocationSerializer(serializers.Serializer):
    name = serializers.CharField()
    address = serializers.CharField()
    google_maps_url = serializers.CharField()


class _BookingRoomSerializer(serializers.Serializer):
    name = serializers.CharField()
    school_locations = serializers.SerializerMethodField()

    def get_school_locations(self, obj):
        if not obj.location_id:
            return None
        return _BookingLocationSerializer(obj.location).data


class _BookingSchoolSerializer(serializers.Serializer):
    name = serializers.CharField()
    city = serializers.CharField()
    cancellation_policy_hours = serializers.IntegerField()
    # QA R2-H14: the frontend's cancellation/min-notice countdown (hoursUntil
    # in student/book and student/bookings) used the BROWSER's local zone
    # while the server compared in the school's own zone — exposing it here
    # lets both sides agree instead of guessing from wherever the student
    # happens to be sitting.
    timezone = serializers.CharField()


class LessonBookingSerializer(serializers.ModelSerializer):
    """Full nested shape for the student booking/browse page — mirrors the old
    Supabase relational-embed select (courses/lesson_types/teachers/
    school_rooms/schools as nested objects, table-name-plural keys) so the
    rich booking UI (video preview, map link, language badge, credit cost...)
    keeps working unchanged."""

    courses = serializers.SerializerMethodField()
    lesson_types = serializers.SerializerMethodField()
    teachers = serializers.SerializerMethodField()
    school_rooms = serializers.SerializerMethodField()
    schools = serializers.SerializerMethodField()

    class Meta:
        model = Lesson
        fields = (
            "id", "date", "start_time", "end_time", "max_capacity", "current_bookings",
            "school", "lesson_type", "teacher", "notes", "is_online", "online_link",
            "language",  # per-lesson override; frontend falls back to courses.language
            "courses", "lesson_types", "teachers", "school_rooms", "schools",
        )

    def get_courses(self, obj):
        return _BookingCourseSerializer(obj.course).data if obj.course_id else None

    def get_lesson_types(self, obj):
        return _BookingLessonTypeSerializer(obj.lesson_type).data if obj.lesson_type_id else None

    def get_teachers(self, obj):
        return _BookingTeacherSerializer(obj.teacher).data if obj.teacher_id else None

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Impostazione scuola "Mostra insegnanti alle allieve" spenta →
        # l'insegnante non esce proprio dal feed pubblico (nome e id)
        if instance.school_id and not instance.school.show_teacher_to_students:
            data["teacher"] = None
            data["teachers"] = None
        return data

    def get_school_rooms(self, obj):
        return _BookingRoomSerializer(obj.room).data if obj.room_id else None

    def get_schools(self, obj):
        return _BookingSchoolSerializer(obj.school).data if obj.school_id else None


class PublicUpcomingLessonSerializer(serializers.ModelSerializer):
    """Landing-page board ("Today & Tomorrow at the Barre"). Public, so it
    exposes only what a passer-by may see: what the class is, where and when,
    and whether there is still room. No teacher identity, no booking counts —
    just the derived spots_available."""

    lesson_type_name = serializers.SerializerMethodField()
    level = serializers.SerializerMethodField()
    school_name = serializers.CharField(source="school.name", read_only=True)
    school_slug = serializers.CharField(source="school.slug", read_only=True)
    city = serializers.CharField(source="school.city", read_only=True)
    spots_available = serializers.SerializerMethodField()
    is_full = serializers.SerializerMethodField()

    class Meta:
        model = Lesson
        fields = (
            "id", "date", "start_time", "end_time", "is_online",
            "lesson_type_name", "level", "school_name", "school_slug", "city",
            "spots_available", "is_full",
        )

    def get_lesson_type_name(self, obj):
        lt = obj.lesson_type
        if not lt:
            return ""
        # The landing page is served in five locales; fall back the same way
        # the rest of the catalog does rather than showing an empty label.
        locale = (self.context.get("locale") or "en").lower()
        return (
            getattr(lt, f"name_{locale}", "") or lt.name_en or lt.name_it or lt.code
        )

    def get_level(self, obj):
        return obj.lesson_type.level if obj.lesson_type_id else ""

    def get_spots_available(self, obj):
        return max(0, (obj.max_capacity or 0) - (obj.current_bookings or 0))

    def get_is_full(self, obj):
        return self.get_spots_available(obj) <= 0
