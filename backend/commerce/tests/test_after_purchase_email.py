"""HQ > Emails "after_purchase" after a package is credited (Stripe webhook)."""
import uuid
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model

from catalog.models import Package
from commerce.services import activate_package_payment
from schools.models import School
from students.models import Student

pytestmark = pytest.mark.django_db


def test_receipt_email_after_package_activation(django_capture_on_commit_callbacks):
    school = School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Maria Rossi", first_name="Maria", last_name="Rossi", school=school, language_preference="it")
    package = Package.objects.create(school=school, credits=10, name_it="Dieci lezioni", name_en="Ten lessons", price=90)

    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, django_capture_on_commit_callbacks(execute=True):
        result = activate_package_payment(
            payment_id="pi_test_1", amount_cents=9000,
            metadata={"kind": "package", "school_id": str(school.id), "student_id": str(student.id), "item_id": str(package.id)},
        )
    assert result == "package_activated"
    kwargs = delayed.call_args.kwargs
    assert kwargs["key"] == "after_purchase" and kwargs["locale"] == "it"
    ctx = kwargs["context"]
    assert (ctx["package_name"], ctx["amount"], ctx["credits_total"], ctx["student_first_name"]) == ("Dieci lezioni", "€90.00", "10", "Maria")
    assert ctx["package_expiry"] and ctx["booking_url"].endswith("/it/student/book")
