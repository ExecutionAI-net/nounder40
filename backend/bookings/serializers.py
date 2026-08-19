from rest_framework import serializers

from catalog.serializers import LessonBookingSerializer

from .models import Booking


class BookingSerializer(serializers.ModelSerializer):
    lesson_detail = LessonBookingSerializer(source="lesson", read_only=True)

    class Meta:
        model = Booking
        fields = (
            "id", "lesson", "school", "access_source", "credits_deducted",
            "status", "cancellation_type", "credit_refunded", "booked_at",
            "cancelled_at", "lesson_detail",
        )
        read_only_fields = fields
