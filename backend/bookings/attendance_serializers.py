from rest_framework import serializers

from .models import Attendance, Booking


class LessonRosterEntrySerializer(serializers.Serializer):
    """One booked student on the lesson roster, with their current attendance
    (if already marked)."""

    booking_id = serializers.UUIDField()
    student_id = serializers.UUIDField()
    student_name = serializers.CharField()
    access_source = serializers.CharField()
    booking_status = serializers.CharField()
    attendance_status = serializers.CharField(allow_null=True)
    marked_at = serializers.DateTimeField(allow_null=True)


class MarkAttendanceItemSerializer(serializers.Serializer):
    student_id = serializers.UUIDField()
    status = serializers.ChoiceField(choices=Attendance.Status.choices)
    status_id = serializers.UUIDField(required=False, allow_null=True)


class AttendanceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Attendance
        fields = ("id", "lesson", "booking", "student", "teacher", "status", "status_ref", "marked_at")
        read_only_fields = fields
