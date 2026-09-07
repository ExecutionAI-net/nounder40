"""QA_REGRESSION_ROUND2 R2-H6: `StudentDocument.status` used to default to
VALID, so any upload -- even one with no attached file -- satisfied
`block_booking_on_documents` with zero school action, and the school's own
Approve/Reject/expiry/note controls sent `{action: ...}`, a key
`SchoolDocumentValidateView.patch()` never read (only a bare `status`),
so none of them actually did anything beyond touching validated_at/
validated_by -- Reject produced the exact same result as Approve. This
covers: the new PENDING default, the now-working action wiring, the
content-presence gate, and the approved-document delete lock the frontend
already expected but the backend never enforced."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from bookings.services import _missing_required_document_names
from schools.models import School, SchoolDocumentType, SchoolMembership, SchoolStudent
from students.models import Student, StudentDocument

pytestmark = pytest.mark.django_db
User = get_user_model()


def _school(**kwargs):
    return School.objects.create(
        name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com", **kwargs
    )


def _student(school):
    user = User.objects.create(email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT])
    student = Student.objects.create(user=user, name="Anna", school=school)
    SchoolStudent.objects.get_or_create(school=school, student=student)
    return student


def _school_client(school, sub_role="admin"):
    user = User.objects.create(email=f"sch-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school)
    SchoolMembership.objects.create(profile=user, school=school, sub_role=sub_role)
    client = APIClient()
    client.force_authenticate(user)
    return client


def _student_client(student):
    client = APIClient()
    client.force_authenticate(student.user)
    return client


def _with_file(**overrides):
    body = dict(files=[{"path": "p", "name": "n.pdf", "mime": "application/pdf", "size": 10}])
    body.update(overrides)
    return body


def test_new_document_defaults_to_pending():
    school = _school()
    student = _student(school)
    doc = StudentDocument.objects.create(student=student, school=school, **_with_file())
    assert doc.status == StudentDocument.Status.PENDING
    assert doc.validated_at is None


def test_student_self_upload_via_api_defaults_to_pending():
    school = _school()
    student = _student(school)
    client = _student_client(student)
    resp = client.post(
        "/api/student/documents/",
        {"school": str(school.id), **_with_file()},
        format="json",
    )
    assert resp.status_code == 201, resp.content
    assert resp.data["status"] == "pending"


def test_pending_document_does_not_satisfy_required_gate():
    school = _school()
    student = _student(school)
    doc_type = SchoolDocumentType.objects.create(school=school, name="Medical", required=True, active=True)
    StudentDocument.objects.create(student=student, school=school, type_ref=doc_type, **_with_file())
    assert _missing_required_document_names(student, school) == ["Medical"]


def test_content_less_valid_document_does_not_satisfy_required_gate():
    """Defense-in-depth (R2-H6): even if a `status=valid` row exists with no
    real attachment (reachable only via a direct API call, since the
    frontend's own client-side check already blocks a zero-file upload), the
    gate must not treat it as satisfying the requirement."""
    school = _school()
    student = _student(school)
    doc_type = SchoolDocumentType.objects.create(school=school, name="Medical", required=True, active=True)
    StudentDocument.objects.create(
        student=student, school=school, type_ref=doc_type, status=StudentDocument.Status.VALID, files=[], file_url="",
    )
    assert _missing_required_document_names(student, school) == ["Medical"]


def test_real_valid_document_satisfies_required_gate():
    school = _school()
    student = _student(school)
    doc_type = SchoolDocumentType.objects.create(school=school, name="Medical", required=True, active=True)
    StudentDocument.objects.create(
        student=student, school=school, type_ref=doc_type, status=StudentDocument.Status.VALID, **_with_file(),
    )
    assert _missing_required_document_names(student, school) == []


def test_school_validate_action_actually_sets_status():
    school = _school()
    student = _student(school)
    doc = StudentDocument.objects.create(student=student, school=school, **_with_file())
    client = _school_client(school)

    resp = client.patch(f"/api/school/documents/{doc.id}/", {"action": "validate"}, format="json")
    assert resp.status_code == 200, resp.content
    doc.refresh_from_db()
    assert doc.status == StudentDocument.Status.VALID
    assert doc.validated_at is not None


def test_school_reject_action_actually_sets_status_and_differs_from_validate():
    school = _school()
    student = _student(school)
    doc = StudentDocument.objects.create(student=student, school=school, **_with_file())
    client = _school_client(school)

    resp = client.patch(f"/api/school/documents/{doc.id}/", {"action": "reject"}, format="json")
    assert resp.status_code == 200, resp.content
    doc.refresh_from_db()
    assert doc.status == StudentDocument.Status.REJECTED


def test_school_expiry_action_sets_expiry_without_touching_status():
    school = _school()
    student = _student(school)
    doc = StudentDocument.objects.create(student=student, school=school, **_with_file())
    client = _school_client(school)

    resp = client.patch(f"/api/school/documents/{doc.id}/", {"action": "expiry", "expires_at": "2027-01-01T00:00:00Z"}, format="json")
    assert resp.status_code == 200, resp.content
    doc.refresh_from_db()
    assert doc.expires_at is not None
    assert doc.status == StudentDocument.Status.PENDING
    assert doc.validated_at is None  # not a review decision


def test_school_flag_action_sets_note():
    school = _school()
    student = _student(school)
    doc = StudentDocument.objects.create(student=student, school=school, **_with_file())
    client = _school_client(school)

    resp = client.patch(f"/api/school/documents/{doc.id}/", {"action": "flag", "note": "Blurry photo"}, format="json")
    assert resp.status_code == 200, resp.content
    doc.refresh_from_db()
    assert doc.note == "Blurry photo"


def test_student_cannot_delete_an_approved_document():
    school = _school()
    student = _student(school)
    doc = StudentDocument.objects.create(student=student, school=school, status=StudentDocument.Status.VALID, **_with_file())
    client = _student_client(student)

    resp = client.delete(f"/api/documents/{doc.id}/")
    assert resp.status_code == 400
    assert resp.data["error"] == "approved_locked"
    assert StudentDocument.objects.filter(pk=doc.id).exists()


def test_student_can_delete_a_pending_document():
    school = _school()
    student = _student(school)
    doc = StudentDocument.objects.create(student=student, school=school, **_with_file())
    client = _student_client(student)

    resp = client.delete(f"/api/documents/{doc.id}/")
    assert resp.status_code == 204
    assert not StudentDocument.objects.filter(pk=doc.id).exists()


def test_school_can_still_delete_an_approved_document():
    school = _school()
    student = _student(school)
    doc = StudentDocument.objects.create(student=student, school=school, status=StudentDocument.Status.VALID, **_with_file())
    client = _school_client(school)

    resp = client.delete(f"/api/documents/{doc.id}/")
    assert resp.status_code == 204
