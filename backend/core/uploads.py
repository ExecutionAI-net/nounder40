"""What may end up under `/media/public/` (R3-C2).

`/media/public/` is the **same origin** as the SPA and is served by nginx
straight off disk, with the content type derived from the stored filename's
extension. `save_public()` used to keep whatever extension the uploader sent,
and no call site checked the bytes, so
`POST /api/teacher/<id>/image/` with `file=evil.html` landed at
`/media/public/teacher-photos/<uuid>.html` and came back as `text/html` — an
inline `<script>` in it runs on the app's own origin, where the JWT lives in
`localStorage` (CLAUDE.md invariant #1). The lowest-trust authenticated role
(a self-onboarded teacher) could mint a session-theft link and hand it to a
victim over the in-app chat. Scripted `.svg` was the same story.

Three of the eight public-upload call sites did check `file.content_type`
first — but that header is written by the client, so it stopped nobody; and
even a truthful `image/png` header was never what decided the extension on
disk. So the check does not live in the views: it lives in `save_public()`,
the one function all of them go through. Guarding call sites one at a time is
exactly the pattern that let R3-C1 survive PR #86.

Two gates, in order:

1. **magic bytes** decide both "is this an image at all" and — the part that
   actually closes the hole — the extension we store it under. A file's own
   name never reaches the disk, so nothing under `/media/public/` can be
   `.html`, `.svg` or anything else nginx would hand back as a document.
2. **Pillow** must then be able to parse it as that same format, so a
   4-byte PNG header glued in front of a payload is rejected too.

SVG is deliberately not on the list: it is a scriptable document format, and
every upload widget in the frontend already offers only jpeg/png/webp/gif.
"""

import io

from rest_framework.exceptions import APIException

# The three call sites that capped anything used 4 MB; this is the backstop
# for the five that never capped anything at all (teacher photos, course,
# package and subscription images, lesson types).
MAX_PUBLIC_IMAGE_BYTES = 8 * 1024 * 1024

# (magic bytes at offset 0, canonical extension, Pillow format name).
_SIGNATURES = (
    (b"\xff\xd8\xff", ".jpg", "JPEG"),
    (b"\x89PNG\r\n\x1a\n", ".png", "PNG"),
    (b"GIF87a", ".gif", "GIF"),
    (b"GIF89a", ".gif", "GIF"),
)


class InvalidImageUpload(APIException):
    """400 in the `{"error": "..."}` shape the upload endpoints already use."""

    status_code = 400

    def __init__(self, code: str):
        super().__init__({"error": code})


def _sniff(head: bytes):
    for magic, ext, pil_format in _SIGNATURES:
        if head.startswith(magic):
            return ext, pil_format
    # RIFF....WEBP — the size field sits between the two markers.
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp", "WEBP"
    return None


def validated_image_extension(file) -> str:
    """The extension a public upload may be stored under.

    Raises `InvalidImageUpload` for anything that is not a jpeg/png/gif/webp
    the imaging library can actually parse. Leaves `file` rewound so the
    caller can still write it out.
    """
    size = getattr(file, "size", None)
    if size is not None and size > MAX_PUBLIC_IMAGE_BYTES:
        raise InvalidImageUpload("too_large")

    # Read once into memory rather than seeking the uploaded file around:
    # Pillow's verify() may close the stream it was handed, and the size cap
    # above already bounds this at 8 MB.
    data = b"".join(file.chunks())
    if size is None and len(data) > MAX_PUBLIC_IMAGE_BYTES:
        raise InvalidImageUpload("too_large")

    sniffed = _sniff(data[:32])
    if sniffed is None:
        raise InvalidImageUpload("invalid_type")
    ext, pil_format = sniffed

    from PIL import Image

    try:
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
            parsed_format = image.format
    except Exception:
        # Pillow raises a zoo of types (UnidentifiedImageError, OSError,
        # DecompressionBombError, SyntaxError...) — all of them mean the same
        # thing here: not an image we are willing to serve back.
        raise InvalidImageUpload("invalid_type") from None
    if parsed_format != pil_format:
        raise InvalidImageUpload("invalid_type")

    if hasattr(file, "seek"):
        file.seek(0)
    return ext
