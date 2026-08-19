import uuid

from django.db import models
from django.utils import timezone


class UUIDModel(models.Model):
    """UUID primary key, matching the Supabase uuid_generate_v4() defaults."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class TimeStampedModel(models.Model):
    """`created_at` kept as a settable default (not auto_now_add) so the Phase 8
    ETL can preserve original timestamps."""

    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        abstract = True


class UUIDTimeStampedModel(UUIDModel, TimeStampedModel):
    class Meta:
        abstract = True
