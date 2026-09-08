"""QA H-1/H-8 and R3-M5 (SCH-R3-03): the `documents_required` booking gate.

H-1/H-8: the booking-blocked error used to ship
with no way for the frontend to say WHICH document(s) are missing — the API
only ever returned {"error": "documents_required"}, so the frontend had to
hardcode an empty interpolation value and rendered a dangling
"...documents needed to book: . Upload them..." message. `assert_bookable`
now raises BookingError with a `documents` list of the missing school
document type name(s), and both API surfaces (POST /api/bookings/, and the
drop-in checkout's pre-payment revalidation in commerce/stripe_views.py)
pass it through in the response body.
"""
import uuid
from datetime import date, time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from bookings.services import BookingError, book_lesson
from catalog.models import Course, Lesson, LessonType, Package
from schools.models import School, SchoolDocumentType
from students.models import Student, StudentDocument, StudentPackage

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def school():
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        block_booking_on_documents=True,
    )


@pytest.fixture
def student(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna", school=school)
    pkg = Package.objects.create(school=school, credits=10)
    StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=10, credits_remaining=10,
        expires_at=timezone.now() + timedelta(days=90),
    )
    return student


def _lesson(school):
    lt = LessonType.objects.create(code=f"lt-{uuid.uuid4().hex[:6]}", name_en="Barre")
    course = Course.objects.create(school=school, lesson_type=lt, credit_cost=1, min_booking_notice_hours=0)
    return Lesson.objects.create(
        school=school, course=course, lesson_type=lt, date=date.today() + timedelta(days=7),
        start_time=time(10, 0), end_time=time(11, 0), max_capacity=10, status="scheduled",
    )


def test_book_lesson_raises_with_missing_document_names(school, student):
    SchoolDocumentType.objects.create(school=school, code="medical", name="Medical Certificate", required=True)
    SchoolDocumentType.objects.create(school=school, code="id", name="ID Card", required=True)
    lesson = _lesson(school)

    with pytest.raises(BookingError) as exc:
        book_lesson(student, lesson)

    assert str(exc.value) == "documents_required"
    assert sorted(exc.value.documents) == ["ID Card", "Medical Certificate"]


def test_book_lesson_omits_document_the_student_already_has_valid():
    school = School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com",
        block_booking_on_documents=True,
    )
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com")
    student = Student.objects.create(user=user, name="Anna", school=school)
    pkg = Package.objects.create(school=school, credits=10)
    StudentPackage.objects.create(
        student=student, school=school, package=pkg, credits_total=10, credits_remaining=10,
        expires_at=timezone.now() + timedelta(days=90),
    )
    valid_type = SchoolDocumentType.objects.create(school=school, code="medical", name="Medical Certificate", required=True)
    SchoolDocumentType.objects.create(school=school, code="id", name="ID Card", required=True)
    # R2-H6: a "valid" document with no real attachment must not satisfy the
    # gate (see students/tests/test_document_review_workflow.py) -- give this
    # one actual content so it represents a genuinely reviewed upload.
    StudentDocument.objects.create(
        student=student, school=school, type_ref=valid_type, status="valid",
        files=[{"path": "p", "name": "medical.pdf", "mime": "application/pdf", "size": 10}],
    )
    lesson = _lesson(school)

    with pytest.raises(BookingError) as exc:
        book_lesson(student, lesson)

    assert exc.value.documents == ["ID Card"]


def test_documents_required_api_response_includes_document_names(school, student):
    SchoolDocumentType.objects.create(school=school, code="medical", name="Medical Certificate", required=True)
    lesson = _lesson(school)

    client = APIClient()
    client.force_authenticate(student.user)
    res = client.post("/api/bookings/", {"lesson": str(lesson.id)}, format="json")

    assert res.status_code == 400
    body = res.json()
    assert body["error"] == "documents_required"
    assert body["documents"] == ["Medical Certificate"]


# --- R3-M5 / SCH-R3-03: expiry ------------------------------------------------


def _valid_document(student, school, doc_type, **kwargs):
    return StudentDocument.objects.create(
        student=student, school=school, type_ref=doc_type, status="valid",
        files=[{"path": "p", "name": "medical.pdf", "mime": "application/pdf", "size": 10}],
        **kwargs,
    )


def test_an_expired_required_document_blocks_booking(school, student):
    """SCH-R3-03: the school set an expiry date in the past, the sheet showed
    "scade il 1 set 2026", the status stayed `valid` because nothing ever
    moves a document out of it -- and the booking went through (201). The
    expiry was decorative: exactly the risk the gate exists for."""
    doc_type = SchoolDocumentType.objects.create(
        school=school, code="medical", name="Medical Certificate", required=True, has_expiry=True,
    )
    _valid_document(student, school, doc_type, expires_at=timezone.now() - timedelta(days=8))
    lesson = _lesson(school)

    with pytest.raises(BookingError) as exc:
        book_lesson(student, lesson)

    assert str(exc.value) == "documents_required"
    assert exc.value.documents == ["Medical Certificate"]


def test_a_document_expiring_later_still_allows_booking(school, student):
    """"Expiring soon is still OK" -- spec 11.2, unchanged."""
    doc_type = SchoolDocumentType.objects.create(
        school=school, code="medical", name="Medical Certificate", required=True, has_expiry=True,
    )
    _valid_document(student, school, doc_type, expires_at=timezone.now() + timedelta(days=2))

    assert book_lesson(student, _lesson(school)) is not None


def test_a_document_with_no_expiry_date_still_allows_booking(school, student):
    """No date means no expiry -- the NULL must survive the `exclude()`."""
    doc_type = SchoolDocumentType.objects.create(
        school=school, code="medical", name="Medical Certificate", required=True,
    )
    _valid_document(student, school, doc_type, expires_at=None)

    assert book_lesson(student, _lesson(school)) is not None


def test_the_api_names_the_expired_document(school, student):
    doc_type = SchoolDocumentType.objects.create(
        school=school, code="medical", name="Medical Certificate", required=True, has_expiry=True,
    )
    _valid_document(student, school, doc_type, expires_at=timezone.now() - timedelta(days=1))
    lesson = _lesson(school)

    client = APIClient()
    client.force_authenticate(student.user)
    res = client.post("/api/bookings/", {"lesson": str(lesson.id)}, format="json")

    assert res.status_code == 400, res.content
    assert res.json()["documents"] == ["Medical Certificate"]


def test_a_fresh_upload_replacing_an_expired_one_unblocks_booking(school, student):
    """The way out has to work: the student uploads again, the school
    validates, booking resumes."""
    doc_type = SchoolDocumentType.objects.create(
        school=school, code="medical", name="Medical Certificate", required=True, has_expiry=True,
    )
    _valid_document(student, school, doc_type, expires_at=timezone.now() - timedelta(days=30))
    _valid_document(student, school, doc_type, expires_at=timezone.now() + timedelta(days=365))

    assert book_lesson(student, _lesson(school)) is not None
