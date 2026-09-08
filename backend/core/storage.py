"""
Local media storage split into two trees:

  MEDIA_ROOT/public/...   served directly (nginx passthrough at /media/public/)
  MEDIA_ROOT/private/...  NEVER served directly — no URL route maps to it at
                           all, so a guessed path 404s. The only way out is a
                           permission-checked Django view that returns an
                           X-Accel-Redirect to nginx's `internal` location,
                           which streams the file after Django has already
                           verified the requester may see it.

django-storages/S3 is in requirements.txt for a later swap (set STORAGES to a
S3Boto3Storage-backed default); the private-serving *view* layer doesn't need
to change since it works off a relative key + permission check, not a
filesystem path directly.
"""

import mimetypes
import os
import uuid
from urllib.parse import quote

from django.conf import settings
from django.http import HttpResponse

from .downloads import SNIFF_BYTES, served_type
from .uploads import validated_image_extension


def _unique_name(original_name: str) -> str:
    ext = os.path.splitext(original_name)[1]
    return f"{uuid.uuid4()}{ext}"


def _write(file, *, root: str, key: str) -> None:
    dest = os.path.join(root, key)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as out:
        for chunk in file.chunks():
            out.write(chunk)


def save_private(file, *, subdir: str) -> dict:
    """Save under MEDIA_ROOT/private/<subdir>/. Returns a relative key
    (never a fetchable URL) to store in the DB alongside name/mime/size."""
    key = f"{subdir}/{_unique_name(file.name)}"
    _write(file, root=os.path.join(settings.MEDIA_ROOT, "private"), key=key)
    return {
        "path": key,
        "name": file.name,
        "mime": file.content_type or mimetypes.guess_type(file.name)[0] or "application/octet-stream",
        "size": file.size,
    }


def save_public(file, *, subdir: str) -> str:
    """Save under MEDIA_ROOT/public/<subdir>/. Returns the public URL.

    R3-C2: this used to keep the uploader's own extension (`_unique_name`),
    and none of its eight call sites looked at the bytes. `/media/public/` is
    the SPA's own origin and nginx types it from the extension, so an
    uploaded `.html`/`.svg` came back as an executable document and could
    read the JWT out of `localStorage`. The extension now comes from the
    file's magic bytes, and anything that is not a real jpeg/png/gif/webp
    raises `InvalidImageUpload` (400) — enforced here, in the one function
    every public upload goes through, rather than per view where a new
    endpoint can forget it (see core/uploads.py).
    """
    ext = validated_image_extension(file)
    key = f"{subdir}/{uuid.uuid4()}{ext}"
    _write(file, root=os.path.join(settings.MEDIA_ROOT, "public"), key=key)
    return f"{settings.MEDIA_URL}public/{key}"


def delete_public(url: str) -> None:
    """Best-effort delete of a save_public() URL's underlying file."""
    prefix = f"{settings.MEDIA_URL}public/"
    if not url or not url.startswith(prefix):
        return
    path = os.path.join(settings.MEDIA_ROOT, "public", url[len(prefix):])
    try:
        os.remove(path)
    except OSError:
        pass


def _content_disposition(disposition: str, filename: str) -> str:
    """`filename` is caller-supplied too — chat reads it from `?name=`."""
    name = (filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    # A quote would close the quoted-string early and let the caller append
    # its own parameters; control characters and path separators have no
    # business in a download name either.
    name = "".join(ch for ch in name if ch.isprintable() and ch != '"').strip() or "file"
    try:
        name.encode("ascii")
    except UnicodeEncodeError:
        return f"{disposition}; filename*=utf-8''{quote(name)}"
    return f'{disposition}; filename="{name}"'


def private_accel_response(key: str, *, filename: str) -> HttpResponse:
    """Hand nginx a permission-checked private file, typed from its bytes.

    There is deliberately no `content_type` argument any more: `/internal-
    media/` adds no headers of its own, so this response's `Content-Type` is
    what the browser acts on, and both callers used to take it from the
    requester (chat from `?mime=`, documents from the uploader's own header).
    A `.txt` full of `<script>` came back as inline `text/html` on the app's
    own origin — R3-C2's session-theft primitive on the private tree. What we
    serve now follows the stored bytes (core/downloads.py); the uploader's
    `files[].mime` survives only as display metadata.
    """
    root = os.path.realpath(os.path.join(settings.MEDIA_ROOT, "private"))
    path = os.path.realpath(os.path.join(root, key))
    # Reading the header ourselves would otherwise turn a key that climbs out
    # of the private root into an arbitrary-read primitive: chat only checks
    # that the key *starts with* its conversation's prefix.
    if path != root and not path.startswith(root + os.sep):
        return HttpResponse(status=404)
    try:
        with open(path, "rb") as fh:
            head = fh.read(SNIFF_BYTES)
    except OSError:
        return HttpResponse(status=404)

    content_type, inline = served_type(head)
    response = HttpResponse(content_type=content_type)
    response["X-Accel-Redirect"] = f"/internal-media/{key}"
    response["Content-Disposition"] = _content_disposition("inline" if inline else "attachment", filename)
    # `nosniff` is what makes the text/plain branch inert: without it a
    # browser may sniff a text body back into HTML on the app's own origin.
    # nginx keeps only Content-Type and Content-Disposition across an
    # X-Accel-Redirect and drops everything else, so this copy is for anyone
    # serving the response directly (DEBUG, a later S3 swap) -- the one the
    # browser actually receives is the one nginx's /internal-media/ location
    # re-adds (nginx/nginx.conf, nginx/nginx-app.conf) -- out of pytest's
    # reach, since the test container only mounts ./backend.
    response["X-Content-Type-Options"] = "nosniff"
    return response
