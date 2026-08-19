import logging

from celery import shared_task

from .emails import send_transactional_email

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def send_transactional_email_task(self, *, to_email, to_name, key, context, locale="en", school_id=None):
    """Async dispatch so a slow/unavailable ZeptoMail never blocks the actual
    business transaction (a booking succeeds even if its confirmation email
    is momentarily delayed)."""
    from schools.models import School

    school = School.objects.filter(pk=school_id).first() if school_id else None
    try:
        return send_transactional_email(
            to_email=to_email, to_name=to_name, key=key, context=context, locale=locale, school=school
        )
    except Exception as exc:  # noqa: BLE001 — retry on any transient send failure
        logger.warning("email send failed (key=%s to=%s): %s", key, to_email, exc)
        raise self.retry(exc=exc)
