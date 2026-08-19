from rest_framework import serializers

from .models import Conversation, Message, QuickReplyTemplate


class QuickReplyTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuickReplyTemplate
        fields = "__all__"
        extra_kwargs = {"school": {"required": False}}


class MessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = (
            "id", "conversation", "sender", "sender_role", "content",
            "is_internal", "attachment_url", "read_at", "created_at",
        )
        read_only_fields = ("id", "sender", "sender_role", "read_at", "created_at")


class ConversationSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.name", read_only=True, default="")
    school_name = serializers.CharField(source="school.name", read_only=True, default="")
    school_email = serializers.CharField(source="school.email", read_only=True, default="")
    school_phone = serializers.CharField(source="school.phone", read_only=True, default="")
    school_address = serializers.CharField(source="school.address", read_only=True, default="")
    school_city = serializers.CharField(source="school.city", read_only=True, default="")
    teacher_name = serializers.CharField(source="teacher.name", read_only=True, default="")
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = (
            "id", "type", "hq", "school", "school_name", "school_email", "school_phone",
            "school_address", "school_city", "student", "student_name",
            "teacher", "teacher_name", "status", "priority", "assigned_to", "tags",
            "created_at", "first_response_at", "last_message_at", "last_message", "unread_count",
        )
        read_only_fields = ("id", "created_at", "first_response_at", "last_message_at")

    def get_last_message(self, obj):
        msg = obj.messages.order_by("-created_at").first()
        if not msg:
            return None
        return {"content": msg.content, "created_at": msg.created_at, "sender_role": msg.sender_role}

    def get_unread_count(self, obj):
        request = self.context.get("request")
        if request is None or not request.user.is_authenticated:
            return 0
        user = request.user
        qs = obj.messages.filter(read_at__isnull=True).exclude(sender=user)
        if not (user.role in ("hq", "school")):
            qs = qs.filter(is_internal=False)
        return qs.count()
