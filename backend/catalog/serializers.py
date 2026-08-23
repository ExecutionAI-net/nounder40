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
    class Meta:
        model = Package
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class PublicPackageSerializer(serializers.ModelSerializer):
    """Student-facing catalog shape for the /student/buy page — adds a
    nested `schools` object (name/city) for the anonymous cross-network
    browsing view, alongside the raw `school` FK."""

    schools = serializers.SerializerMethodField()

    class Meta:
        model = Package
        fields = (
            "id", "name_it", "name_en", "name_fr", "name_es",
            "description_it", "description_en", "description_fr", "description_es",
            "credits", "validity_days", "validity_unit", "price",
            "color", "language", "image_url", "is_popular", "is_vip",
            "is_recurring", "recurring_interval", "credits_rollover", "school", "schools",
            "allowed_lesson_types", "mode_filter", "is_unlimited", "weekly_booking_cap",
        )

    def get_schools(self, obj):
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
    spots_available = serializers.SerializerMethodField()

    class Meta:
        model = Lesson
        fields = (
            "id", "school", "school_name", "city", "teacher", "teacher_name",
            "lesson_type", "lesson_type_name", "room", "room_name",
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
