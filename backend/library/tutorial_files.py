"""PDF attachments of `Tutorial` rows.

They go through `core.storage.save_private()`, not `save_public()`: the
public tree is gated to real images (core/uploads.py) and nginx serves it
with a sandbox CSP that disables the browser's PDF viewer. The private tree
is typed from its bytes on the way out (core/downloads.py), so a real PDF
opens inline in the tab — which is what a tutorial is for. What is checked
here is only that the upload *is* a PDF and is not absurdly large; the
serving side never trusts the uploader's name or Content-Type anyway.
"""

from rest_framework.exceptions import APIException

from core.storage import delete_private, save_private

MAX_TUTORIAL_PDF_BYTES = 20 * 1024 * 1024

_PDF_MAGIC = b"%PDF-"


class InvalidTutorialFile(APIException):
    """400 in the `{"error": "..."}` shape the upload endpoints already use."""

    status_code = 400

    def __init__(self, code: str):
        super().__init__({"error": code})


def validate_pdf(file) -> None:
    size = getattr(file, "size", None)
    if size is not None and size > MAX_TUTORIAL_PDF_BYTES:
        raise InvalidTutorialFile("too_large")
    head = file.read(len(_PDF_MAGIC))
    if hasattr(file, "seek"):
        file.seek(0)
    if not head.startswith(_PDF_MAGIC):
        raise InvalidTutorialFile("invalid_type")


def _display_name(name: str) -> str:
    # Basename only, and never an empty label on the student page.
    base = (name or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    return (base or "tutorial.pdf")[:255]


def store_tutorial_pdf(tutorial, file) -> None:
    """Validate, save, point the row at the new key, drop the previous blob."""
    validate_pdf(file)
    previous = tutorial.file_path
    info = save_private(file, subdir="tutorials")
    tutorial.file_path = info["path"]
    tutorial.file_name = _display_name(info["name"])
    tutorial.file_size = info["size"]
    tutorial.save(update_fields=["file_path", "file_name", "file_size", "updated_at"])
    if previous and previous != tutorial.file_path:
        delete_private(previous)


def delete_tutorial_pdf(tutorial, *, save: bool = True) -> None:
    if not tutorial.file_path:
        return
    delete_private(tutorial.file_path)
    tutorial.file_path = ""
    tutorial.file_name = ""
    tutorial.file_size = None
    if save:
        tutorial.save(update_fields=["file_path", "file_name", "file_size", "updated_at"])
