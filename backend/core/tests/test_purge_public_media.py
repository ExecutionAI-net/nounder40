"""R3-C2 incident cleanup: `purge_public_media` must find exactly the files
the fixed `save_public()` would now refuse, and must not touch real images.

The round-3 pass left `.html`/`.svg` blobs under
`/media/public/teacher-photos/` on the dev deployment; no product path can
delete a raw media file, hence this command.
"""
import io
from pathlib import Path

import pytest
from django.core.management import call_command

pytestmark = pytest.mark.django_db


def _png_bytes():
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (10, 20, 30)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def media(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path)
    photos = Path(tmp_path) / "public" / "teacher-photos"
    photos.mkdir(parents=True)
    (photos / "c2cabceb.html").write_bytes(b"<script>alert(1)</script>")
    (photos / "66b9d849.svg").write_bytes(b'<svg onload="alert(1)"></svg>')
    (photos / "062e2f5f.png").write_bytes(_png_bytes())
    return photos


def _run(**kwargs):
    out = io.StringIO()
    call_command("purge_public_media", stdout=out, **kwargs)
    return out.getvalue()


def test_report_lists_the_offenders_and_deletes_nothing(media):
    output = _run()
    assert "/media/public/teacher-photos/c2cabceb.html" in output
    assert "/media/public/teacher-photos/66b9d849.svg" in output
    assert "062e2f5f.png" not in output
    assert (media / "c2cabceb.html").exists()
    assert sorted(p.name for p in media.iterdir()) == ["062e2f5f.png", "66b9d849.svg", "c2cabceb.html"]


def test_apply_deletes_only_the_offenders(media):
    output = _run(apply=True)
    assert "DELETED" in output
    assert [p.name for p in media.iterdir()] == ["062e2f5f.png"]


def test_missing_public_directory_is_not_an_error(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "nothing-here")
    assert "no public media directory" in _run()
