"""Real file decoding and lightweight HTTP boundary checks, without running CV."""
from __future__ import annotations

import base64
import io

import fitz
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image
import starlette.formparsers as formparsers

import app as server


def image_bytes(image: Image.Image | None = None, format: str = "PNG", **options) -> bytes:
    stream = io.BytesIO()
    (image if image is not None else Image.new("RGB", (160, 100), "white")).save(stream, format=format, **options)
    return stream.getvalue()


def pdf_bytes(*, encrypted: bool = False, width: float = 200) -> bytes:
    with fitz.open() as document:
        for color in [(1, 0, 0), (0, 0, 1)]:
            page = document.new_page(width=width, height=100)
            page.draw_rect(page.rect, color=color, fill=color)
        return document.tobytes(**({"encryption": fitz.PDF_ENCRYPT_AES_256, "owner_pw": "owner", "user_pw": "secret"} if encrypted else {}))


def blank_cover_score_pdf() -> bytes:
    """Original two-page fixture: a white cover, then a small printed staff."""
    with fitz.open() as document:
        document.new_page(width=200, height=100)
        page = document.new_page(width=200, height=100)
        for y in [30, 38, 46, 54, 62]:
            page.draw_line((15, y), (185, y), color=(0, 0, 0), width=.6)
        page.draw_oval(fitz.Rect(70, 57, 80, 63), color=(0, 0, 0), fill=(0, 0, 0))
        page.draw_line((80, 60), (80, 30), color=(0, 0, 0), width=1)
        return document.tobytes()


@pytest.fixture
def client(monkeypatch):
    def lightweight_recognize(image):
        height, width = image.shape[:2]
        return {"width": width, "height": height, "staffs": [{"id": 0, "box": [0, 0, width, height],
            "lines": [20, 30, 40, 50, 60], "clef": "treble", "key_signature": 0,
            "key_name": "C major / A minor", "time_signature": "4/4", "confidence": .95,
            "events": [{"id": "test-note", "midi": 64, "name": "E4", "onset": 0, "duration": 1,
                        "x": 40, "y": 60, "confidence": .95}]}], "warnings": [], "engine": "synthetic-test"}
    monkeypatch.setattr(server, "recognize", lightweight_recognize)
    with TestClient(server.app) as connection:
        yield connection


def test_decode_png_rgb_pixels_and_dtype():
    image = Image.new("RGB", (23, 17), (14, 126, 240))
    actual, pages = server.decode_score(image_bytes(image))
    assert pages == 1 and actual.shape == (17, 23, 3) and actual.dtype == np.uint8
    assert tuple(actual[0, 0]) == (14, 126, 240)


def test_transparent_and_semialpha_pixels_composite_on_white():
    image = Image.new("RGBA", (3, 2), (0, 0, 0, 0))
    image.putpixel((1, 0), (255, 0, 0, 128))
    actual, _ = server.decode_score(image_bytes(image))
    assert tuple(actual[0, 0]) == (255, 255, 255)
    assert tuple(actual[0, 1]) == (255, 127, 127)


def test_jpeg_exif_orientation_is_applied_before_recognition():
    image = Image.new("RGB", (40, 20), "red")
    image.paste("blue", (20, 0, 40, 20))
    exif = Image.Exif(); exif[274] = 6  # Rotate clockwise to portrait.
    actual, pages = server.decode_score(image_bytes(image, "JPEG", exif=exif, quality=100))
    assert pages == 1 and actual.shape == (40, 20, 3)
    assert actual[5, 10, 0] > 240 and actual[35, 10, 2] > 240


def test_image_long_edge_is_bounded_without_changing_aspect_ratio(monkeypatch):
    monkeypatch.setattr(server, "MAX_EDGE", 100)
    actual, _ = server.decode_score(image_bytes(Image.new("RGB", (300, 150), "white")))
    assert actual.shape == (50, 100, 3)


@pytest.mark.parametrize("data,match", [(b"", "Choose"), (b"not an image", "not a readable")])
def test_empty_and_malformed_images_fail_with_readable_messages(data, match):
    with pytest.raises(ValueError, match=match): server.decode_score(data)


def test_image_page_numbers_and_pixel_limit(monkeypatch):
    data = image_bytes(Image.new("RGB", (11, 10), "white"))
    with pytest.raises(ValueError, match="start at 1"): server.decode_score(data, 0)
    with pytest.raises(ValueError, match="Images have one page"): server.decode_score(data, 2)
    monkeypatch.setattr(server, "MAX_PIXELS", 100)
    with pytest.raises(ValueError, match="too large"): server.decode_score(data)


def test_pillow_decompression_warning_is_a_handled_error(monkeypatch):
    data = image_bytes(Image.new("RGB", (11, 10), "white"))
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 100)
    with pytest.raises(ValueError, match="not a readable|too large"): server.decode_score(data)


def test_file_limit_is_25_mebibytes_and_checked_before_file_decoding(monkeypatch):
    assert server.MAX_BYTES == 25 * 1024 * 1024
    monkeypatch.setattr(server, "MAX_BYTES", 16)
    with pytest.raises(ValueError, match="25 MB"): server.decode_score(b"x" * 17)


def test_pdf_selected_page_rasterizes_rgb_and_reports_count():
    data = pdf_bytes()
    first, pages = server.decode_score(data, 1)
    second, second_count = server.decode_score(data, 2)
    assert pages == second_count == 2
    # Small PDF page units must not cap recognition quality at an arbitrary DPI.
    assert first.shape == second.shape == (1300, 2600, 3)
    assert first.dtype == second.dtype == np.uint8
    assert first[150, 300, 0] > 250 and first[150, 300, 2] < 5
    assert second[150, 300, 2] > 250 and second[150, 300, 0] < 5


def test_pdf_invalid_page_encryption_malformed_and_dimensions():
    with pytest.raises(ValueError, match="between 1 and 2"): server.decode_score(pdf_bytes(), 3)
    with pytest.raises(ValueError, match="password protected"): server.decode_score(pdf_bytes(encrypted=True))
    with pytest.raises(ValueError, match="could not be read"): server.decode_score(b"%PDF-1.4\nnot actually a PDF")
    with pytest.raises(ValueError, match="invalid dimensions"): server.decode_score(pdf_bytes(width=100001))


def test_pdf_rendering_edge_is_bounded(monkeypatch):
    monkeypatch.setattr(server, "MAX_EDGE", 150)
    image, _ = server.decode_score(pdf_bytes())
    assert image.shape == (75, 150, 3)


def test_analyze_returns_score_and_safe_png_preview_without_persisting(client):
    response = client.post("/api/analyze", files={"file": ("../private-score.png", image_bytes(), "image/png")})
    assert response.status_code == 200
    data = response.json()
    assert data["filename"] == "private-score.png" and data["pages"] == data["page"] == 1
    assert data["engine"] == "synthetic-test" and data["staffs"][0]["events"][0]["midi"] == 64
    assert data["preview"].startswith("data:image/png;base64,")
    preview = Image.open(io.BytesIO(base64.b64decode(data["preview"].split(",", 1)[1])))
    assert preview.mode == "RGB" and preview.size == (160, 100)
    assert isinstance(data["elapsed_ms"], int) and data["elapsed_ms"] >= 0


def test_upload_uses_content_instead_of_claimed_extension_or_mime(client):
    response = client.post("/api/analyze", files={"file": ("misleading.pdf", image_bytes(), "application/pdf")})
    assert response.status_code == 200 and response.json()["pages"] == 1


def test_analyze_pdf_page_and_user_errors(client):
    assert client.post("/api/analyze", files={"file": ("score.pdf", pdf_bytes())}, data={"page": "2"}).json()["page"] == 2
    for payload, page, match in [(b"", "1", "Choose"), (b"garbage", "1", "readable"), (pdf_bytes(), "3", "between"), (image_bytes(), "0", "start at 1")]:
        response = client.post("/api/analyze", files={"file": ("score", payload)}, data={"page": page})
        assert response.status_code == 422 and match in response.json()["detail"]
    assert client.post("/api/analyze").status_code == 422
    assert client.post("/api/analyze", files={"file": ("score.png", image_bytes())}, data={"page": "bad"}).status_code == 422


def test_analyze_oversize_is_rejected_before_recognition(client, monkeypatch):
    monkeypatch.setattr(server, "MAX_BYTES", 1024)
    def forbidden_recognize(_): raise AssertionError("Oversized uploads must never reach recognition")
    monkeypatch.setattr(server, "recognize", forbidden_recognize)
    response = client.post("/api/analyze", files={"file": ("large.png", b"x" * 1025)})
    assert response.status_code in (413, 422) and "25 MB" in response.json()["detail"]


def test_recognition_errors_are_returned_as_actionable_validation_errors(client, monkeypatch):
    def reject(_): raise ValueError("No five-line staff found. Crop to the music.")
    monkeypatch.setattr(server, "recognize", reject)
    response = client.post("/api/analyze", files={"file": ("blank.png", image_bytes())})
    assert response.status_code == 422 and "Crop to the music" in response.json()["detail"]


def test_foreign_origin_is_rejected_before_recognition(client, monkeypatch):
    def forbidden_recognize(_): raise AssertionError("Foreign origins must never reach recognition")
    monkeypatch.setattr(server, "recognize", forbidden_recognize)
    response = client.post("/api/analyze", files={"file": ("private.png", image_bytes())}, headers={"Origin": "https://unrelated.example"})
    assert response.status_code == 403 and "local browser tab" in response.json()["detail"]


def test_same_origin_and_missing_origin_work_but_foreign_host_is_rejected(client):
    assert client.get("/api/health", headers={"Origin": "http://testserver"}).status_code == 200
    assert client.get("/api/health").json() == {"status": "ok", "local": True}
    assert client.get("/api/health", headers={"Host": "unrelated.example"}).status_code == 400


def test_local_audio_code_and_assets_have_privacy_headers(client):
    response = client.get("/static/piano.js")
    assert response.status_code == 200 and "class PianoPlayer" in response.text
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "connect-src 'self'" in response.headers["content-security-policy"]
    assert client.get("/static/audio/ATTRIBUTION.md").status_code == 200
    assert client.get("/static/does-not-exist").status_code == 404


def test_engine_processed_preview_is_used_and_not_leaked_as_json(client, monkeypatch):
    def recognize(_):
        return {"width": 20, "height": 10, "staffs": [], "warnings": ["Example warning"], "engine": "test",
                "processed_image": np.full((10, 20, 3), 127, dtype=np.uint8)}
    monkeypatch.setattr(server, "recognize", recognize)
    response = client.post("/api/analyze", files={"file": ("score.png", image_bytes())})
    assert response.status_code == 200
    payload = response.json(); assert "processed_image" not in payload
    image = Image.open(io.BytesIO(base64.b64decode(payload["preview"].split(",")[1])))
    assert image.size == (20, 10) and image.getpixel((0, 0)) == (127, 127, 127)


def multipart_file(payload: bytes, boundary: str = "test-boundary") -> bytes:
    return (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="score.png"\r\n'
            'Content-Type: image/png\r\n\r\n').encode() + payload + f'\r\n--{boundary}--\r\n'.encode()


def test_declared_request_oversize_is_rejected_before_multipart_parse(client, monkeypatch):
    monkeypatch.setattr(server, "MAX_BYTES", 1024)
    response = client.post("/api/analyze", content=b"", headers={"Content-Length": str(1024 + 1024 * 1024 + 1), "Content-Type": "multipart/form-data; boundary=test-boundary"})
    assert response.status_code == 413 and "25 MB" in response.json()["detail"]
    response = client.post("/api/analyze", content=b"", headers={"Content-Length": "bad", "Content-Type": "multipart/form-data; boundary=test-boundary"})
    assert response.status_code == 400


def test_chunked_upload_without_content_length_is_still_bounded(client, monkeypatch):
    monkeypatch.setattr(server, "MAX_BYTES", 1024)
    def forbidden_recognize(_): raise AssertionError("Oversized streams must never reach recognition")
    monkeypatch.setattr(server, "recognize", forbidden_recognize)
    body = multipart_file(b"x" * (1024 * 1024 + 2048))
    request = client.build_request("POST", "/api/analyze", content=(body[i:i+4096] for i in range(0, len(body), 4096)),
        headers={"Content-Type": "multipart/form-data; boundary=test-boundary"})
    assert "content-length" not in request.headers
    response = client.send(request)
    assert response.status_code in (413, 422) and "25 MB" in response.json()["detail"]


def test_valid_upload_without_content_length_still_decodes(client):
    body = multipart_file(image_bytes())
    response = client.post("/api/analyze", content=(body[i:i+100] for i in range(0, len(body), 100)),
        headers={"Content-Type": "multipart/form-data; boundary=test-boundary"})
    assert response.status_code == 200 and response.json()["width"] == 160


def test_accepted_upload_larger_than_default_spool_threshold_never_rolls_to_disk(client, monkeypatch):
    original = formparsers.SpooledTemporaryFile
    opened = []
    def in_memory_file(*args, **kwargs):
        handle = original(*args, **kwargs)
        def forbidden_rollover(): raise AssertionError("Private score was about to spool to disk")
        handle.rollover = forbidden_rollover
        opened.append(handle)
        return handle
    monkeypatch.setattr(formparsers, "SpooledTemporaryFile", in_memory_file)
    # A valid small PNG with trailing padding avoids a heavy fixture/recognition run.
    response = client.post("/api/analyze", files={"file": ("private.png", image_bytes() + b"x" * (1024 * 1024 + 1))})
    assert response.status_code == 200 and len(opened) == 1
    assert opened[0].closed and not opened[0]._rolled


def test_invalid_multipart_boundaries_counts_and_field_types_are_handled(client):
    response = client.post("/api/analyze", content=b"bad", headers={"Content-Type": "multipart/form-data"})
    assert response.status_code in (400, 415, 422)
    response = client.post("/api/analyze", content=b"bad", headers={"Content-Type": "application/json"})
    assert response.status_code in (400, 415, 422)
    response = client.post("/api/analyze", files=[("file", ("a.png", image_bytes())), ("file", ("b.png", image_bytes()))])
    assert response.status_code == 422
    response = client.post("/api/analyze", files={"file": ("a.png", image_bytes())}, data={"page": "1", "extra": "a", "another": "b"})
    assert response.status_code == 422
    response = client.post("/api/analyze", files=[("file", ("a.png", image_bytes())), ("page", ("bad.txt", b"1"))])
    assert response.status_code in (400, 422)


def test_inspect_blank_cover_inventory_does_not_render_or_recognize(client, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("PDF inspection must not rasterize or recognize a cover")
    monkeypatch.setattr(server, "recognize", forbidden)
    monkeypatch.setattr(fitz.Page, "get_pixmap", forbidden)
    response = client.post("/api/inspect", files={"file": ("../practice.pdf", blank_cover_score_pdf())})
    assert response.status_code == 200
    assert response.json() == {"filename": "practice.pdf", "pages": 2, "kind": "pdf"}
    assert response.headers["cache-control"] == "no-store"


def test_preview_selected_pdf_page_never_invokes_cv(client, monkeypatch):
    monkeypatch.setattr(server, "MAX_EDGE", 200)
    def forbidden(_): raise AssertionError("A preview must never run recognition")
    monkeypatch.setattr(server, "recognize", forbidden)
    response = client.post("/api/preview", files={"file": ("score.pdf", pdf_bytes())}, data={"page": "2"})
    assert response.status_code == 200
    result = response.json()
    assert set(result) == {"filename", "pages", "page", "width", "height", "preview"}
    assert (result["filename"], result["pages"], result["page"], result["width"], result["height"]) == ("score.pdf", 2, 2, 200, 100)
    image = Image.open(io.BytesIO(base64.b64decode(result["preview"].split(",", 1)[1])))
    assert image.mode == "RGB" and image.size == (200, 100)
    assert image.getpixel((30, 30)) == (0, 0, 255)


def test_blank_cover_cannot_block_later_music_pages(client, monkeypatch):
    monkeypatch.setattr(server, "MAX_EDGE", 200)
    calls = []
    def recognize_music(image):
        calls.append(int(image.min()))
        if image.min() == 255:
            raise ValueError("No five-line musical staff was found. Use a clear staff image.")
        return {"width": image.shape[1], "height": image.shape[0], "staffs": [{"id":1,
            "clef":"treble", "key_signature":0, "events":[{"id":"n1", "midi":64,
            "name":"E4", "onset":0, "duration":1}]}], "warnings":[], "engine":"fixture"}
    monkeypatch.setattr(server, "recognize", recognize_music)
    data = blank_cover_score_pdf()
    upload = {"file": ("practice.pdf", data, "application/pdf")}
    assert client.post("/api/inspect", files=upload).json()["pages"] == 2
    cover = client.post("/api/analyze", files=upload, data={"page":"1"})
    assert cover.status_code == 422 and "No five-line" in cover.json()["detail"]
    assert client.post("/api/preview", files=upload, data={"page":"1"}).status_code == 200
    music = client.post("/api/analyze", files=upload, data={"page":"2"})
    assert music.status_code == 200
    assert music.json()["page"] == music.json()["pages"] == 2
    assert music.json()["staffs"][0]["events"][0]["midi"] == 64
    assert client.post("/api/preview", files=upload, data={"page":"2"}).status_code == 200
    assert len(calls) == 2 and calls[0] == 255 and calls[1] < 255


def test_inspect_images_validate_content_not_claimed_mime(client, monkeypatch):
    def forbidden(_): raise AssertionError("Image inventory must not run CV")
    monkeypatch.setattr(server, "recognize", forbidden)
    response = client.post("/api/inspect", files={"file": ("wrong.pdf", image_bytes(), "application/pdf")})
    assert response.status_code == 200
    assert response.json() == {"filename":"wrong.pdf", "pages":1, "kind":"image"}
    monkeypatch.setattr(server, "MAX_PIXELS", 100)
    assert client.post("/api/inspect", files={"file": ("large.png", image_bytes())}).status_code == 422


@pytest.mark.parametrize("endpoint", ["inspect", "preview"])
def test_new_endpoints_reject_malformed_and_encrypted_files(client, endpoint):
    for data, message in [(b"bad", "readable"), (b"%PDF-1.4\ninvalid", "could not be read"),
                          (pdf_bytes(encrypted=True), "password protected")]:
        response = client.post(f"/api/{endpoint}", files={"file": ("score", data)})
        assert response.status_code == 422 and message in response.json()["detail"]


def test_invalid_page_geometry_cannot_block_inventory_or_other_valid_pages(client, monkeypatch):
    monkeypatch.setattr(server, "MAX_EDGE", 200)
    with fitz.open() as document:
        document.new_page(width=200, height=100)
        document.new_page(width=100001, height=100)
        data = document.tobytes()
    upload = {"file": ("score.pdf", data)}
    response = client.post("/api/inspect", files=upload)
    assert response.status_code == 200
    assert response.json() == {"filename":"score.pdf", "pages":2, "kind":"pdf"}
    for endpoint in ["analyze", "preview"]:
        valid = client.post(f"/api/{endpoint}", files=upload, data={"page":"1"})
        assert valid.status_code == 200 and valid.json()["pages"] == 2
        invalid = client.post(f"/api/{endpoint}", files=upload, data={"page":"2"})
        assert invalid.status_code == 422 and "invalid dimensions" in invalid.json()["detail"]


@pytest.mark.parametrize("data,page,message", [(pdf_bytes(),"3","between 1 and 2"),
    (image_bytes(),"2","Images have one page"), (image_bytes(),"0","start at 1"),
    (image_bytes(),"bad","whole number")])
def test_preview_page_bounds_and_type_errors_are_actionable(client, data, page, message):
    response = client.post("/api/preview", files={"file": ("score", data)}, data={"page":page})
    assert response.status_code == 422 and message in response.json()["detail"]


@pytest.mark.parametrize("endpoint", ["analyze", "inspect", "preview"])
def test_every_upload_endpoint_bounds_declared_stream_and_file_bytes(client, monkeypatch, endpoint):
    monkeypatch.setattr(server, "MAX_BYTES", 1024)
    url = f"/api/{endpoint}"
    response = client.post(url, content=b"", headers={"Content-Length": str(1024 + 1024 * 1024 + 1),
        "Content-Type": "multipart/form-data; boundary=test-boundary"})
    assert response.status_code == 413
    for length in ["bad", "-1"]:
        assert client.post(url, content=b"", headers={"Content-Length":length,
            "Content-Type":"multipart/form-data; boundary=test-boundary"}).status_code == 400
    response = client.post(url, files={"file":("large.png", b"x" * 1025)})
    assert response.status_code == 422 and "25 MB" in response.json()["detail"]
    body = multipart_file(b"x" * (1024 * 1024 + 2048))
    request = client.build_request("POST", url, content=(body[i:i+4096] for i in range(0,len(body),4096)),
        headers={"Content-Type":"multipart/form-data; boundary=test-boundary"})
    assert "content-length" not in request.headers
    response = client.send(request)
    assert response.status_code == 422 and "25 MB" in response.json()["detail"]


@pytest.mark.parametrize("endpoint", ["analyze", "inspect", "preview"])
def test_every_upload_endpoint_keeps_accepted_buffers_in_memory_and_closes_them(client, monkeypatch, endpoint):
    original = formparsers.SpooledTemporaryFile
    opened = []
    def in_memory_file(*args, **kwargs):
        handle = original(*args, **kwargs)
        def forbidden_rollover(): raise AssertionError("Score upload must stay in memory")
        handle.rollover = forbidden_rollover
        opened.append(handle)
        return handle
    monkeypatch.setattr(formparsers, "SpooledTemporaryFile", in_memory_file)
    response = client.post(f"/api/{endpoint}", files={"file":("score.png", image_bytes() + b"x" * (1024 * 1024 + 1))})
    assert response.status_code == 200 and len(opened) == 1
    assert opened[0].closed and not opened[0]._rolled


@pytest.mark.parametrize("endpoint", ["analyze", "inspect", "preview"])
def test_every_upload_endpoint_rejects_wrong_form_types_and_foreign_requests(client, endpoint):
    url = f"/api/{endpoint}"
    for content_type in ["application/json", "text/plain", "multipart/form-data"]:
        assert client.post(url, content=b"bad", headers={"Content-Type":content_type}).status_code == 422
    assert client.post(url, files={"file":("score.png",image_bytes())}, data={"unexpected":"value"}).status_code == 422
    assert client.post(url, files=[("file",("a.png",image_bytes())),("page",("b.txt",b"1"))]).status_code == 422
    assert client.post(url, files={"file":("score.png",image_bytes())}, headers={"Origin":"https://unrelated.example"}).status_code == 403
    assert client.post(url, files={"file":("score.png",image_bytes())}, headers={"Host":"unrelated.example"}).status_code == 400
