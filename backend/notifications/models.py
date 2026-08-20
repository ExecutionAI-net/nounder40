from django.conf import settings
from django.db import models

from core.models import UUIDTimeStampedModel


class Notification(UUIDTimeStampedModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    user_role = models.CharField(max_length=20, default="student")
    type = models.CharField(max_length=60)
    title = models.CharField(max_length=255)
    body = models.TextField(blank=True)
    data = models.JSONField(null=True, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "notifications"
        indexes = [models.Index(fields=["user", "read_at"])]


class EmailTemplate(UUIDTimeStampedModel):
    """Transactional email templates (columns renamed to key/locale in 039)."""

    school = models.ForeignKey("schools.School", on_delete=models.CASCADE, null=True, blank=True, related_name="email_templates")
    key = models.CharField(max_length=120)
    locale = models.CharField(max_length=8, default="en")
    subject = models.CharField(max_length=255, blank=True)
    body_html = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "email_templates"
        constraints = [
            models.UniqueConstraint(fields=["school", "key", "locale"], name="uniq_email_template")
        ]

    def __str__(self):
        return f"{self.key} ({self.locale})"


class EmailSetting(models.Model):
    """HQ email on/off switches (migration 039)."""

    key = models.CharField(max_length=120, primary_key=True)
    value = models.CharField(max_length=255)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "email_settings"

    def __str__(self):
        return self.key
