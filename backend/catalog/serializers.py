from decimal import Decimal

from rest_framework import serializers

from .models import AttendanceStatus, Course, Lesson, LessonType, Package, SubscriptionCatalog


class LessonTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LessonType
        fields = "__all__"


class CourseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Course
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class PackageSerializer(serializers.ModelSerializer):
    # Never-purchased packages can be deleted outright; purchased ones can
    # only be deactivated (student history keeps pointing at them).
    has_purchases = serializers.SerializerMethodField()

    class Meta:
        model = Package
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}

    def get_has_purchases(self, obj):
        return obj.purchases.exists()

    def validate(self, attrs):
        # Un pacchetto deve dichiarare cosa copre. "Vuoto = tutti i tipi" era
        # comodo ma rendeva impossibile dire quanto costa una lezione dentro il
        # pacchetto (corsi da 1 e da 20 crediti nello stesso calcolo), e ora
        # quel numero lo leggono le allieve nella modale di prenotazione.
        # Si controlla solo quando il campo viene scritto: un PATCH parziale
        # che non lo tocca (es. auto-traduzione) resta valido.
        if self.instance is None or "allowed_lesson_types" in attrs:
            if not attrs.get("allowed_lesson_types"):
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


class PublicPackageSerializer(serializers.ModelSerializer):
    """Student-facing catalog shape for the /student/buy page — adds a
    nested `schools` object (name/city) for the anonymous cross-network
    browsing view, alongside the raw `school` FK."""

    schools = serializers.SerializerMethodField()
    # Crediti tradotti in lezioni: e' cosi' che ragiona chi compra. Null
    # quando i tipi coperti costano diverso — allora un "numero di lezioni"
    # non esiste e la vetrina resta sui crediti (catalog/services.py).
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
        return {"id": str(obj.school_id), "name": obj.school.name, "city": obj.school.city}

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
        return int(Decimal(obj.credits) // cost) or None

    def get_price_per_lesson(self, obj) -> str | None:
        """Il numero con cui confronta: quanto le costa UNA lezione."""
        lessons = self.get_lessons_included(obj)
        if not lessons:
            return None
        return str((Decimal(obj.price) / lessons).quantize(Decimal("0.01")))


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
