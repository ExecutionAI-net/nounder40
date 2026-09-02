"""HQ > Emails "school.stripe_connected" goes out once, when onboarding first
completes — from the status poll or the webhook, whichever notices first."""
import uuid
from unittest.mock import patch

import pytest

from commerce.stripe_service import set_onboarding_complete
from schools.models import School

pytestmark = pytest.mark.django_db


@pytest.fixture
def school():
    return School.objects.create(
        name="Danza Barcelona", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", language="es",
        stripe_account_id="acct_123",
    )


def test_first_completion_emails_the_school(school, django_capture_on_commit_callbacks):
    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, \
            django_capture_on_commit_callbacks(execute=True):
        set_onboarding_complete(school, True)
    kwargs = delayed.call_args.kwargs
    assert kwargs["key"] == "school.stripe_connected"
    assert kwargs["to_email"] == "s@example.com"
    assert kwargs["locale"] == "es"
    assert kwargs["context"]["dashboard_url"].endswith("/es/school/payments")
    school.refresh_from_db()
    assert school.stripe_onboarding_complete is True


def test_repeat_and_revoke_send_nothing(school, django_capture_on_commit_callbacks):
    school.stripe_onboarding_complete = True
    school.save(update_fields=["stripe_onboarding_complete"])
    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, \
            django_capture_on_commit_callbacks(execute=True):
        set_onboarding_complete(school, True)
        set_onboarding_complete(school, False)
    delayed.assert_not_called()
    school.refresh_from_db()
    assert school.stripe_onboarding_complete is False
