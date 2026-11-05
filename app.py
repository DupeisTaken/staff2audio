"""Loopback-only web app. Scores are decoded in memory and never persisted."""
from __future__ import annotations

import base64
from contextlib import asynccontextmanager
import io
import math
import threading
import time
import warnings
from pathlib import Path

import fitz
import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.formparsers import MultiPartException, MultiPartParser
from starlette.datastructures import UploadFile
from starlette.concurrency import run_in_threadpool

from staff2audio.omr import recognize

ROOT = Path(__file__).resolve().parent
MAX_BYTES = 25 * 1024 * 1024
MAX_PIXELS = 30_000_000
MAX_EDGE = 2600
# Serial CV work keeps the desktop responsive and bounds image memory.
recognition_lock = threading.RLock()
app = FastAPI(title="Prima · Local score to piano", docs_url=None, redoc_url=None)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])


class LocalOnlyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        origin = request.headers.get("origin")
        # Prevent an unrelated website from posting private local files to the service.
        if origin and origin not in {f"http://{request.headers.get('host')}", f"https://{request.headers.get('host')}"}:
            from starlette.responses import JSONResponse
            return JSONResponse({"detail": "Use this app from its local browser tab."}, status_code=403)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        return response


app.add_middleware(LocalOnlyMiddleware)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


@app.get("/")
def home():
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/api/health")
def health():
    return {"status": "ok", "local": True}


def validate_file_bytes(data: bytes):
    """Check the file bound before metadata parsing or decompression."""
    if not data:
        raise ValueError("Choose a screenshot or PDF first.")
    if len(data) > MAX_BYTES:
        raise ValueError("This file exceeds 25 MB. Try a cropped screenshot or a smaller PDF.")


def validate_pdf_page(page):
    dimensions = (page.rect.width, page.rect.height)
    if not all(math.isfinite(value) and 0 < value < 100_000 for value in dimensions):
        raise ValueError("This PDF page has invalid dimensions.")


def validate_pdf_document(document):
    if document.needs_pass:
        raise ValueError("This PDF is password protected. Use an unlocked copy or screenshot.")
    count = len(document)
    if count < 1:
        raise ValueError("This PDF has no pages.")
    return count


def inspect_score(data: bytes) -> dict:
    """Read the page inventory independently of whether any staff can be found."""
    validate_file_bytes(data)
    if data[:5] == b"%PDF-":
        try:
            with fitz.open(stream=data, filetype="pdf") as document:
                count = validate_pdf_document(document)
                # Page geometry is checked only when that page is decoded. One
                # malformed page must not hide the rest of a readable document.
                return {"pages": count, "kind": "pdf"}
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("This PDF could not be read. Try a screenshot of the staff.") from exc
    decode_score(data)
    return {"pages": 1, "kind": "image"}


def decode_score(data: bytes, page_number: int = 1) -> tuple[np.ndarray, int]:
    """Bound decompression before rasterization, orient screenshots, whiten alpha."""
    validate_file_bytes(data)
    if page_number < 1:
        raise ValueError("Page numbers start at 1.")
    if data[:5] == b"%PDF-":
        try:
            with fitz.open(stream=data, filetype="pdf") as document:
                count = validate_pdf_document(document)
                if not 1 <= page_number <= count:
                    raise ValueError(f"Choose a page between 1 and {count}.")
                page = document[page_number - 1]
                validate_pdf_page(page)
                edge = max(page.rect.width, page.rect.height)
                # Normalize PDFs to the same bounded raster size used for OMR
                # evaluation, rather than varying precision with page units.
                scale = MAX_EDGE / edge
                pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csRGB, alpha=False)
                array = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3).copy()
                return array, count
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("This PDF could not be read. Try a screenshot of the staff.") from exc
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as source:
                if source.width * source.height > MAX_PIXELS:
                    raise ValueError("This image is too large. Crop to the music first (maximum 30 megapixels).")
                if page_number != 1:
                    raise ValueError("Images have one page.")
                image = ImageOps.exif_transpose(source)
                image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
                image = image.convert("RGBA")
                background = Image.new("RGBA", image.size, "white")
                background.alpha_composite(image)
                image = background.convert("RGB")
                image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
                return np.array(image), 1
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValueError("This file is not a readable PNG, JPEG, WebP, TIFF, or PDF.") from exc


def analyze_array(image: np.ndarray, *, name: str, page: int, pages: int):
    started = time.perf_counter()
    with recognition_lock:
        result = recognize(image)
    preview_image = result.pop("processed_image", image)
    result.update({
        "preview": png_preview(preview_image),
        "filename": name, "page": page, "pages": pages,
        "elapsed_ms": round((time.perf_counter() - started) * 1000),
    })
    return result


def png_preview(image: np.ndarray) -> str:
    preview = io.BytesIO()
    Image.fromarray(image).save(preview, format="PNG", optimize=False)
    return "data:image/png;base64," + base64.b64encode(preview.getvalue()).decode("ascii")


@asynccontextmanager
async def score_upload(request: Request):
    """Share one bounded, in-memory multipart policy across every upload route."""
    if not request.headers.get("content-type", "").lower().startswith("multipart/form-data;"):
        raise HTTPException(422, "Choose a screenshot or PDF using the file picker.")
    request_limit = MAX_BYTES + 1024 * 1024
    try:
        declared = int(request.headers.get("content-length", "0"))
        if declared < 0:
            raise ValueError
    except ValueError:
        raise HTTPException(400, "Invalid request length.")
    if declared > request_limit:
        raise HTTPException(413, "This upload exceeds 25 MB. Try a smaller file.")

    async def bounded_stream():
        consumed = 0
        async for chunk in request.stream():
            consumed += len(chunk)
            if consumed > request_limit:
                raise MultiPartException("This upload exceeds 25 MB. Try a smaller file.")
            yield chunk

    parser = MultiPartParser(request.headers, bounded_stream(), max_files=1, max_fields=2)
    # Request-local threshold avoids both disk spooling and global parser changes.
    parser.spool_max_size = request_limit + 1
    form = None
    try:
        form = await parser.parse()
        fields = [key for key, _ in form.multi_items()]
        if any(key not in {"file", "page"} for key in fields):
            raise ValueError("Use only the file and page fields.")
        if fields.count("page") > 1:
            raise ValueError("Choose one page number.")
        file = form.get("file")
        if not isinstance(file, UploadFile):
            raise ValueError("Choose a screenshot or PDF first.")
        page_field = form.get("page", "1")
        if not isinstance(page_field, str):
            raise ValueError("Page must be a whole number.")
        try:
            page = int(page_field)
        except ValueError as exc:
            raise ValueError("Page must be a whole number.") from exc
        if page < 1:
            raise ValueError("Page numbers start at 1.")
        data = await file.read(MAX_BYTES + 1)
        validate_file_bytes(data)
        name = Path(file.filename or "Screenshot").name
        # Once bytes are available, release the parser's duplicate buffer early.
        await file.close()
        yield data, name, page
    except (ValueError, MultiPartException) as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        if form is not None:
            await form.close()


@app.post("/api/inspect")
async def inspect_upload(request: Request):
    """Find every PDF page even when its cover contains no musical staff."""
    async with score_upload(request) as (data, name, _):
        def process():
            with recognition_lock:
                return {"filename": name, **inspect_score(data)}
        return await run_in_threadpool(process)


@app.post("/api/preview")
async def preview_upload(request: Request):
    """Return a selected page without invoking recognition or storing the file."""
    async with score_upload(request) as (data, name, page):
        def process():
            with recognition_lock:
                image, pages = decode_score(data, page)
                height, width = image.shape[:2]
                return {"filename": name, "pages": pages, "page": page,
                        "width": width, "height": height, "preview": png_preview(image)}
        return await run_in_threadpool(process)


@app.post("/api/analyze")
async def analyze(request: Request):
    """Recognize one selected page; the client orchestrates a document's pages."""
    async with score_upload(request) as (data, name, page):
        def process():
            with recognition_lock:
                image, pages = decode_score(data, page)
                return analyze_array(image, name=name, page=page, pages=pages)
        return await run_in_threadpool(process)


@app.get("/api/demo")
def demo():
    from tools.generate_fixtures import make_demo_image
    image = make_demo_image()
    if isinstance(image, tuple):
        image = image[0]
    return analyze_array(np.asarray(image), name="A little morning music · example", page=1, pages=1)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
