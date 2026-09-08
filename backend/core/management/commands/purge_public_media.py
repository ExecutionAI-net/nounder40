"""Incident cleanup for R3-C2: remove executable content from public media.

`save_public()` now refuses anything that is not a real jpeg/png/gif/webp and
stores it under an extension derived from its magic bytes (core/uploads.py),
so nothing new can land here. What it cannot do is undo what the old code
already wrote: the round-3 QA pass left `.html` and `.svg` blobs under
`/media/public/teacher-photos/` on the dev deployment, still served from the
app's own origin, and nothing in the product can delete a raw media file.

This walks `MEDIA_ROOT/public/` and reports every file the current upload
rules would refuse. It is read-only unless `--apply` is passed. Run it
through the "Ops - purge public media" workflow, which is the same SSM path
`qa_platform` uses.
"""

import os

from django.conf import settings
from django.core.management.base import BaseCommand

from core.uploads import InvalidImageUpload, validated_image_extension


class _LocalFile:
    """The little of Django's UploadedFile surface `validated_image_extension`
    needs, over a file already on disk."""

    def __init__(self, path: str):
        self.path = path
        self.size = os.path.getsize(path)

    def chunks(self, chunk_size=64 * 1024):
        with open(self.path, "rb") as fh:
            while True:
                chunk = fh.read(chunk_size)
                if not chunk:
                    return
                yield chunk


class Command(BaseCommand):
    help = "Report (or, with --apply, delete) files under MEDIA_ROOT/public/ that are not valid images."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true",
            help="Actually delete the offending files. Without it the command only reports.",
        )

    def handle(self, *args, **options):
        root = os.path.join(settings.MEDIA_ROOT, "public")
        if not os.path.isdir(root):
            self.stdout.write(f"no public media directory at {root}")
            return

        scanned = offending = deleted = 0
        for dirpath, _dirnames, filenames in os.walk(root):
            for filename in sorted(filenames):
                path = os.path.join(dirpath, filename)
                scanned += 1
                try:
                    validated_image_extension(_LocalFile(path))
                    continue
                except InvalidImageUpload as exc:
                    reason = exc.detail.get("error", "invalid")
                except OSError as exc:  # unreadable — report, never delete blindly
                    self.stdout.write(f"SKIP  {os.path.relpath(path, root)} ({exc})")
                    continue
                offending += 1
                relative = os.path.relpath(path, root).replace(os.sep, "/")
                if options["apply"]:
                    os.remove(path)
                    deleted += 1
                    self.stdout.write(f"DELETED  /media/public/{relative}  ({reason})")
                else:
                    self.stdout.write(f"WOULD DELETE  /media/public/{relative}  ({reason})")

        verb = "deleted" if options["apply"] else "would delete"
        self.stdout.write(f"scanned {scanned} file(s); {verb} {deleted if options['apply'] else offending}")
