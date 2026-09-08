"""HQ > Emails "after_purchase" after a package is credited (Stripe webhook)."""
import uuid
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model

from catalog.models import Course, LessonType, Package
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
    assert ctx["package_expiry"] and "/it/student/book?for=" in ctx["booking_url"]
    # ST-R2-15: no course is tied to this package's lesson types, so
    # package_lesson_cost() can't name a single per-lesson cost -- {{lessons_total}}
    # used to render blank ("✨  lezioni (10 crediti)"); {{package_summary}} now
    # substitutes a phrase instead of the blank count.
    assert ctx["lessons_total"] == ""
    assert ctx["package_summary"] == "tutte le tipologie di lezione (10 crediti)"


def test_receipt_email_singular_lesson_and_credit(django_capture_on_commit_callbacks):
    """ST-R2-15: "1 lezioni (1 crediti)" reached students with no plural
    handling -- a single lesson/credit now gets the singular noun."""
    school = School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com")
    user = get_user_model().objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Maria Rossi", first_name="Maria", last_name="Rossi", school=school, language_preference="it")
    lesson_type = LessonType.objects.create(code=f"sbarra-{uuid.uuid4().hex[:6]}", name_en="Barre", name_it="Sbarra")
    Course.objects.create(school=school, lesson_type=lesson_type, credit_cost=1)
    package = Package.objects.create(
        school=school, credits=1, name_it="Prova", name_en="Trial", price=10,
        allowed_lesson_types=[str(lesson_type.id)],
    )

    with patch("notifications.tasks.send_transactional_email_task.delay") as delayed, django_capture_on_commit_callbacks(execute=True):
        activate_package_payment(
            payment_id="pi_test_2", amount_cents=1000,
            metadata={"kind": "package", "school_id": str(school.id), "student_id": str(student.id), "item_id": str(package.id)},
        )
    ctx = delayed.call_args.kwargs["context"]
    assert ctx["lessons_total"] == "1"
    assert ctx["package_summary"] == "1 lezione (1 credito)"
