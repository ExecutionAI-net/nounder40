"""QA_REGRESSION_ROUND2 R2-H4: the HQ lesson-types page always sent `null`
for any blank optional text field (name_fr/description_*/video_url_* --
LANGS deliberately excludes 'fr', so those were always null, and any blank
description/video URL in it/en/es hit the same path). LessonType's text
fields are `blank=True` but not `null=True`, so DRF rejected every one with
"This field may not be null." -- both New and Edit-Save 400'd whenever any
optional field was left empty, which is the common case."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import Role
from catalog.models import LessonType

pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def hq_client():
    user = User.objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role="owner",
    )
    client = APIClient()
    client.force_authenticate(user)
    return client


def _payload(**overrides):
    body = {
        "code": f"QA_H4_{uuid.uuid4().hex[:8]}", "name_it": "Test IT", "name_en": "Test EN",
        "name_fr": "", "name_es": "", "level": "all",
        "description_it": "", "description_en": "", "description_fr": "", "description_es": "",
        "video_url_it": "", "video_url_en": "", "video_url_fr": "", "video_url_es": "",
    }
    body.update(overrides)
    return body


def test_create_with_blank_optional_fields_succeeds(hq_client):
    resp = hq_client.post("/api/hq/lesson-types/", _payload(), format="json")
    assert resp.status_code == 201, resp.content
    lt = LessonType.objects.get(code=resp.data["code"])
    assert lt.name_fr == ""
    assert lt.description_it == ""


def test_create_with_null_optional_fields_used_to_400_now_rejected_as_bad_input():
    """A `null` in the payload is still not what the model expects (empty
    string is) -- this documents that DRF still correctly rejects an
    explicit null (the frontend fix stops SENDING null; it doesn't make the
    backend accept it, since that would let null leak into the DB)."""
    user = User.objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role="owner",
    )
    client = APIClient()
    client.force_authenticate(user)
    resp = client.post("/api/hq/lesson-types/", _payload(name_fr=None), format="json")
    assert resp.status_code == 400


def test_edit_save_with_blank_optional_fields_succeeds(hq_client):
    lt = LessonType.objects.create(code=f"QA_H4_EDIT_{uuid.uuid4().hex[:8]}", name_it="A", name_en="A", level="all")
    resp = hq_client.patch(f"/api/hq/lesson-types/{lt.id}/", _payload(code=lt.code), format="json")
    assert resp.status_code == 200, resp.content
    lt.refresh_from_db()
    assert lt.video_url_it == ""


def test_create_with_filled_optional_fields_still_works(hq_client):
    resp = hq_client.post(
        "/api/hq/lesson-types/",
        _payload(name_fr="Ballet", description_it="Una descrizione", video_url_en="https://example.com/v.mp4"),
        format="json",
    )
    assert resp.status_code == 201, resp.content
    lt = LessonType.objects.get(code=resp.data["code"])
    assert lt.name_fr == "Ballet"
    assert lt.description_it == "Una descrizione"
