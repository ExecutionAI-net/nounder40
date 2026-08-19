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

from django.conf import settings
from django.http import HttpResponse


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
    """Save under MEDIA_ROOT/public/<subdir>/. Returns the public URL."""
    key = f"{subdir}/{_unique_name(file.name)}"
    _write(file, root=os.path.join(settings.MEDIA_ROOT, "public"), key=key)
    return f"{settings.MEDIA_URL}public/{key}"


def private_accel_response(key: str, *, filename: str, content_type: str) -> HttpResponse:
    response = HttpResponse(content_type=content_type)
    response["X-Accel-Redirect"] = f"/internal-media/{key}"
    response["Content-Disposition"] = f'inline; filename="{filename}"'
    return response
