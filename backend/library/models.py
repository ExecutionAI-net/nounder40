from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.utils import timezone

from core.models import UUIDModel, UUIDTimeStampedModel


class LibraryContent(UUIDTimeStampedModel):
    class Type(models.TextChoices):
        VIDEO = "video", "Video"
        PDF = "pdf", "PDF"

    class StudentAccess(models.TextChoices):
        INCLUDED = "included", "Included"
        PAID = "paid", "Paid"

    school = models.ForeignKey("schools.School", on_delete=models.CASCADE, null=True, blank=True, related_name="library_content")
    lesson_type = models.ForeignKey("catalog.LessonType", on_delete=models.SET_NULL, null=True, blank=True, related_name="library_content")
    title_it = models.CharField(max_length=255, blank=True)
    title_en = models.CharField(max_length=255, blank=True)
    title_fr = models.CharField(max_length=255, blank=True)
    title_es = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    file_url = models.TextField(blank=True)
    thumbnail_url = models.TextField(blank=True)
    type = models.CharField(max_length=10, choices=Type.choices, default=Type.VIDEO)
    duration_seconds = models.IntegerField(null=True, blank=True)
    level = models.CharField(max_length=60, blank=True)
    language = models.CharField(max_length=8, default="en")
    visible_to_students = models.BooleanField(default=False)
    student_access = models.CharField(max_length=10, choices=StudentAccess.choices, default=StudentAccess.INCLUDED)
    price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    stripe_product_id = models.CharField(max_length=255, blank=True)
    restricted_to_school_ids = ArrayField(models.UUIDField(), null=True, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "library_content"

    def __str__(self):
        return self.title_en or self.title_it or f"Content {self.id}"


class VideoProgress(UUIDModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="video_progress")
    content = models.ForeignKey(LibraryContent, on_delete=models.CASCADE, related_name="progress")
    progress_seconds = models.IntegerField(default=0)
    completed = models.BooleanField(default=False)
    last_watched_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "video_progress"
        constraints = [
            models.UniqueConstraint(fields=["user", "content"], name="uniq_video_progress_user_content")
        ]
