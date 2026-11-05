# Portable desktop architecture

Prima keeps the recognition and browser layers and adds a native distribution
layer. Each download contains one self-contained executable plus optional
license/reference files. The executable runs without the source tree, a Python
installation, Node, external PDF tools, cloud accounts or asset downloads. A
current browser and the normal operating-system libraries remain prerequisites.

```text
Native executable (PyInstaller one-file)
  run.py: reserve a loopback socket, start service, open the ready URL
  app.py: FastAPI / PDF decoding / bounded uploads
  staff2audio: OpenCV recognition + bundled Bravura font
  static: browser workspace / Web Audio / all 88 piano recordings
  Python + native wheels + dependency licenses
                   |
          default system browser
```

This avoids a second browser engine, native webview installation, JavaScript
build toolchain, replacement recognition engine and new IPC protocol. The cost
is an executable containing Python and native wheels, temporary extraction at
launch, and a console window that owns the local service. A browser-only WASM
rewrite could remove the server but would require porting PDF/OMR processing and
revalidating recognition; Electron adds its own browser runtime; a native
webview introduces platform-specific runtime and lifecycle dependencies. Those
are separate product decisions rather than prerequisites for portable releases.

## Startup and lifetime

`run.py` binds and retains a socket on `127.0.0.1`. The default tries 8765,
falling back to a system-assigned port if occupied or reserved. Explicit
`--port N` fails with recovery instructions when unavailable; `--port 0`
selects a free port. Uvicorn receives that exact socket, preventing port-probe
races. The launcher observes its own server's started flag, rather than
accepting an HTTP response from an unrelated service, before opening a browser.
Pure-Python asyncio/h11/lifespan drivers are explicit in the frozen module graph.

Assets resolve relative to module `__file__`, which PyInstaller maps into its
extraction directory. No current-directory changes or project-relative paths
are needed. On frozen Linux launches, the external browser receives the original
system library search path rather than Prima's private bundled library path.
The console remains open; Ctrl+C stops the server. Browser close is deliberately
independent of server shutdown because multiple tabs can share the local service.

## Build and release

Use an isolated Python 3.12 environment on the target OS:

```sh
python -m pip install -r requirements-build.txt -r requirements-dev.txt -c requirements-lock.txt
python -m pytest -q
python -m tools.build_desktop
python -m tools.smoke_desktop dist/Prima
python -m tools.smoke_desktop dist/Prima --fallback
python -m tools.package_desktop --target linux-x64
```

On Windows use `dist/Prima.exe` and `--target windows-x64`; macOS target names
are `macos-x64` and `macos-arm64`. Runtime dependency constraints reuse
`requirements-lock.txt`; build tools are pinned in `requirements-build.txt`.
Native binary and Python platform dependencies mean this is a repeatable build
recipe, not a guarantee of identical binary bytes. `Prima.spec` is invoked by
the build helper after copying installed runtime dependency license metadata.
Do not invoke it directly without that preparation step.

`.github/workflows/desktop.yml` builds each target natively:

| Download | Runner | Support baseline |
| --- | --- | --- |
| `Prima-windows-x64.zip` | Windows 2022 x64 | Windows 10/11 x64 |
| `Prima-linux-x64.tar.gz` | Ubuntu 22.04 x64 | glibc 2.35+ Linux x64 desktop |
| `Prima-macos-x64.tar.gz` | macOS 15 Intel | macOS 15+ Intel |
| `Prima-macos-arm64.tar.gz` | macOS 15 ARM | macOS 15+ Apple Silicon |

PRs affecting runtime/packaging, pushes to main, and manual dispatches build
downloadable Actions artifacts. At most two matrix jobs run concurrently. Each
job runs Python regressions, freezes the executable, then exercises it twice
from an empty temporary working directory with Python removed from PATH. Checks
cover health/privacy headers, static files, dependency notices, every piano MP3
payload, actual demo/image recognition, a synthetic two-page PDF with blank
cover, native PDF rendering/recognition and occupied-port fallback. Smoke
measurements and PyInstaller warnings are uploaded as verification artifacts.
These are not human browser/audio or old-OS compatibility certifications.

Push a `v*` tag to publish a GitHub Release after **all four** native builds,
packaged checks and the separate JavaScript regression job pass. The workflow uses the built-in `GITHUB_TOKEN` and needs no
maintainer secret for unsigned releases. Each archive includes the executable,
quickstart, application license and dependency license copies. Tar preserves
execute permission; SHA-256 sidecars cover the distributed archives. A separate
Linux job validates every platform's checksums on PRs as well as tags; the release
job validates them again before publication. Sidecars use LF on all platforms.
GitHub also exposes the tagged
source alongside binaries. Normal builds use read-only repository permissions;
only the tag publication job can write release assets.

## Current boundaries

See [the end-user quickstart](desktop-quickstart.txt) for OS/security prompts and
startup instructions. Builds are initially unsigned and macOS is a terminal
executable, without `.app`, DMG or Apple notarization. Signing needs maintainer
credentials. Linux includes native libraries except the platform glibc loader;
Alpine/musl and architectures outside the matrix are not supported. Executables
extract to writable temporary storage on each launch; a Linux `noexec` temporary
directory needs an executable `TMPDIR`. The system browser remains external.
Offline means no application network dependencies after download, not a promise
about network behavior of the user's browser or OS. Keep the existing loopback,
upload bounds, memory-only score processing and privacy policies.

References: [PyInstaller operating model](https://pyinstaller.org/en/stable/operating-mode.html),
[resource paths](https://pyinstaller.org/en/stable/runtime-information.html),
[platform and glibc limits](https://pyinstaller.org/en/stable/usage.html), and
[GitHub-hosted runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
