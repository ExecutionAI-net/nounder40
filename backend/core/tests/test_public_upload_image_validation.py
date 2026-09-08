"""R3-C2 (QA_REGRESSION_ROUND3_TEACHER.md TCH-R3-01): stored XSS on the app
origin through the image-upload endpoints.

`core.storage.save_public()` kept the uploader's own extension and no call
site looked at the bytes, so a teacher could
`POST /api/teacher/<id>/image/` a `.html` file and get back
`/media/public/teacher-photos/<uuid>.html`, which nginx served as
`text/html` on the SPA's own origin — where the JWT lives in `localStorage`.
The same `ModelImageUploadView` backs course/package/subscription images, and
the same `save_public()` backs lesson types, shop products, e-mail assets and
the brand logo.

These tests pin the fix at the choke point (`save_public`, exercised both
directly and through the teacher endpoint, which is the lowest-trust caller
that reaches it): non-image bytes are refused, and a real image is always
stored under an extension derived from its magic bytes, never from its name.
"""
import io
import uuid

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from accounts.models import Role
from core.storage import save_public
from core.uploads import InvalidImageUpload
from teachers.models import Teacher

pytestmark = pytest.mark.django_db


def _png_bytes(size=(4, 4)):
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", size, (10, 20, 30)).save(buf, format="PNG")
    return buf.getvalue()


def _jpeg_bytes():
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (10, 20, 30)).save(buf, format="JPEG")
    return buf.getvalue()


def _upload(content: bytes, name: str, content_type: str):
    return SimpleUploadedFile(name, content, content_type=content_type)


# --- the choke point itself -------------------------------------------------


def test_html_masquerading_as_an_image_is_refused(settings, tmp_path):
    """The live repro's payload, straight at save_public()."""
    settings.MEDIA_ROOT = str(tmp_path)
    evil = _upload(b"<script>alert(1)</script>", "evil.html", "text/html")
    with pytest.raises(InvalidImageUpload):
        save_public(evil, subdir="teacher-photos")
    assert list(tmp_path.rglob("*")) == []


def test_html_with_a_lying_content_type_header_is_refused(settings, tmp_path):
    """`file.content_type` is written by the client — the three call sites
    that checked it were never protected by it."""
    settings.MEDIA_ROOT = str(tmp_path)
    evil = _upload(b"<script>alert(1)</script>", "evil.png", "image/png")
    with pytest.raises(InvalidImageUpload):
        save_public(evil, subdir="teacher-photos")


def test_scripted_svg_is_refused(settings, tmp_path):
    """SVG is a scriptable document format and runs when opened directly."""
    settings.MEDIA_ROOT = str(tmp_path)
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'
    with pytest.raises(InvalidImageUpload):
        save_public(_upload(svg, "x.svg", "image/svg+xml"), subdir="teacher-photos")


def test_png_header_glued_in_front_of_a_payload_is_refused(settings, tmp_path):
    """Magic bytes alone would pass this; Pillow has to parse it too."""
    settings.MEDIA_ROOT = str(tmp_path)
    polyglot = b"\x89PNG\r\n\x1a\n" + b"<script>alert(1)</script>" * 4
    with pytest.raises(InvalidImageUpload):
        save_public(_upload(polyglot, "x.png", "image/png"), subdir="teacher-photos")


def test_extension_comes_from_the_bytes_not_the_filename(settings, tmp_path):
    """A real PNG named `.html` must still land as `.png` — this is the half
    of the fix that actually stops nginx typing it as a document."""
    settings.MEDIA_ROOT = str(tmp_path)
    url = save_public(_upload(_png_bytes(), "photo.html", "text/html"), subdir="teacher-photos")
    assert url.endswith(".png"), url
    assert (tmp_path / "public" / "teacher-photos").exists()


def test_a_real_image_still_uploads(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    for content, expected in ((_png_bytes(), ".png"), (_jpeg_bytes(), ".jpg")):
        url = save_public(_upload(content, "photo.bin", "application/octet-stream"), subdir="courses")
        assert url.endswith(expected), url
        stored = tmp_path / "public" / "courses" / url.rsplit("/", 1)[1]
        assert stored.read_bytes() == content


def test_oversized_image_is_refused(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    from core.uploads import MAX_PUBLIC_IMAGE_BYTES

    big = _upload(_png_bytes() + b"\x00" * MAX_PUBLIC_IMAGE_BYTES, "big.png", "image/png")
    with pytest.raises(InvalidImageUpload):
        save_public(big, subdir="courses")


# --- through the endpoint the finding was reported against ------------------


@pytest.fixture
def teacher_client():
    email = f"t-{uuid.uuid4().hex[:8]}@example.com"
    user = get_user_model().objects.create(email=email, role=Role.TEACHER, roles=[Role.TEACHER])
    teacher = Teacher.objects.create(user=user, name="QA Teacher", email=email)
    api = APIClient()
    api.force_authenticate(user=user)
    return api, teacher


def test_teacher_cannot_upload_html_as_a_profile_photo(teacher_client, settings, tmp_path):
    """The exact live repro: the lowest-trust authenticated role, its own
    photo endpoint, a `.html` body -- 200 before the fix."""
    settings.MEDIA_ROOT = str(tmp_path)
    api, teacher = teacher_client
    resp = api.post(
        f"/api/teacher/{teacher.pk}/image/",
        {"file": _upload(b"<script>alert(1)</script>", "evil.html", "text/html")},
        format="multipart",
    )
    assert resp.status_code == 400, resp.content
    assert resp.json()["error"] == "invalid_type"
    teacher.refresh_from_db()
    assert not teacher.photo_url
    assert not list(tmp_path.rglob("*.html"))


def test_teacher_can_still_upload_a_real_photo(teacher_client, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    api, teacher = teacher_client
    resp = api.post(
        f"/api/teacher/{teacher.pk}/image/",
        {"file": _upload(_png_bytes(), "me.png", "image/png")},
        format="multipart",
    )
    assert resp.status_code == 200, resp.content
    teacher.refresh_from_db()
    assert teacher.photo_url.endswith(".png")
