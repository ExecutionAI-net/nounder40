from django.db import models


class Translation(models.Model):
    """Dynamic, DB-driven UI copy for next-intl (migration 029)."""

    key = models.CharField(max_length=255)
    locale = models.CharField(max_length=8)
    value = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "translations"
        constraints = [
            models.UniqueConstraint(fields=["key", "locale"], name="uniq_translation_key_locale")
        ]
        indexes = [models.Index(fields=["locale"])]

    def __str__(self):
        return f"{self.key} ({self.locale})"


class PlatformSetting(models.Model):
    """Key/value settings for the landing page (migration 010)."""

    key = models.CharField(max_length=120, primary_key=True)
    value = models.TextField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "platform_settings"

    def __str__(self):
        return self.key
