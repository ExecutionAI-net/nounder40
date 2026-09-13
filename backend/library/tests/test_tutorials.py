"""Tutorials: HQ publishes video / PDF how-tos, one row per language; the
student page reads them without a login.

What these pin: the public list shows only what is actually publishable
(active, and a PDF only once its file is attached) and never leaks the
private storage key; the PDF comes back through X-Accel-Redirect typed as a
PDF; HQ writes are HQ-only and, through the section guard, need the
`library` permission; an upload has to be a real PDF.
"""
import os
import uuid

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import HQMember, Role
from library import tutorial_files
from library.models import Tutorial

pytestmark = pytest.mark.django_db

PUBLIC = "/api/tutorials/"
HQ = "/api/hq/tutorials/"
PDF_BYTES = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\n"
VIDEO = "https://www.youtube.com/watch?v=abc123"


def _jwt_client(user):
    # The section guard authenticates from the JWT itself, so
    # force_authenticate would slip past it.
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


def _hq_client(sub_role="owner"):
    user = get_user_model().objects.create(
        email=f"hq-{uuid.uuid4().hex[:8]}@example.com", role=Role.HQ, roles=[Role.HQ], hq_sub_role=sub_role
    )
    HQMember.objects.create(user=user, email=user.email, name="QA", sub_role=sub_role)
    return _jwt_client(user)


def _student_client():
    user = get_user_model().objects.create(
        email=f"stu-{uuid.uuid4().hex[:8]}@example.com", role=Role.STUDENT, roles=[Role.STUDENT]
    )
    return _jwt_client(user)


def _tutorial(**overrides):
    fields = dict(title="How to book a class", type=Tutorial.Type.VIDEO, language="it", video_url=VIDEO)
    fields.update(overrides)
    return Tutorial.objects.create(**fields)


def _pdf_upload(content=PDF_BYTES, name="guide.pdf"):
    return SimpleUploadedFile(name, content, content_type="application/pdf")


def _attach(api, tutorial_id, upload):
    return api.post(f"{HQ}{tutorial_id}/file/", {"file": upload}, format="multipart")


# --- public read side -------------------------------------------------------


def test_public_list_shows_only_what_is_publishable():
    shown_video = _tutorial(title="Shown video")
    _tutorial(title="Inactive", active=False)
    _tutorial(title="PDF still being set up", type=Tutorial.Type.PDF, video_url="")
    shown_pdf = _tutorial(
        title="Shown PDF", type=Tutorial.Type.PDF, video_url="",
        file_path="tutorials/x.pdf", file_name="guide.pdf", file_size=12,
    )

    response = APIClient().get(PUBLIC)

    assert response.status_code == 200
    by_id = {row["id"]: row for row in response.json()}
    assert set(by_id) == {str(shown_video.id), str(shown_pdf.id)}
    # The private storage key never leaves the server; the page gets the
    # streaming route instead.
    assert "file_path" not in by_id[str(shown_pdf.id)]
    assert by_id[str(shown_pdf.id)]["file_url"] == f"/api/tutorials/{shown_pdf.id}/file/"
    assert by_id[str(shown_video.id)]["file_url"] is None


def test_public_list_filters_are_csv_lists():
    it_booking = _tutorial(language="it", topic="Prenotazioni")
    en_booking = _tutorial(language="en", topic="Bookings")
    _tutorial(language="fr", topic="Réservations")
    it_pay = _tutorial(language="it", topic="Pagamenti", title="Paying with a card")

    api = APIClient()
    ids = lambda r: {row["id"] for row in r.json()}  # noqa: E731

    assert ids(api.get(PUBLIC, {"language": "it,en"})) == {str(it_booking.id), str(en_booking.id), str(it_pay.id)}
    assert ids(api.get(PUBLIC, {"topic": "Prenotazioni,Bookings"})) == {str(it_booking.id), str(en_booking.id)}
    assert ids(api.get(PUBLIC, {"type": "pdf"})) == set()
    assert ids(api.get(PUBLIC, {"q": "card"})) == {str(it_pay.id)}


def test_public_file_streams_a_published_pdf(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    tutorial = _tutorial(type=Tutorial.Type.PDF, video_url="")
    attached = _attach(_hq_client(), tutorial.id, _pdf_upload())
    assert attached.status_code == 200, attached.content
    assert attached.json()["file_name"] == "guide.pdf"
    assert attached.json()["file_size"] == len(PDF_BYTES)

    response = APIClient().get(f"{PUBLIC}{tutorial.id}/file/")

    assert response.status_code == 200
    assert response["X-Accel-Redirect"].startswith("/internal-media/tutorials/")
    assert response["Content-Type"] == "application/pdf"
    assert response["Content-Disposition"].startswith("inline")
    assert 'filename="guide.pdf"' in response["Content-Disposition"]


def test_public_file_is_404_for_unpublished_rows(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    api = APIClient()
    no_file = _tutorial(type=Tutorial.Type.PDF, video_url="")
    assert api.get(f"{PUBLIC}{no_file.id}/file/").status_code == 404

    inactive = _tutorial(type=Tutorial.Type.PDF, video_url="", active=False)
    assert _attach(_hq_client(), inactive.id, _pdf_upload()).status_code == 200
    assert api.get(f"{PUBLIC}{inactive.id}/file/").status_code == 404

    video = _tutorial()
    assert api.get(f"{PUBLIC}{video.id}/file/").status_code == 404


# --- HQ write side ----------------------------------------------------------


def test_hq_endpoints_are_hq_only():
    payload = {"title": "x", "type": "video", "language": "en", "video_url": VIDEO}
    assert APIClient().get(HQ).status_code == 401
    student = _student_client()
    assert student.get(HQ).status_code == 403
    assert student.post(HQ, payload, format="json").status_code == 403
    assert Tutorial.objects.count() == 0


def test_section_guard_maps_tutorials_to_the_library_permission():
    tutorial = _tutorial()
    # support: dashboard + inbox only (accounts/migrations/0004_seed_hq_roles.py)
    denied = _hq_client("support").get(HQ)
    assert denied.status_code == 403
    assert denied.json() == {"error": "section_forbidden", "section": "library"}
    # operations holds `library`
    allowed = _hq_client("operations").get(HQ)
    assert allowed.status_code == 200
    assert [row["id"] for row in allowed.json()] == [str(tutorial.id)]


def test_hq_create_validates_language_video_url_and_tidies_topic():
    api = _hq_client()
    base = {"title": "  How to book  ", "type": "video", "language": "it", "video_url": VIDEO}

    assert api.post(HQ, {**base, "language": "pt"}, format="json").status_code == 400
    assert api.post(HQ, {**base, "video_url": ""}, format="json").status_code == 400
    assert api.post(HQ, {**base, "video_url": "javascript:alert(1)"}, format="json").status_code == 400
    assert api.post(HQ, {**base, "title": "   "}, format="json").status_code == 400

    created = api.post(HQ, {**base, "topic": "  Prenotazioni   lezioni "}, format="json")
    assert created.status_code == 201, created.content
    assert created.json()["title"] == "How to book"
    assert created.json()["topic"] == "Prenotazioni lezioni"

    # A PDF tutorial is created first and gets its file afterwards.
    pdf = api.post(HQ, {"title": "Guide", "type": "pdf", "language": "en"}, format="json")
    assert pdf.status_code == 201, pdf.content
    assert pdf.json()["file_url"] is None


def test_hq_list_can_include_inactive_and_filter_on_it():
    active = _tutorial()
    inactive = _tutorial(active=False)
    api = _hq_client()
    assert {row["id"] for row in api.get(HQ).json()} == {str(active.id), str(inactive.id)}
    assert [row["id"] for row in api.get(HQ, {"active": "false"}).json()] == [str(inactive.id)]


def test_upload_must_be_a_real_pdf(settings, tmp_path, monkeypatch):
    settings.MEDIA_ROOT = str(tmp_path)
    api = _hq_client()
    tutorial = _tutorial(type=Tutorial.Type.PDF, video_url="")

    disguised = _attach(api, tutorial.id, _pdf_upload(b"<script>alert(1)</script>", name="guide.pdf"))
    assert disguised.status_code == 400
    assert disguised.json() == {"error": "invalid_type"}

    monkeypatch.setattr(tutorial_files, "MAX_TUTORIAL_PDF_BYTES", 10)
    too_big = _attach(api, tutorial.id, _pdf_upload())
    assert too_big.status_code == 400
    assert too_big.json() == {"error": "too_large"}

    assert api.post(f"{HQ}{tutorial.id}/file/", {}, format="multipart").status_code == 400
    tutorial.refresh_from_db()
    assert tutorial.file_path == ""
    assert not os.path.exists(os.path.join(str(tmp_path), "private", "tutorials")) or not os.listdir(
        os.path.join(str(tmp_path), "private", "tutorials")
    )


def test_upload_is_refused_on_a_video_tutorial(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    video = _tutorial()
    response = _attach(_hq_client(), video.id, _pdf_upload())
    assert response.status_code == 400
    assert response.json() == {"error": "not_a_pdf_tutorial"}


def test_replacing_switching_and_deleting_clean_up_the_blob(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    api = _hq_client()
    private_dir = os.path.join(str(tmp_path), "private", "tutorials")
    tutorial = _tutorial(type=Tutorial.Type.PDF, video_url="")

    assert _attach(api, tutorial.id, _pdf_upload(name="v1.pdf")).status_code == 200
    assert _attach(api, tutorial.id, _pdf_upload(name="v2.pdf")).status_code == 200
    tutorial.refresh_from_db()
    assert tutorial.file_name == "v2.pdf"
    assert len(os.listdir(private_dir)) == 1  # v1 is gone

    # Explicit removal through DELETE .../file/
    removed = api.delete(f"{HQ}{tutorial.id}/file/")
    assert removed.status_code == 200
    assert removed.json()["file_url"] is None
    assert os.listdir(private_dir) == []

    # Switching a PDF tutorial to a video drops the attachment too.
    assert _attach(api, tutorial.id, _pdf_upload(name="v3.pdf")).status_code == 200
    switched = api.patch(f"{HQ}{tutorial.id}/", {"type": "video", "video_url": VIDEO}, format="json")
    assert switched.status_code == 200, switched.content
    assert switched.json()["file_url"] is None
    assert os.listdir(private_dir) == []

    # Deleting the row deletes the file.
    other = _tutorial(type=Tutorial.Type.PDF, video_url="")
    assert _attach(api, other.id, _pdf_upload(name="v4.pdf")).status_code == 200
    assert len(os.listdir(private_dir)) == 1
    assert api.delete(f"{HQ}{other.id}/").status_code == 204
    assert os.listdir(private_dir) == []
    assert not Tutorial.objects.filter(pk=other.id).exists()
