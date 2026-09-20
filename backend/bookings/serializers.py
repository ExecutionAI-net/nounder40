from rest_framework import serializers

from catalog.serializers import LessonBookingSerializer

from .models import Booking


class BookingSerializer(serializers.ModelSerializer):
    lesson_detail = LessonBookingSerializer(source="lesson", read_only=True)
    # Special events (SPECIAL_EVENTS.md): a paid seat cannot be cancelled
    # online ("contact the school"), a free one can, any time before it starts.
    is_event = serializers.SerializerMethodField()
    is_event_ticket = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = (
            "id", "lesson", "school", "access_source", "credits_deducted",
            "status", "cancellation_type", "credit_refunded", "booked_at",
            "cancelled_at", "lesson_detail", "is_event", "is_event_ticket",
        )
        read_only_fields = fields

    def get_is_event(self, obj) -> bool:
        from .services import is_special_event

        return is_special_event(obj.lesson)

    def get_is_event_ticket(self, obj) -> bool:
        from .services import is_event_ticket

        return is_event_ticket(obj)
