"""R3-H1 (QA_REGRESSION_ROUND3_CROSSCUT.md X-R3-01): narrow HQ roles could
read, download and DELETE every student's private document.

PR #89 (R2-H2) stopped treating a bare `is_hq()` as unconditional cross-school
god-mode — but only in `SchoolSectionGuardMiddleware`, in
`SchoolScopedModelViewSet.get_queryset()` and in chat. `/api/documents/` is
mounted at the project root (`config/urls.py`), so none of those layers see
it, and all three of its views kept the bare check. Live, `qa.hq.support`
(permissions `[dashboard, inbox]`) was correctly 403'd on
`GET /api/school/documents/?school=<X>` yet got 200 on
`GET /api/documents/<id>/`, 200 `application/pdf` on `…/file/`, and 204 on
`DELETE` — which destroyed a real fixture document mid-run.

These tests pin the same predicate the rest of the codebase uses:
owner/super_admin, or the `schools_create_edit` permission.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import HQMember, Role
from schools.models import School
from students.models import Student, StudentDocument

pytestmark = pytest.mark.django_db
User = get_user_model()

# support/tech_support hold neither permission; finance/analytics hold only
# the read-only `schools_view` — none of them is cross-school god-mode.
NARROW_HQ_SUB_ROLES = ["support", "tech_support", "finance", "analytics"]
GODMODE_HQ_SUB_ROLES = ["owner", "super_admin", "operations"]


def _jwt_client(user):
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


def _hq_client(sub_role):
    user = User.objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role=sub_role,
    )
    HQMember.objects.create(user=user, email=user.email, name="QA", sub_role=sub_role)
    return _jwt_client(user)


@pytest.fixture
def document():
    school = School.objects.create(
        name="Victim", slug=f"s-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com"
    )
    student_user = User.objects.create(
        email=f"s-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT]
    )
    student = Student.objects.create(user=student_user, school=school, name="QA Student")
    return StudentDocument.objects.create(
        student=student, school=school, type="medical_cert", note="private note",
        files=[{"path": "documents/x.pdf", "name": "cert.pdf", "mime": "application/pdf", "size": 23}],
    )


# --- narrow HQ roles: blocked on all three verbs -----------------------------


@pytest.mark.parametrize("sub_role", NARROW_HQ_SUB_ROLES)
def test_narrow_hq_role_cannot_read_a_students_document(sub_role, document):
    resp = _hq_client(sub_role).get(f"/api/documents/{document.pk}/")
    assert resp.status_code == 403, resp.content


@pytest.mark.parametrize("sub_role", NARROW_HQ_SUB_ROLES)
def test_narrow_hq_role_cannot_download_a_students_document(sub_role, document):
    resp = _hq_client(sub_role).get(f"/api/documents/{document.pk}/file/?path=documents/x.pdf")
    assert resp.status_code == 403, resp.content


@pytest.mark.parametrize("sub_role", NARROW_HQ_SUB_ROLES)
def test_narrow_hq_role_cannot_delete_a_students_document(sub_role, document):
    """The live probe actually destroyed a fixture document this way."""
    resp = _hq_client(sub_role).delete(f"/api/documents/{document.pk}/")
    assert resp.status_code == 403, resp.content
    assert StudentDocument.objects.filter(pk=document.pk).exists()


# --- genuine cross-school HQ authority: unaffected ---------------------------


@pytest.mark.parametrize("sub_role", GODMODE_HQ_SUB_ROLES)
def test_hq_school_godmode_can_still_read_a_document(sub_role, document):
    resp = _hq_client(sub_role).get(f"/api/documents/{document.pk}/")
    assert resp.status_code == 200, resp.content
    assert resp.json()["id"] == str(document.pk)


@pytest.mark.parametrize("sub_role", GODMODE_HQ_SUB_ROLES)
def test_hq_school_godmode_can_still_download_a_document(sub_role, document):
    resp = _hq_client(sub_role).get(f"/api/documents/{document.pk}/file/?path=documents/x.pdf")
    assert resp.status_code == 200, resp.content
    assert resp["X-Accel-Redirect"] == "/internal-media/documents/x.pdf"


def test_hq_school_godmode_can_still_delete_an_approved_document(document):
    """`is_school_side` moved to the same predicate: an operations-grade HQ
    caller must stay on the school side of the R2-H6 `approved_locked` rule,
    not fall through to the student branch."""
    document.status = StudentDocument.Status.VALID
    document.save(update_fields=["status"])
    resp = _hq_client("operations").delete(f"/api/documents/{document.pk}/")
    assert resp.status_code == 204, resp.content
    assert not StudentDocument.objects.filter(pk=document.pk).exists()


# --- the school and the student themselves: unaffected -----------------------


def test_the_students_own_access_is_unaffected(document):
    resp = _jwt_client(document.student.user).get(f"/api/documents/{document.pk}/")
    assert resp.status_code == 200, resp.content


def test_another_schools_user_still_gets_403(document):
    other_school = School.objects.create(
        name="Other", slug=f"o-{uuid.uuid4().hex[:8]}", email=f"{uuid.uuid4().hex[:6]}@example.com"
    )
    intruder = User.objects.create(
        email=f"o-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL],
        active_school_id=other_school.id,
    )
    resp = _jwt_client(intruder).get(f"/api/documents/{document.pk}/")
    assert resp.status_code == 403, resp.content
