import logging

from django.apps import AppConfig
from django.db.models.signals import post_migrate

logger = logging.getLogger(__name__)


def _sync_builtin_templates(sender, **kwargs):
    """R3-M14: a change to the built-in brand copy used to need a hand-written
    re-seed migration to reach the stored templates, and PR #110 is what
    happens when someone forgets. Doing it here means every `migrate` -- every
    deploy, every `make up` -- carries the copy through, for the rows nobody
    rewrote in HQ > Emails. See notifications/builtin_sync.py."""
    from .builtin_sync import sync_builtin_templates

    try:
        counts = sync_builtin_templates()
    except Exception:  # never let this break a deploy's migrate step
        logger.exception("email template sync failed")
        return
    if counts["created"] or counts["updated"]:
        logger.info("email templates: %(created)s created, %(updated)s refreshed", counts)


class NotificationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "notifications"

    def ready(self):
        post_migrate.connect(_sync_builtin_templates, sender=self)
