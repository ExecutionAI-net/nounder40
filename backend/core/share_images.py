"""Share-preview variant of a public image, sized for WhatsApp.

The Open Graph image of a special event (frontend lib/event-share-metadata.ts)
used to be the course photo exactly as the school uploaded it. Facebook,
LinkedIn and Zoho Cliq render that; WhatsApp does not: it drops the picture
silently above ~600 KB (Meta's documented ceiling, ~300 KB in practice) and
shows the card with text only. A phone photo is 1-5 MB — the live "OPEN
SEASON" event shipped a 2048x1365 JPEG of 615 KB.

`make_share_variant()` writes `<name>.share.jpg` next to the original:
EXIF orientation baked in, transparency flattened on white, at most
`SHARE_MAX_SIDE` px on the long side, JPEG quality stepped down until the
file fits `SHARE_MAX_BYTES`. It is built at upload (CourseImageUploadView),
on first request by the public event endpoint for photos uploaded before
this existed (`share_variant_for(..., create=True)`), and in bulk by
`manage.py build_share_images`.

The variant is a real JPEG under /media/public/, so `purge_public_media`
leaves it alone; `delete_public()` removes it together with its original.
"""

import io
import logging
import os
import uuid

from django.conf import settings
from django.core.cache import cache

log = logging.getLogger(__name__)

SHARE_SUFFIX = ".share.jpg"
SHARE_MAX_SIDE = 1200
# Comfortably under the 300 KB where WhatsApp starts dropping images
SHARE_MAX_BYTES = 250 * 1024
_QUALITIES = (85, 80, 75, 70, 60, 50, 40)
# A busy texture can stay over the cap even at quality 40: then a smaller
# side, never below what WhatsApp wants for the large card (300 px)
_SIDES = (SHARE_MAX_SIDE, 1000, 800, 640)
# A build that failed is not tried again for a while: the public event
# endpoint would otherwise redo the whole decode on every crawler hit
_FAILED_TTL = 15 * 60


def _failed_key(url: str) -> str:
    return f"share-variant-failed:{url}"


def _failed_recently(url: str) -> bool:
    try:
        return bool(cache.get(_failed_key(url)))
    except Exception:  # the cache is a convenience here, never a gate
        return False


def _remember(url: str, failed: bool) -> None:
    try:
        if failed:
            cache.set(_failed_key(url), True, _FAILED_TTL)
        else:
            cache.delete(_failed_key(url))
    except Exception:
        pass


def _public_prefix() -> str:
    return f"{settings.MEDIA_URL}public/"


def is_public_media_url(url) -> bool:
    """A save_public() URL — not an external image, not a variant itself."""
    return bool(url) and url.startswith(_public_prefix()) and not url.endswith(SHARE_SUFFIX)


def _paths(url: str):
    """(original path, variant path, variant URL) for a public media URL;
    None when the URL is external or would climb out of the public tree."""
    if not is_public_media_url(url):
        return None
    key = url[len(_public_prefix()):]
    root = os.path.realpath(os.path.join(settings.MEDIA_ROOT, "public"))
    src = os.path.realpath(os.path.join(root, key))
    if not src.startswith(root + os.sep):
        return None
    stem_key, _ext = os.path.splitext(key)
    return src, os.path.splitext(src)[0] + SHARE_SUFFIX, f"{_public_prefix()}{stem_key}{SHARE_SUFFIX}"


def _flatten(im):
    """RGB on white: JPEG has no alpha, and a transparent PNG poster would
    otherwise come out black where it was see-through."""
    from PIL import Image

    if im.mode == "RGB":
        return im
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        rgba = im.convert("RGBA")
        flat = Image.new("RGB", rgba.size, (255, 255, 255))
        flat.paste(rgba, mask=rgba.getchannel("A"))
        return flat
    return im.convert("RGB")


def _encode(im) -> bytes:
    """JPEG bytes under SHARE_MAX_BYTES: the quality steps first, then a
    smaller side. The smallest attempt comes back when none fits, and the
    caller says so in the log."""
    from PIL import Image

    best = b""
    for side in _SIDES:
        scaled = im.copy()
        scaled.thumbnail((side, side), Image.Resampling.LANCZOS)
        for quality in _QUALITIES:
            buf = io.BytesIO()
            scaled.save(buf, "JPEG", quality=quality, optimize=True)
            data = buf.getvalue()
            if not best or len(data) < len(best):
                best = data
            if len(data) <= SHARE_MAX_BYTES:
                return data
    return best


def _image_size(path: str):
    try:
        from PIL import Image

        with Image.open(path) as im:
            return im.size
    except Exception:
        return None


def make_share_variant(url, *, force: bool = False) -> str | None:
    """Build (or rebuild) the variant of a public image. Returns its URL, or
    None when there is nothing to build from — never raises: a preview must
    not break an upload. A build that failed lately is skipped unless
    `force` (the backfill command's flag)."""
    paths = _paths(url)
    if paths is None:
        return None
    if not force and _failed_recently(url):
        return None
    src, dst, out_url = paths
    # Own temp name per build: two requests can build the same variant at
    # once (the page and a crawler on a fresh link), and daphne runs them in
    # threads of one process — os.replace then makes the last one win whole
    tmp = f"{dst}.tmp-{uuid.uuid4().hex}"
    try:
        from PIL import Image, ImageOps

        with Image.open(src) as original:
            im = ImageOps.exif_transpose(original) or original
            im = _flatten(im)
            im.thumbnail((SHARE_MAX_SIDE, SHARE_MAX_SIDE), Image.Resampling.LANCZOS)
            data = _encode(im)
        if len(data) > SHARE_MAX_BYTES:
            log.warning("share variant for %s is %d bytes, over the %d cap", url, len(data), SHARE_MAX_BYTES)
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, dst)
    except Exception:
        # Missing file, unreadable bytes, decompression bomb, full disk: the
        # preview falls back to the original image, and the log says why.
        log.warning("share variant not built for %s", url, exc_info=True)
        _remember(url, failed=True)
        try:
            os.remove(tmp)
        except OSError:
            pass
        return None
    _remember(url, failed=False)
    return out_url


def share_variant_for(url, *, create: bool = False) -> dict | None:
    """`{"url", "width", "height"}` of the variant when it exists (built on
    the spot with `create=True`), else None so the caller can fall back."""
    paths = _paths(url)
    if paths is None:
        return None
    _src, dst, out_url = paths
    if not os.path.isfile(dst) and (not create or make_share_variant(url) is None):
        return None
    size = _image_size(dst)
    if size is None and create:
        # On disk but unreadable (a write that never finished): built again
        if make_share_variant(url, force=True) is None:
            return None
        size = _image_size(dst)
    if size is None:
        return None
    width, height = size
    return {"url": out_url, "width": width, "height": height}


def delete_share_variant(url) -> None:
    paths = _paths(url)
    if paths is None:
        return
    try:
        os.remove(paths[1])
    except OSError:
        pass
