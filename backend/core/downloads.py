"""How a private file may be typed on the way back out.

The mirror image of `core/uploads.py`. That module decides what is allowed to
*enter* `/media/public/`; this one decides how the private tree's bytes are
*served*, because the private tree cannot be gated at upload time the way the
public one is: documents and chat attachments are legitimately PDFs, office
files and text, not just images.

Why this has to be decided here rather than by the caller: a private file
reaches the browser through `X-Accel-Redirect` into nginx's `internal`
`/internal-media/` location. That redirect carries the upstream's
`Content-Type` and `Content-Disposition` through to the browser and drops
Django's other headers, so the type declared here is the last word — and
`nosniff` has to be re-added on the nginx location. Both callers used to hand
`private_accel_response()` a value the attacker writes (chat took it from the
`?mime=` query string, student documents from the uploader's own
`Content-Type` header), so a `.txt` full of `<script>` came back as
`text/html`, inline, on the SPA's own origin — the same session-theft
primitive R3-C2 was, minus the extension trick, since here the type is
declared outright rather than inferred from a filename.

So the served type comes from the stored bytes, and only a short list of
formats that a browser renders *inertly* keeps `inline`:

* the four raster images the upload widgets offer, so `<img src>` still works;
* PDF, because opening a certificate in the tab is the whole point of the
  documents panel;
* text, as `text/plain` — inert only because nginx's `/internal-media/`
  location sends `nosniff`, without which a browser may sniff a text body
  back into HTML and undo the entire fix.

Everything else — office files, archives, anything unrecognised — is served
`application/octet-stream` as an `attachment`, which no browser renders.
Notably absent: SVG and HTML, which execute script when opened directly.
"""

# (magic bytes at offset 0, served type). Same signatures core/uploads.py
# sniffs, plus PDF; kept separate because that list answers a different
# question ("may this be stored under /media/public/?") and must stay
# images-only.
_INLINE_SIGNATURES = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"%PDF-", "application/pdf"),
)

DEFAULT_TYPE = "application/octet-stream"

# Control characters that do not appear in ordinary text. Their presence in
# the sniffed prefix is what separates a text file from a binary one.
_BINARY_CONTROL = bytes(b for b in range(0x20) if b not in (0x09, 0x0A, 0x0C, 0x0D)) + b"\x7f"

# Enough to cover every signature above with room to spare, and enough text
# to judge a prefix by. Read off disk on every download, so kept small.
SNIFF_BYTES = 512


def _looks_like_text(head: bytes) -> bool:
    if not head:
        return False
    if any(byte in _BINARY_CONTROL for byte in head):
        return False
    try:
        head.decode("utf-8")
    except UnicodeDecodeError:
        # A prefix cut mid-codepoint is still text; anything else is not.
        try:
            head[:-3].decode("utf-8")
        except UnicodeDecodeError:
            return False
    return True


def served_type(head: bytes) -> tuple[str, bool]:
    """`(content_type, inline)` for a private file, from its leading bytes."""
    for magic, content_type in _INLINE_SIGNATURES:
        if head.startswith(magic):
            return content_type, True
    # RIFF....WEBP — the size field sits between the two markers.
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp", True
    if _looks_like_text(head):
        return "text/plain; charset=utf-8", True
    return DEFAULT_TYPE, False
