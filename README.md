# Prima · Staff2Audio

Turn a screenshot or PDF page of printed music into a staff you can inspect, correct, and hear on a sampled grand piano. Recognition and playback run on your computer. The application includes an original two-staff example and requires no cloud account, API key, paid recognition service, Node build, or external runtime assets.

This is a focused local practice tool for **clean, printed, monophonic notation**, not a general score transcription engine. Review detected notes and rhythm before relying on the performance. Confidence indicators describe heuristic evidence, not calibrated accuracy guarantees.

## Download and run

[GitHub Releases](https://github.com/DupeisTaken/staff2audio/releases) will contain
portable executables built by GitHub Actions for **Windows x64, Linux x64, macOS
Intel and macOS Apple Silicon** after a `v*` tag passes all four packaged checks.
PR/manual builds also provide downloadable Actions artifacts. Extract the archive
and run `Prima.exe` on Windows, or `./Prima` from a terminal on macOS/Linux. Prima
opens your browser once ready and automatically chooses a free local port.

**No Python, Node, package installation, API keys, external PDF tools or runtime
downloads are needed.** Keep the console open during use; press `Ctrl+C` to stop.
A current browser is required. Initial builds are unsigned; macOS/Windows may
require approval under your device policy. macOS requires 15+, Linux requires
glibc 2.35+, and the current Windows release targets x64 Windows 10/11. See the
[portable quickstart](docs/desktop-quickstart.txt) and
[architecture, build and release guide](docs/desktop.md) for details.

## Run from source

Use Python 3.11 or newer and a current Chrome, Edge, Firefox, or Safari browser. Run these commands from the project directory. On Windows PowerShell, the launcher creates an isolated environment if needed and opens the browser once the server is ready:

```powershell
.\start.ps1
```

Or set up manually:

```powershell
py -3.11 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe app.py
```

If Python 3.11 is not your installed version, use `py -3 -m venv .venv`. On macOS/Linux:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python app.py
```

Open [Prima on your computer](http://127.0.0.1:8765). Stop the server with `Ctrl+C`. The server binds to `127.0.0.1`; keep that default. Initial package installation requires internet access. After installation, the included recognition font, piano recordings, frontend, and demo work offline. Opening `static/index.html` directly does not start the backend.

The launcher chooses another port automatically if 8765 is occupied. Use `python run.py --port 0` to always choose a free port, `--port 8766` to require a specific port, or `--no-browser` to print the address without opening it. Browsers require a click before audio can start; click a piano key or Play staff if sound has not been enabled yet.

## Use the workspace

1. Choose an image/PDF, drop one onto the upload area, paste a screenshot, or open the included example. PDFs automatically scan every page in sequence. The page picker appears before recognition, so blank covers or unreadable pages cannot hide later music. Progress and each page's status are visible; completed pages are usable while scanning continues. Include the clef and key signature when cropping.
2. Select a detected staff. Focus staff isolates its preview; Full page shows the source and selectable staff regions. Each staff plays independently, including staves with different clefs or key signatures.
3. Click a detected note or an on-screen piano key to hear it. Review notes opens the pitch/rest and duration editor; you can change clef/key interpretation, add/delete events, and restore the selected staff's original detection. Corrections live only in the current browser session.
4. Play/pause, resume, stop, loop, or drag the progress control to seek. Each staff starts at a suggested sight-singing tempo based on meter and its fastest sounding note values. BPM counts the displayed beat unit: quarter notes in 4/4, dotted quarters in 6/8. Adjust it freely; your choice is remembered per page/staff for the current score, and **Use suggested** restores Auto. Transposition shifts the performance by semitones. The volume slider affects playback and WAV export. Space toggles play/pause when focus is outside an editor/control.
5. Download MIDI for an editable sequence or WAV for the actual sampled piano sound. Both export the entire selected staff once with current corrections, tempo, and transposition. MIDI is rendered by the receiving player's instrument; WAV is stereo 44.1 kHz, 16-bit PCM. Retain the piano attribution when distributing rendered audio.

The on-screen keyboard displays a central range; the local instrument contains all 88 piano keys, A0–C8. Pitches beyond this sample range use correctly pitched resampling of the nearest key. Very long held notes decay naturally rather than repeating an artificial sustain loop.

PDF navigation retains each page's note corrections, selected staff, original detection and manual tempo. Only three full-page PNG previews are cached; returning to an evicted preview renders its image without rerunning recognition or losing edits. **Stop scan** pauses remaining requests, **Scan remaining** resumes queued pages, and **Retry page** retries a failed page explicitly. A local recognition call already in progress may finish after Stop, but its late response cannot change the stopped or replacement document. Long PDFs have a page-number jump control. Closing/reloading the tab discards document state. See [document state](docs/document-state.md) and [PDF API contracts](docs/pdf-api.md).

Ordinary 4/4 passages start at **72 quarter-note BPM**, with a suggested 60–80 range; sixteenth-note passages start at **56**, with a 48–60 range. Ordinary 6/8 starts at **48 dotted-quarter BPM**, with a 40–56 range; sixteenths start at **40**, with a 36–44 range. Faster subdivisions scale the suggestion further. These are adjustable practice choices, not inferred printed markings or an examination standard. One steady tempo applies to the whole staff. See [the tempo policy, beat conversions and limits](docs/tempo.md).

Recognized note labels preserve written sharps, flats, naturals and octave spelling. Edited pitches and keyboard labels follow the selected key; transposed playback labels follow the transposed key. For example, A major uses G♯, B♭ major uses E♭, and uncommon signatures retain E♯, B♯, C♭ and F♭ where appropriate. Audio pitches remain MIDI numbers; see [notation naming rules](docs/note-names.md).

## Recognition scope and limits

The local OpenCV engine detects five-line staff geometry and uses the included Bravura notation font for clef, accidental, notehead, rest, and meter matching. It models treble/bass clefs, key signatures from seven flats through seven sharps, ledger positions, simple accidentals, common/compound meter, ordinary note values, dots, beams, and basic rests. It exposes warnings and event confidence so uncertain detection can be reviewed. Meter is descriptive; durations and audio scheduling use quarter-note beats.

Use a level, high-contrast image with complete staff lines and enough resolution to distinguish symbols. PNG, JPEG, WebP, TIFF, and unencrypted PDFs are decoded locally; only one raster image frame is used. PDF pages are rasterized individually, image EXIF orientation is respected, and transparency is composited onto white. Input files are limited to 25 MiB, raster images to 30 megapixels, and the processed long edge to 2,600 pixels.

Handwriting, skewed/noisy phone photos, dense engravings, chords/polyphony, multiple voices on one staff, cross-staff notation, complex tuplets, ties, repeats, pedal/dynamics/articulation, and expressive performance are outside the reliable target. Phrase slurs are ignored; ties need manual consolidation in the editor. A detected key signature identifies the conventional major/minor pair; the tool does not infer tonal mode or musical intent. Blank or incomplete staves may be rejected. Detection can miss symbols or assign the wrong pitch/rhythm even when confidence appears high. The original demo and synthetic tests establish specific tested cases, not accuracy on arbitrary published scores.

Transport accepts up to 20,000 events and 30 minutes per score at the selected tempo. WAV export is limited to 10 minutes to bound local memory use; use MIDI for longer excerpts. Browsers may suspend Web Audio in background/locked mobile sessions. Playback uses a two-second scheduling window and recovers score position after a late timer, but cannot force a browser to keep an audio device active.

## Privacy and local boundaries

Score processing uses the local Python process, and the browser requests the piano recordings from the same local server. There are no cloud uploads, telemetry, remote fonts, analytics, or runtime CDN calls. The application does not intentionally save uploaded scores, recognized notes, or previews in the project. Closing/reloading the tab discards session corrections; explicitly downloaded WAV/MIDI files remain wherever your browser saves them. Local server access logs can contain request paths and timing.

Responses request no-store caching and include a restrictive Content Security Policy. The server accepts local hostnames and rejects foreign Origin headers. These checks support its loopback deployment; it has no user accounts, authentication, TLS, or public-hosting hardening. Do not expose it through `0.0.0.0`, a reverse proxy, or a public tunnel without a separate deployment/security design. Operating-system/browser memory, swap, crash reporting, and browser-managed downloads remain outside the application's storage controls.

## Architecture

| Component | Responsibility |
| --- | --- |
| `run.py` | Source/frozen launcher, reserved loopback socket, automatic port selection and browser readiness |
| `Prima.spec`, `tools/build_desktop.py`, `.github/workflows/desktop.yml` | Self-contained executables, bundled dependencies/assets/licenses, native CI smoke checks and tagged releases |
| `app.py` | FastAPI local HTTP service, request/file bounds, raster/PDF decoding, serial recognition, in-memory preview responses |
| `staff2audio/omr.py` | Deterministic staff/symbol recognition and confidence/warnings |
| `staff2audio/music.py` | Clef-relative diatonic pitch, key accidental maps, MIDI/note naming |
| `static/index.html`, `style.css`, `app.js` | Responsive browser workspace, staff selection, editable review, transport/download UI |
| `static/piano.js` | Web Audio sampled voices, transport scheduling, offline WAV rendering, MIDI encoding |
| `static/tempo.js`, `static/note-names.js` | Sight-singing pace suggestions, beat-unit conversion, written/contextual pitch labels |
| `static/document.js`, `static/importer.js` | Per-page edits/statuses, bounded preview cache, sequential recognition and cancellation |
| `static/audio/` | 88 bundled FluidR3 acoustic-grand recordings and notices |
| `tools/generate_fixtures.py` | Original synthetic notation/demo generation |
| `tests/` | Recognition cases, decoder/API boundaries, audio timing/lifecycle/file-format tests |

There is no frontend build step. API payloads and ownership boundaries are described in [the integration contract](docs/contract.md); piano scheduling/export semantics are described in [audio documentation](docs/audio.md). The service exposes `GET /api/health`, `GET /api/demo`, plus `POST /api/inspect`, `POST /api/preview`, and `POST /api/analyze` with a multipart `file` and optional one-based `page` field. Recognition returns geometric note/staff metadata and an inline PNG preview; it does not persist a score identifier or provide a cloud API.

## Development and checks

Install the development dependencies into the same virtual environment:

```powershell
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.venv\Scripts\python.exe -m pytest -q
node --test tests/*.test.mjs
```

Node 24 or newer is recommended for JavaScript tests and the optional sample-bundling maintenance tool. The application itself does not require Node. Python tests verify actual file decoding and recognizer output on original fixtures; API tests replace the recognizer with lightweight deterministic output so HTTP/file/privacy cases do not repeatedly run CV. Audio tests use a fake audio clock and validate MIDI/WAV bytes; additionally verify real MP3 decoding, sound, downloads, desktop/mobile layouts, and keyboard controls in a browser after UI/audio changes. A passing synthetic suite does not prove recognition quality on an unseen score.

Create the original demo fixture with `.venv\Scripts\python.exe -m tools.generate_fixtures` (writes `tmp/demo-score.png`). Rebuild the included audio bundle, only when intentionally maintaining assets, with `node tools/audio-bundle.mjs`. That tool downloads the pinned upstream revision, checks SHA-256, and extracts literal MP3 strings without executing downloaded code. Normal playback never runs it or fetches its upstream URL.

## Verification report

Portable executable packaging has its own [self-contained verification report](docs/desktop-report.html)
and [inspectable evidence](docs/desktop-verification.json), including installation before/after,
actual packaged checks, archive measurements, CI status and platform limits.

The [standalone HTML report](docs/implementation-report.html) embeds desktop/mobile screenshots, a rendered piano example, test results, issue/PR links, independent review scores and remaining limits. The separate reviewer rated all eight documented dimensions above 9.5/10, with a minimum of 9.6; see [the assessment and its evidence limits](docs/final-review.json). The ratings apply to the clean printed monophonic scope and are not a transcription-accuracy percentage. The supplied private PDF and extracted score data are excluded from Git and the report.

The subsequent tempo and key-aware naming refinement has its own [independent assessment](docs/tempo-review.md), also above 9.5 in every dimension. The original recognition review is retained as baseline evidence.

Automatic all-page PDF recognition and retained page corrections have a separate [multipage assessment](docs/multipage-review.md), with all eight dimensions above 9.5. The combined suite passes 59 Python and 122 JavaScript checks.

## Licenses and attribution

The application is distributed under **GNU AGPL version 3**; see [LICENSE](LICENSE). PDF support uses [PyMuPDF](https://pymupdf.readthedocs.io/en/latest/about.html#license-and-copyright), which is offered under AGPL or a commercial license. Its AGPL obligations matter when modifying, distributing, or serving a derivative application; retaining the package name or a notice alone does not replace those obligations. Review the actual licenses for your intended distribution.

The bundled piano recordings are FluidR3 GM Acoustic Grand Piano by Frank Wen, rendered/distributed by Benjamin Gleitzman. The distributor identifies them as CC BY 3.0 US; original Fluid and MIDI.js distribution notices are also retained. See [complete piano attribution and source revision](static/audio/ATTRIBUTION.md). The Bravura music font has its own SIL Open Font License notice in `staff2audio/assets`. Original generated practice melodies/fixtures are included for testing and demonstration. Third-party dependencies remain under their respective licenses.
