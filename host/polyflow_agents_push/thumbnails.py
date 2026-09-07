"""First-page thumbnails for artifacts, rendered on the host.

A card in the chat wants to *look like* the thing it opens — a picture, a page
— and a phone cannot rasterise a PDF, an HTML file or a Word document itself.
The host can, with tools it very likely already has, so each artifact gets
one PNG thumbnail, rendered lazily on the first request and kept beside the
bytes:

    files/<id>.thumb.png      the thumbnail
    files/<id>.thumb.sha      the sha256 it was rendered from, or `miss:<sha>`

Everything here is best-effort and optional. The plugin stays stdlib-only at
import time; each renderer is probed when it is needed and a missing one is a
404 the app falls back from, not an error:

| what                    | how                                              |
|-------------------------|--------------------------------------------------|
| images                  | Pillow, `thumbnail()`                            |
| PDF                     | `pdftoppm`, first page                           |
| HTML                    | headless Chromium screenshot, else LibreOffice   |
| Word / Excel / Pptx …   | LibreOffice → PDF → `pdftoppm`                   |
| text, code, data        | Pillow draws the first page in a monospace font  |

Renders run on a worker thread (`asyncio.to_thread` in the route), one at a
time per artifact, so a burst of cards for the same file costs one render and
LibreOffice never gets two concurrent conversions of one document. A render
that fails is remembered for an hour, so a broken file does not cost a
Chromium launch on every scroll.
"""

from __future__ import annotations

import glob
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

from . import artifacts

logger = logging.getLogger(__name__)

# Longest edge of a thumbnail. Enough for a card and a grid tile at 3× density.
THUMB_EDGE = 512

# US letter at 96 dpi: what a page renders as before it is shrunk.
PAGE_WIDTH, PAGE_HEIGHT = 816, 1056

# How long each renderer gets. Chromium and LibreOffice are cold starts.
CHROMIUM_TIMEOUT = 20
LIBREOFFICE_TIMEOUT = 45
PDFTOPPM_TIMEOUT = 20

# A failed render is not retried for this long.
MISS_TTL_SECONDS = 3600

OFFICE_MIMES = frozenset(
    {
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "application/vnd.ms-powerpoint",
        "application/vnd.oasis.opendocument.text",
        "application/vnd.oasis.opendocument.spreadsheet",
        "application/vnd.oasis.opendocument.presentation",
        "application/rtf",
        "application/epub+zip",
    }
)

TEXT_MIMES = frozenset(
    {"application/json", "application/jsonl", "application/yaml", "application/toml", "application/xml", "application/x-sh", "application/javascript"}
)

# Where a Chromium may be. `POLYFLOW_ARTIFACT_CHROMIUM` wins; then PATH names;
# then the Playwright cache Hermes's own browser tooling leaves behind.
CHROMIUM_ENV = "POLYFLOW_ARTIFACT_CHROMIUM"
CHROMIUM_NAMES = ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome")
CHROMIUM_GLOBS = (
    "~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome",
    "~/.cache/ms-playwright/chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium",
    "~/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux*/headless_shell",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
)

FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/Monaco.ttf",
)

_locks: Dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(artifact_id: str) -> threading.Lock:
    with _locks_guard:
        lock = _locks.get(artifact_id)

        if lock is None:
            lock = threading.Lock()
            _locks[artifact_id] = lock

        return lock


# ── Availability ─────────────────────────────────────────────────────────────


def has_pillow() -> bool:
    try:
        import PIL  # noqa: F401

        return True
    except Exception:
        return False


def has_pdftoppm() -> bool:
    return shutil.which("pdftoppm") is not None


def has_libreoffice() -> bool:
    return shutil.which("libreoffice") is not None or shutil.which("soffice") is not None


def chromium_binary() -> Optional[str]:
    override = os.environ.get(CHROMIUM_ENV, "").strip()

    if override and Path(override).is_file():
        return override

    for name in CHROMIUM_NAMES:
        found = shutil.which(name)

        if found:
            return found

    for pattern in CHROMIUM_GLOBS:
        matches = sorted(glob.glob(os.path.expanduser(pattern)))

        if matches:
            return matches[-1]

    return None


def can_render(row: Dict[str, Any]) -> bool:
    """Whether some renderer here would take this artifact on. Cheap; no rendering."""
    kind = str(row.get("kind") or "")
    mime = str(row.get("mime_type") or "")

    if kind == "image":
        return has_pillow()
    if mime == "application/pdf":
        return has_pdftoppm()
    if mime == "text/html":
        return chromium_binary() is not None or (has_libreoffice() and has_pdftoppm())
    if mime in OFFICE_MIMES:
        return has_libreoffice() and has_pdftoppm()
    if _is_text(kind, mime):
        return has_pillow()

    return False


def _is_text(kind: str, mime: str) -> bool:
    if kind in ("image", "video", "audio"):
        return False

    return mime.startswith("text/") or mime in TEXT_MIMES or kind == "code"


# ── The cache ────────────────────────────────────────────────────────────────


def ensure(row: Dict[str, Any]) -> Optional[Path]:
    """The thumbnail for one artifact, rendering it if there is none. None when nothing here can.

    Never raises: a renderer that blows up is logged, remembered as a miss, and
    answered with None — the card shows a glyph instead.
    """
    thumb = artifacts.thumbnail_path(row)
    marker = artifacts.thumbnail_marker_path(row)
    sha = str(row["sha256"])

    if _fresh(thumb, marker, sha):
        return thumb
    if _recent_miss(marker, sha):
        return None

    with _lock_for(str(row["id"])):
        # Another request may have rendered it while this one waited.
        if _fresh(thumb, marker, sha):
            return thumb
        if _recent_miss(marker, sha):
            return None

        rendered = False

        try:
            rendered = _render(row, thumb)
        except Exception:
            logger.info("[polyflow_agents_push] thumbnail for %s failed", row.get("name"), exc_info=True)

        try:
            marker.write_text(sha if rendered else f"miss:{sha}")
        except OSError:
            pass

        return thumb if rendered and thumb.is_file() else None


def _fresh(thumb: Path, marker: Path, sha: str) -> bool:
    try:
        return thumb.is_file() and marker.read_text().strip() == sha
    except OSError:
        return False


def _recent_miss(marker: Path, sha: str) -> bool:
    try:
        if marker.read_text().strip() != f"miss:{sha}":
            return False

        return time.time() - marker.stat().st_mtime < MISS_TTL_SECONDS
    except OSError:
        return False


# ── Renderers ────────────────────────────────────────────────────────────────


def _render(row: Dict[str, Any], out: Path) -> bool:
    source = artifacts.file_path(row)

    if not source.is_file():
        return False

    kind = str(row.get("kind") or "")
    mime = str(row.get("mime_type") or "")

    if kind == "image":
        return _from_image(source, out)
    if mime == "application/pdf":
        return _from_pdf(source, out)
    if mime == "text/html":
        return _from_html(source, out) or _via_libreoffice(source, out)
    if mime in OFFICE_MIMES:
        return _via_libreoffice(source, out)
    if _is_text(kind, mime):
        return _from_text(source, out)

    return False


def _atomic_replace(tmp: Path, out: Path) -> None:
    os.replace(tmp, out)


def _from_image(source: Path, out: Path) -> bool:
    if not has_pillow():
        return False

    from PIL import Image, ImageOps

    with Image.open(source) as image:
        # Phone pictures arrive rotated by an EXIF flag rather than in place.
        image = ImageOps.exif_transpose(image)

        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")

        image.thumbnail((THUMB_EDGE, THUMB_EDGE))

        tmp = out.with_suffix(".tmp.png")
        image.save(tmp, format="PNG", optimize=True)

    _atomic_replace(tmp, out)

    return True


def _from_pdf(source: Path, out: Path) -> bool:
    if not has_pdftoppm():
        return False

    with tempfile.TemporaryDirectory(prefix="polyflow-thumb-") as tmpdir:
        prefix = Path(tmpdir) / "page"
        subprocess.run(
            ["pdftoppm", "-png", "-f", "1", "-l", "1", "-singlefile", "-scale-to", str(THUMB_EDGE), str(source), str(prefix)],
            check=True,
            timeout=PDFTOPPM_TIMEOUT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        rendered = prefix.with_suffix(".png")

        if not rendered.is_file():
            return False

        shutil.move(str(rendered), str(out))

    return True


def _from_html(source: Path, out: Path) -> bool:
    chromium = chromium_binary()

    if chromium is None:
        return False

    with tempfile.TemporaryDirectory(prefix="polyflow-thumb-") as tmpdir:
        shot = Path(tmpdir) / "shot.png"
        subprocess.run(
            [
                chromium,
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--hide-scrollbars",
                "--no-first-run",
                "--disable-extensions",
                f"--user-data-dir={tmpdir}/profile",
                f"--window-size={PAGE_WIDTH},{PAGE_HEIGHT}",
                f"--screenshot={shot}",
                source.resolve().as_uri(),
            ],
            check=True,
            timeout=CHROMIUM_TIMEOUT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        if not shot.is_file():
            return False

        _shrink(shot, out)

    return True


def _via_libreoffice(source: Path, out: Path) -> bool:
    binary = shutil.which("libreoffice") or shutil.which("soffice")

    if binary is None or not has_pdftoppm():
        return False

    with tempfile.TemporaryDirectory(prefix="polyflow-thumb-") as tmpdir:
        # A private profile: a conversion must not collide with a LibreOffice
        # someone has open, and the default profile takes a lock.
        profile = Path(tmpdir) / "profile"
        subprocess.run(
            [
                binary,
                f"-env:UserInstallation={profile.as_uri()}",
                "--headless",
                "--convert-to",
                "pdf",
                "--outdir",
                tmpdir,
                str(source),
            ],
            check=True,
            timeout=LIBREOFFICE_TIMEOUT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        pdfs = list(Path(tmpdir).glob("*.pdf"))

        if not pdfs:
            return False

        return _from_pdf(pdfs[0], out)


def _from_text(source: Path, out: Path) -> bool:
    """The first page of a text file, drawn — so a report reads as a report at a glance."""
    if not has_pillow():
        return False

    from PIL import Image, ImageDraw

    text = source.read_bytes()[:12_000].decode("utf-8", errors="replace").replace("\t", "    ")
    font, line_height = _mono_font(15)
    margin = 56
    columns = max(20, int((PAGE_WIDTH - 2 * margin) / (font_width(font) or 9)))
    lines = []

    for raw in text.splitlines():
        if not raw.strip():
            lines.append("")
            continue

        while len(raw) > columns:
            lines.append(raw[:columns])
            raw = raw[columns:]

        lines.append(raw)

        if len(lines) * line_height > PAGE_HEIGHT - 2 * margin:
            break

    page = Image.new("RGB", (PAGE_WIDTH, PAGE_HEIGHT), "white")
    draw = ImageDraw.Draw(page)
    y = margin

    for line in lines:
        if y + line_height > PAGE_HEIGHT - margin:
            break

        draw.text((margin, y), line, fill=(31, 41, 55), font=font)
        y += line_height

    page.thumbnail((THUMB_EDGE, THUMB_EDGE))

    tmp = out.with_suffix(".tmp.png")
    page.save(tmp, format="PNG", optimize=True)
    _atomic_replace(tmp, out)

    return True


def _mono_font(size: int):
    from PIL import ImageFont

    for candidate in FONT_CANDIDATES:
        if Path(candidate).is_file():
            try:
                return ImageFont.truetype(candidate, size), int(size * 1.35)
            except Exception:
                continue

    try:
        return ImageFont.load_default(size=size), int(size * 1.35)  # Pillow ≥ 10.1
    except TypeError:
        return ImageFont.load_default(), 14


def font_width(font: Any) -> int:
    """Advance of one character in a monospace font; the column count comes from it."""
    try:
        left, _top, right, _bottom = font.getbbox("M")

        return int(right - left) or 0
    except Exception:
        return 0


def _shrink(rendered: Path, out: Path) -> None:
    """Fit a full-size render into the thumbnail edge; without Pillow, keep it whole."""
    if has_pillow():
        from PIL import Image

        with Image.open(rendered) as image:
            image = image.convert("RGB")
            image.thumbnail((THUMB_EDGE, THUMB_EDGE))
            tmp = out.with_suffix(".tmp.png")
            image.save(tmp, format="PNG", optimize=True)

        _atomic_replace(tmp, out)
    else:
        shutil.move(str(rendered), str(out))
