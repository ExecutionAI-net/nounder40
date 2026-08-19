from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.utils import timezone

from core.models import UUIDModel, UUIDTimeStampedModel


class Conversation(UUIDTimeStampedModel):
    class Type(models.TextChoices):
        HQ_SCHOOL = "hq_school", "HQ ↔ School"
        SCHOOL_STUDENT = "school_student", "School ↔ Student"
        SCHOOL_TEACHER = "school_teacher", "School ↔ Teacher"
        TEACHER_SUPPORT = "teacher_support", "Teacher support"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        IN_PROGRESS = "in_progress", "In progress"
        RESOLVED = "resolved", "Resolved"

    class Priority(models.TextChoices):
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"

    type = models.CharField(max_length=20, choices=Type.choices, default=Type.SCHOOL_STUDENT)
    hq = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+", db_column="hq_id")
    school = models.ForeignKey("schools.School", on_delete=models.CASCADE, null=True, blank=True, related_name="conversations")
    student = models.ForeignKey("students.Student", on_delete=models.CASCADE, null=True, blank=True, related_name="conversations")
    teacher = models.ForeignKey("teachers.Teacher", on_delete=models.CASCADE, null=True, blank=True, related_name="conversations")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.MEDIUM)
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    tags = ArrayField(models.CharField(max_length=60), default=list, blank=True)
    first_response_at = models.DateTimeField(null=True, blank=True)
    last_message_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "conversations"


class Message(UUIDTimeStampedModel):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sent_messages", db_column="sender_id")
    sender_role = models.CharField(max_length=20, default="student")
    content = models.TextField(blank=True)
    is_internal = models.BooleanField(default=False)
    attachment_url = models.TextField(blank=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "messages"
        indexes = [models.Index(fields=["conversation", "created_at"])]


class QuickReplyTemplate(UUIDTimeStampedModel):
    school = models.ForeignKey("schools.School", on_delete=models.CASCADE, related_name="quick_replies")
    title = models.CharField(max_length=255)
    content = models.TextField()

    class Meta:
        db_table = "quick_reply_templates"
