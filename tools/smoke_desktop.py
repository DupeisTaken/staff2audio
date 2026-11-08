"""Exercise the actual executable from an empty directory with no Python PATH."""
from __future__ import annotations

import argparse
import base64
import errno
import io
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

import fitz
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def smoke(command: list[str], *, fallback: bool = False) -> dict:
    started = time.monotonic()
    environment = os.environ.copy()
    for key in ("PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV"):
        environment.pop(key, None)
    environment["PATH"] = str(Path(os.environ.get("SystemRoot", "/usr")) / "System32") if os.name == "nt" else "/usr/bin:/bin"
    lines = []
    ready = threading.Event()
    with tempfile.TemporaryDirectory(prefix="staff2audio-smoke-") as directory, socket.socket() as occupied:
        if fallback:
            try:
                occupied.bind(("127.0.0.1", 8765))
                occupied.listen()
            except OSError as exc:
                # An existing local app is also a valid occupied-port fixture.
                # Never send it requests or interfere with its process.
                if exc.errno not in {errno.EADDRINUSE, errno.EACCES}:
                    raise
        arguments = [*command, "--no-browser", *([] if fallback else ["--port", "0"])]
        process = subprocess.Popen(arguments, cwd=directory, env=environment,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
            start_new_session=os.name != "nt")
        def read_output():
            for line in process.stdout:
                lines.append(line)
                if "staff2audio is ready:" in line:
                    ready.set()
        reader = threading.Thread(target=read_output, daemon=True)
        reader.start()
        try:
            deadline = time.monotonic() + 90
            while not ready.wait(.1):
                if process.poll() is not None or time.monotonic() > deadline:
                    raise AssertionError("Executable did not become ready:\n" + "".join(lines))
            startup_seconds = round(time.monotonic() - started, 3)
            url = re.search(r"staff2audio is ready: (http://127\.0\.0\.1:\d+)", "".join(lines)).group(1)
            if fallback:
                check(not url.endswith(":8765"), "Did not avoid occupied default port")
            # Bypass proxy environment variables even on corporate build hosts.
            http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            def get(path):
                with http.open(url + path, timeout=45) as response:
                    check(response.headers.get("Cache-Control") == "no-store", "Missing privacy header")
                    return response.read()
            def post(path, data, filename, page=1):
                boundary = "staff2audio-desktop-smoke-boundary"
                body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                        f'Content-Type: application/octet-stream\r\n\r\n').encode() + data
                body += (f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="page"\r\n\r\n{page}'
                         f'\r\n--{boundary}--\r\n').encode()
                request = urllib.request.Request(url + path, data=body,
                    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
                with http.open(request, timeout=90) as response:
                    return json.load(response)
            check(json.loads(get("/api/health")) == {"status": "ok", "local": True}, "Health failed")
            for path in ("/", "/static/app.js", "/static/style.css", "/static/piano.js", "/static/THIRD_PARTY_NOTICES.txt"):
                payload = get(path)
                check(len(payload) > 100, f"Missing asset: {path}")
                if path == "/":
                    check(b"<title>staff2audio" in payload and b'aria-label="staff2audio home"' in payload,
                          "Packaged application branding is out of date")
            check("pymupdf" in json.loads(get("/static/licenses/packages.json")), "Missing bundled licenses")
            piano = json.loads(get("/static/audio/grand-piano.json"))
            # Validate the actual MP3 payloads rather than only the JSON response.
            samples = piano["samples"]
            check(len(samples) == 88, "Expected all 88 piano samples")
            for sample in samples.values():
                encoded = sample.split(",", 1)[-1]
                check(len(base64.b64decode(encoded)) > 1000, "Empty piano recording")
            demo = json.loads(get("/api/demo"))
            check(len(demo["staffs"]) == 2, "Bundled font/demo recognition failed")
            image = base64.b64decode(demo["preview"].split(",", 1)[1])
            recognized = post("/api/analyze", image, "original-demo.png")
            check(len(recognized["staffs"]) == 2, "Packaged image recognition failed")
            with Image.open(io.BytesIO(image)) as decoded, fitz.open() as document:
                document.new_page(width=decoded.width, height=decoded.height)
                music = document.new_page(width=decoded.width, height=decoded.height)
                music.insert_image(music.rect, stream=image)
                pdf = document.tobytes()
            check(post("/api/inspect", pdf, "synthetic.pdf")["pages"] == 2, "PDF inventory failed")
            preview = post("/api/preview", pdf, "synthetic.pdf", 2)
            check(preview["preview"].startswith("data:image/png;base64,"), "Native PDF renderer failed")
            score = post("/api/analyze", pdf, "synthetic.pdf", 2)
            check(len(score["staffs"]) == 2 and score["page"] == 2, "Packaged PDF recognition failed")
            check(not list(Path(directory).iterdir()), "Executable wrote to the working directory")
            return {"status": "passed", "startup_seconds": startup_seconds,
                    "total_seconds": round(time.monotonic() - started, 3), "piano_samples": 88,
                    "image_staves": len(recognized["staffs"]), "pdf_staves": len(score["staffs"]),
                    "default_port_fallback": fallback, "empty_working_directory": True,
                    "python_removed_from_path": True}
        except Exception:
            print("".join(lines), file=sys.stderr)
            raise
        finally:
            if process.poll() is None:
                # Signal only the process group created above, never unrelated apps.
                if os.name == "nt":
                    process.send_signal(signal.CTRL_BREAK_EVENT)
                else:
                    os.killpg(process.pid, signal.SIGINT)
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    if os.name == "nt":
                        subprocess.run([str(Path(os.environ["SystemRoot"]) / "System32" / "taskkill.exe"),
                                        "/PID", str(process.pid), "/T", "/F"], check=True, capture_output=True)
                    else:
                        os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=10)
            reader.join(timeout=2)
            process.stdout.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("executable", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--fallback", action="store_true")
    args = parser.parse_args()
    result = smoke([str(args.executable.resolve())], fallback=args.fallback)
    print(json.dumps(result, indent=2))
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
