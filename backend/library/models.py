from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.utils import timezone

from core.locales import LOCALES
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


# A tutorial is written in exactly one UI locale: no per-language columns,
# one row per language. The list itself lives in core/locales.py.
TUTORIAL_LANGUAGES = LOCALES


class Tutorial(UUIDTimeStampedModel):
    """A how-to for students (video or PDF), published by HQ and readable by
    anyone — the student sidebar's "Tutorials" entry is public.

    Deliberately separate from `LibraryContent`: that is the Metodo Library
    (teaching material for schools and teachers, with levels, lesson types
    and paid access). A tutorial has none of that, and one title in one
    language instead of `title_<locale>` columns — HQ records the same guide
    once per language it wants to offer, and the student page filters by
    the language on her profile.

    A PDF lives in the *private* media tree (`file_path` is a
    `save_private()` key) and is streamed by `PublicTutorialFileView`: the
    public tree is images-only and served with a sandbox CSP that breaks the
    browser's PDF viewer (core/uploads.py, nginx/nginx.conf).
    """

    class Type(models.TextChoices):
        VIDEO = "video", "Video"
        PDF = "pdf", "PDF"

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    type = models.CharField(max_length=10, choices=Type.choices, default=Type.VIDEO)
    language = models.CharField(max_length=8, default="en")
    # Free label chosen by HQ ("Bookings", "Payments"...), used to group the
    # student page. Per language, since the label is in the tutorial's language.
    topic = models.CharField(max_length=80, blank=True)
    # Video: an external URL (YouTube / Vimeo embed, or a direct video file).
    video_url = models.TextField(blank=True)
    # PDF: private storage key + display metadata (see tutorial_files.py).
    file_path = models.TextField(blank=True)
    file_name = models.CharField(max_length=255, blank=True)
    file_size = models.IntegerField(null=True, blank=True)
    thumbnail_url = models.TextField(blank=True)
    sort_order = models.IntegerField(default=0)
    active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "tutorials"
        ordering = ("sort_order", "-created_at")

    def __str__(self):
        return f"{self.title} [{self.language}]"

    @property
    def has_file(self) -> bool:
        return bool(self.file_path)
