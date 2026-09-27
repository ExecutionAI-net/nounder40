"""WhatsApp-sized share image for a special event's link preview.

The event's Open Graph image used to be the school's photo as uploaded —
2048x1365, 615 KB on the live "OPEN SEASON" event — above the ~600 KB Meta
documents for WhatsApp (300 KB in practice). WhatsApp then shows the card
with text and no picture, while Cliq, Facebook and LinkedIn render it.
`core/share_images.py` writes a bounded JPEG next to the original and the
public event endpoint points the preview at it.
"""
import io
import uuid
from datetime import timedelta
from pathlib import Path

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Role
from catalog import events
from core.share_images import SHARE_MAX_BYTES, SHARE_MAX_SIDE, SHARE_SUFFIX, make_share_variant, share_variant_for
from core.storage import delete_public, save_public
from schools.models import School, SchoolMembership

pytestmark = pytest.mark.django_db


def _noisy_jpeg(size=(2048, 1365), *, exif_orientation=None) -> bytes:
    """Photo-like: noise does not compress, so like a phone picture this
    lands well above the WhatsApp ceiling."""
    from PIL import Image

    im = Image.merge("RGB", [Image.effect_noise(size, 60) for _ in range(3)])
    buf = io.BytesIO()
    kwargs = {"quality": 95}
    if exif_orientation:
        exif = Image.Exif()
        exif[0x0112] = exif_orientation
        kwargs["exif"] = exif.tobytes()
    im.save(buf, format="JPEG", **kwargs)
    return buf.getvalue()


def _transparent_png(size=(1600, 900)) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGBA", size, (200, 30, 90, 120)).save(buf, format="PNG")
    return buf.getvalue()


def _open(path):
    from PIL import Image

    return Image.open(path)


@pytest.fixture
def media(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    return tmp_path


def _store(content: bytes, name="photo.jpg", subdir="courses") -> str:
    return save_public(SimpleUploadedFile(name, content, content_type="image/jpeg"), subdir=subdir)


def _on_disk(media, url: str) -> Path:
    return Path(media) / "public" / url.split("/public/", 1)[1]


@pytest.fixture
def school():
    return School.objects.create(name="S", slug=f"s-{uuid.uuid4().hex[:8]}", email="s@example.com", active=True)


@pytest.fixture
def reviewer():
    return get_user_model().objects.create(email=f"hq-{uuid.uuid4().hex[:8]}@example.com")


def _event(school, reviewer=None):
    day = timezone.localdate() + timedelta(days=10)
    course = events.create_event(school.id, {
        "name": "Open season", "description": "Festa", "date": day.isoformat(), "start_time": "18:00",
        "duration_minutes": 90, "max_capacity": 12, "price": None, "min_booking_notice_hours": 0,
    }, submit=True)
    if reviewer is not None:
        events.approve_event(course, reviewer=reviewer)
    return course


def _owner_client(school):
    user = get_user_model().objects.create(
        email=f"owner-{uuid.uuid4().hex[:8]}@example.com", role=Role.SCHOOL, roles=[Role.SCHOOL], active_school=school,
    )
    SchoolMembership.objects.create(profile=user, school=school, sub_role="owner")
    api = APIClient()  # the section guard reads the JWT itself
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return api


# --- the variant itself ------------------------------------------------------


def test_variant_is_a_bounded_jpeg_next_to_the_original(media):
    url = _store(_noisy_jpeg())
    assert _on_disk(media, url).stat().st_size > SHARE_MAX_BYTES  # the live problem

    out = make_share_variant(url)

    assert out == url.rsplit(".", 1)[0] + SHARE_SUFFIX
    path = _on_disk(media, out)
    assert path.stat().st_size <= SHARE_MAX_BYTES
    with _open(path) as im:
        assert im.format == "JPEG" and im.mode == "RGB"
        assert im.size[0] == SHARE_MAX_SIDE and im.size[1] < SHARE_MAX_SIDE
    assert _on_disk(media, url).exists()  # the original is untouched


def test_phone_orientation_is_baked_in(media):
    # EXIF orientation 6 = "rotate 90° to display": crawlers ignore EXIF, so
    # the pixels themselves must be upright, and the tag must be gone.
    url = _store(_noisy_jpeg(exif_orientation=6))
    with _open(_on_disk(media, make_share_variant(url))) as im:
        assert im.size[1] == SHARE_MAX_SIDE and im.size[0] < SHARE_MAX_SIDE
        assert im.getexif().get(0x0112) in (None, 1)


def test_transparent_png_is_flattened_to_rgb(media):
    url = _store(_transparent_png(), name="poster.png")
    with _open(_on_disk(media, make_share_variant(url))) as im:
        assert im.format == "JPEG" and im.mode == "RGB"
        assert im.size == (SHARE_MAX_SIDE, 675)


def test_small_image_is_not_upscaled(media):
    url = _store(_noisy_jpeg(size=(640, 400)))
    with _open(_on_disk(media, make_share_variant(url))) as im:
        assert im.size == (640, 400)


def test_external_or_missing_image_gives_no_variant(media):
    assert make_share_variant("https://cdn.example.com/x.jpg") is None
    assert share_variant_for("https://cdn.example.com/x.jpg", create=True) is None
    assert make_share_variant("/media/public/courses/does-not-exist.jpg") is None
    assert make_share_variant("/media/public/../private/secret.jpg") is None
    assert make_share_variant("") is None


def test_share_variant_for_reports_dimensions_and_builds_on_demand(media):
    url = _store(_noisy_jpeg())
    assert share_variant_for(url) is None  # nothing built yet, and no create

    info = share_variant_for(url, create=True)

    assert info == {"url": url.rsplit(".", 1)[0] + SHARE_SUFFIX, "width": SHARE_MAX_SIDE, "height": info["height"]}
    assert 795 <= info["height"] <= 805
    assert share_variant_for(url) == info  # now it is there without create


def test_delete_public_removes_the_variant_too(media):
    url = _store(_noisy_jpeg())
    out = make_share_variant(url)
    delete_public(url)
    assert not _on_disk(media, url).exists() and not _on_disk(media, out).exists()


# --- where it is wired ------------------------------------------------------


def test_the_event_image_upload_builds_the_variant(media, school):
    course = _event(school)
    api = _owner_client(school)

    r = api.post(
        f"/api/school/events/{course.id}/image/",
        {"file": SimpleUploadedFile("poster.jpg", _noisy_jpeg(), content_type="image/jpeg")},
        format="multipart",
    )

    assert r.status_code == 200, r.content
    url = r.json()["image_url"]
    variant = _on_disk(media, url.rsplit(".", 1)[0] + SHARE_SUFFIX)
    assert variant.exists() and variant.stat().st_size <= SHARE_MAX_BYTES


def test_the_public_event_endpoint_carries_the_share_image(media, school, reviewer):
    # A photo uploaded before variants existed: no .share.jpg on disk yet,
    # the first crawler hit builds it.
    course = _event(school, reviewer)
    course.image_url = _store(_noisy_jpeg())
    course.save(update_fields=["image_url"])

    r = APIClient().get(f"/api/student/events/{course.slug}/")

    assert r.status_code == 200, r.content
    share = r.json()["share_image"]
    assert share["url"].endswith(SHARE_SUFFIX) and share["width"] == SHARE_MAX_SIDE and 795 <= share["height"] <= 805
    assert _on_disk(media, share["url"]).exists()
    assert r.json()["courses"]["image_url"] == course.image_url  # the page keeps the original


def test_the_public_event_endpoint_says_null_without_a_usable_photo(media, school, reviewer):
    course = _event(school, reviewer)
    course.image_url = "https://cdn.example.com/poster.jpg"
    course.save(update_fields=["image_url"])
    r = APIClient().get(f"/api/student/events/{course.slug}/")
    assert r.status_code == 200 and r.json()["share_image"] is None


def test_build_share_images_backfills_skips_and_forces(media, school):
    course = _event(school)
    course.image_url = _store(_noisy_jpeg())
    course.save(update_fields=["image_url"])
    external = _event(school)
    external.image_url = "https://cdn.example.com/poster.jpg"
    external.save(update_fields=["image_url"])

    def run(**kw):
        out = io.StringIO()
        call_command("build_share_images", stdout=out, **kw)
        return out.getvalue()

    assert "built 1, skipped 0, failed 0, external 1" in run()
    assert "built 0, skipped 1, failed 0, external 1" in run()
    assert "built 1, skipped 0, failed 0, external 1" in run(force=True)
