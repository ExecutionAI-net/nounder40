"""R4-M4 (QA_REGRESSION_ROUND4 TCH-R4-02 / X-R4-05): the teacher self-profile
endpoint reused the shared `TeacherSerializer`, so a teacher could write her
own `photo_url` (any string -- an external URL rendered as a bare `<img src>`
to every student on the booking page, or `javascript:`; the R3-C2 byte-level
upload validation never saw it) and flip her own `active` flag.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from teachers.models import Teacher

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def teacher():
    user = User.objects.create(
        email=f"t-{uuid.uuid4().hex[:8]}@example.com", role="teacher", roles=["teacher"],
    )
    return Teacher.objects.create(
        user=user, name="Tea Cher", first_name="Tea", last_name="Cher", email=user.email,
        photo_url="/media/public/teacher-photos/real.png", active=True,
    )


def _client(teacher):
    api = APIClient()
    api.force_authenticate(teacher.user)
    return api


def test_a_teacher_cannot_point_her_photo_at_an_arbitrary_url(teacher):
    resp = _client(teacher).patch(
        "/api/teacher/profile/", {"photo_url": "https://evil.example/x.png"}, format="json"
    )
    assert resp.status_code == 200, resp.content
    teacher.refresh_from_db()
    assert teacher.photo_url == "/media/public/teacher-photos/real.png"
    assert resp.json()["photo_url"] == "/media/public/teacher-photos/real.png"


def test_a_teacher_cannot_store_a_javascript_photo_url(teacher):
    _client(teacher).patch("/api/teacher/profile/", {"photo_url": "javascript:alert(1)"}, format="json")
    teacher.refresh_from_db()
    assert teacher.photo_url == "/media/public/teacher-photos/real.png"


def test_a_teacher_cannot_flip_her_own_active_flag(teacher):
    resp = _client(teacher).patch("/api/teacher/profile/", {"active": False}, format="json")
    assert resp.status_code == 200, resp.content
    teacher.refresh_from_db()
    assert teacher.active is True


def test_the_ordinary_profile_fields_still_save(teacher):
    resp = _client(teacher).patch(
        "/api/teacher/profile/", {"bio": "Ballet since 1999", "phone": "+39 333 1234567", "active": False},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    teacher.refresh_from_db()
    assert teacher.bio == "Ballet since 1999"
    assert teacher.phone == "+39 333 1234567"
    assert teacher.active is True
