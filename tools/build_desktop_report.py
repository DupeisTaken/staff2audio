"""Render the checked-in desktop evidence as one dependency-free HTML report."""
from __future__ import annotations

import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build():
    evidence = json.loads((ROOT / "docs/desktop-verification.json").read_text(encoding="utf-8"))
    esc = html.escape
    local = evidence["local"]
    rows = "".join(f'<tr><td>{esc(row["target"])}</td><td>{esc(row["status"])}</td>'
                   f'<td>{esc(row.get("details", ""))}</td></tr>' for row in evidence["ci"])
    checks = "".join(f'<li>{esc(check)}</li>' for check in evidence["checks"])
    limits = "".join(f'<li>{esc(limit)}</li>' for limit in evidence["limitations"])
    links = " · ".join(f'<a href="{esc(url, quote=True)}">{esc(label)}</a>'
                        for label, url in evidence["links"].items())
    report = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prima · Portable desktop verification</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#f5f3ed;color:#26392f;font:16px/1.7 system-ui,sans-serif}}
main{{max-width:1080px;margin:auto;padding:48px 24px}}h1,h2{{font-family:Georgia,serif;font-weight:400;line-height:1.2}}
h1{{font-size:50px;margin:16px 0}}h2{{font-size:30px;margin:36px 0 16px}}p{{max-width:900px}}
.eyebrow{{font-size:12px;letter-spacing:2px;color:#53664d}}a{{color:#89432c;text-underline-offset:3px}}
.cards,.flows{{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:24px 0}}
.card,.flow{{padding:22px;border:1px solid #cad2c1;border-radius:12px;background:#fffef8}}
.card strong{{display:block;font:32px Georgia,serif;color:#89432c}}.flows{{grid-template-columns:1fr 1fr}}
.flow strong{{display:block;margin-bottom:10px}}.step{{border-left:3px solid #77876a;padding-left:12px;margin:12px 0}}
table{{width:100%;border-collapse:collapse;background:#fffef8}}th,td{{padding:13px;text-align:left;border-bottom:1px solid #d1d8c9;vertical-align:top}}
th{{background:#e5ebde;font-size:13px}}code{{background:#e5ebde;padding:2px 5px;border-radius:4px}}
li{{margin:8px 0}}.note{{padding:16px 22px;border-left:3px solid #89432c;background:#fffaf0}}
footer{{margin-top:36px;border-top:1px solid #cad2c1;padding-top:20px;font-size:13px}}
@media(max-width:700px){{main{{padding:28px 16px}}h1{{font-size:37px}}.cards,.flows{{grid-template-columns:1fr}}th,td{{padding:9px;font-size:13px}}}}
</style></head><body><main>
<header><div class="eyebrow">ENGINEERING REPORT · 5 NOVEMBER 2026</div>
<h1>One download.<br>A local piano workspace.</h1>
<p>Prima now has a portable distribution layer: a native executable containing Python,
recognition/PDF libraries, Bravura, the browser workspace and 88 piano recordings.
Users keep their existing browser and no longer configure a development environment.</p>
<p>{links}</p></header>
<div class="cards"><div class="card"><strong>{local["python_tests"]} + {local["javascript_tests"]}</strong>Python and JavaScript tests passed</div>
<div class="card"><strong>{local["archive_mib"]} MiB</strong>Measured Windows archive</div>
<div class="card"><strong>4 targets</strong>Windows, Linux, Intel Mac and Apple Silicon</div></div>
<h2>What changes for users</h2>
<div class="flows"><div class="flow"><strong>Before · source checkout</strong>
<div class="step">Install Python and clone the repository</div><div class="step">Create a virtual environment and install native wheels</div>
<div class="step">Launch a local service and resolve an occupied port manually</div></div>
<div class="flow"><strong>After · portable executable</strong><div class="step">Download and extract the matching archive</div>
<div class="step">Run Prima; its runtime and offline assets are included</div>
<div class="step">A ready local URL opens automatically, using a free port</div></div></div>
<h2>Architecture and tradeoffs</h2>
<p>The existing deterministic OpenCV/PyMuPDF recognizer and Web Audio frontend remain the core.
PyInstaller freezes them into an OS-specific executable. Keeping the system browser avoids
shipping another browser engine or introducing a native webview runtime. The tradeoffs are
larger downloads, a temporary extraction step at launch and a console-owned service lifetime.</p>
<p>The launcher retains a loopback socket through startup, passes that socket to Uvicorn,
and observes its own server readiness before opening the browser. Assets resolve from module
locations inside the bundle. Frozen Linux browser launches restore the system library path.
Explicit ports remain explicit; the default can fall back automatically.</p>
<h2>Verification evidence</h2><ul>{checks}</ul>
<p>Local environment: {esc(local["environment"])}. Executable: {local["executable_mib"]} MiB.
Measured time to readiness: {local["startup_seconds"]} seconds in the first smoke run and
{local["fallback_startup_seconds"]} seconds in the occupied-port run. These are individual
measurements affected by filesystem cache and security scanning, not performance guarantees.</p>
<table><thead><tr><th>Native CI target</th><th>Result</th><th>Evidence / boundary</th></tr></thead><tbody>{rows}</tbody></table>
<h2>Release mechanics</h2>
<p>GitHub Actions builds natively with Python 3.12 and constrained dependencies. At most two
matrix jobs run at once. Each native executable must pass both packaged smoke scenarios before
it is archived. Archives preserve executable permissions and include license copies, a quickstart
and SHA-256 sidecars. A <code>v*</code> tag publishes a release only after all four jobs pass;
the built-in GitHub token is sufficient for unsigned publication. This change does not create a release tag.</p>
<h2>Remaining limits</h2><ul>{limits}</ul>
<p class="note">Only original synthetic music is used in packaged verification. This report
contains no participant scores, private source documents, credentials or personal data.
The application workspace UI is unchanged, so before/after above describes installation and
startup. Packaged HTTP checks do not establish browser audio decoding or sound-device behavior.</p>
<footer>Self-contained HTML: all styling and report content are embedded. External links are
optional references. Rebuild with <code>python -m tools.build_desktop_report</code> from the
checked-in verification JSON.</footer></main></body></html>'''
    (ROOT / "docs/desktop-report.html").write_text(report, encoding="utf-8")


if __name__ == "__main__":
    build()
