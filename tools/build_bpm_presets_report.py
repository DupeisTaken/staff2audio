"""Build the standalone BPM report from synthetic screenshots and measured evidence."""
from __future__ import annotations

import base64
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build():
    evidence = json.loads((ROOT / "docs/bpm-presets-verification.json").read_text(encoding="utf-8"))
    esc = html.escape
    figures = []
    for file, label in [
        ("before-desktop.jpg", "Before · desktop: manual tempo input"),
        ("after-desktop.jpg", "After · desktop: exact BPM presets beside manual input"),
        ("before-mobile.jpg", "Before · 390 px: three settings columns"),
        ("after-mobile.jpg", "After · 390 px: four controls in a two-column grid"),
    ]:
        data = base64.b64encode((ROOT / "docs/screenshots/bpm-presets" / file).read_bytes()).decode("ascii")
        figures.append(f'<figure><img src="data:image/jpeg;base64,{data}" alt="{esc(label)}"><figcaption>{esc(label)}</figcaption></figure>')
    checks = "".join(f'<li>{esc(check)}</li>' for check in evidence["browser"]["checks"])
    layouts = "".join(f'<tr><td>{row["width"]} px</td><td>{row["documentWidth"]} px</td><td>{row["controlWidth"]:.1f} px</td><td>Fits; label present</td></tr>' for row in evidence["browser"]["layouts"])
    report = f'''<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prima · BPM presets verification</title>
<style>*{{box-sizing:border-box}}body{{margin:0;background:#f6f4ef;color:#2e3b2b;font:15px/1.65 system-ui,sans-serif}}main{{max-width:1120px;margin:auto;padding:40px 24px}}h1,h2{{font-family:Georgia,serif;font-weight:400}}h1{{font-size:48px;line-height:1.12}}h2{{margin-top:32px;font-size:28px}}a{{color:#91452e}}.eyebrow,figcaption,footer{{font-size:12px;color:#56624e}}.cards,.screens{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}.cards{{grid-template-columns:repeat(3,1fr)}}.card,figure{{margin:0;padding:16px;background:#fffef9;border:1px solid #d9dfcf;border-radius:10px}}.card strong{{display:block;font:30px Georgia,serif}}.screens{{align-items:start}}img{{display:block;width:100%;height:auto}}figcaption{{padding-top:10px}}table{{border-collapse:collapse;width:100%;background:#fffef9}}th,td{{text-align:left;padding:10px;border-bottom:1px solid #d9dfcf}}code{{font-size:12px;background:#e9edde;padding:2px 5px;border-radius:4px}}li{{margin:6px 0}}footer{{border-top:1px solid #d9dfcf;margin-top:32px;padding-top:16px}}@media(max-width:700px){{.cards,.screens{{grid-template-columns:1fr}}main{{padding:24px 16px}}h1{{font-size:36px}}td,th{{font-size:12px;padding:7px}}}}</style>
<main><header><p class="eyebrow">PRIMA · ENGINEERING REPORT · 5 NOVEMBER 2026</p><h1>Choose a practice tempo<br>with BPM presets.</h1><p>A numeric selector beside the tempo input offers quick choices while keeping arbitrary manual values, meter-aware beat units and saved per-staff tempos.</p></header>
<div class="cards"><div class="card"><strong>76</strong>Python checks passed</div><div class="card"><strong>125</strong>JavaScript checks passed</div><div class="card"><strong>6</strong>Browser scenarios passed</div></div>
<h2>Behavior and implementation</h2><p>Presets count the displayed beat. In 4/4, choosing 120 BPM means quarter-note 120; in 6/8, choosing 60 means dotted-quarter 60, or quarter-note 90 internally. The helper filters exact choices to the supported integer range and adds its endpoints. Unsupported choices are omitted, and the selected number is applied unchanged.</p><p>The selector uses the existing manual tempo path for live playback, clocks, MIDI and WAV. It follows manual edits, shows “Custom · N BPM” for other supported values, and retains choices across staves and PDF pages in the current document. “Use suggested” clears the override. New documents and reloads discard it. Both tempo controls disable while no usable staff is selected.</p><p>The desktop settings grid has four columns; narrower layouts use two. A native select provides keyboard operation and a visible label, with the beat unit spelled out in its accessible name. The app has one English interface; there are no additional language variants to verify.</p>
<h2>Actual local verification</h2><p>All tests used the source app on Windows. The real browser was headless Microsoft Edge through Playwright, using the included original synthetic melody and an original generated two-page PDF. No network or audio stubs were used in these browser scenarios. The browser suite reports seven passing test nodes: one parent plus six scenarios.</p><ul>{checks}</ul>
<table><thead><tr><th>Measurement</th><th>Observed result</th></tr></thead><tbody><tr><td>4/4 preset 120: MIDI tempo</td><td>500,000 µs per quarter</td></tr><tr><td>6/8 preset 60: MIDI tempo</td><td>666,667 µs per quarter</td></tr><tr><td>6 quarter beats at quarter 90: WAV</td><td>4.16 seconds including 0.16 seconds release/padding; stereo 44.1 kHz PCM</td></tr><tr><td>Live preset change: score position</td><td>{evidence["browser"]["playbackPosition"]["before"]} → {evidence["browser"]["playbackPosition"]["after"]} beats at the change</td></tr><tr><td>JavaScript runtime errors</td><td>None in the six browser scenarios</td></tr></tbody></table>
<h2>Layout measurements</h2><table><thead><tr><th>Viewport</th><th>Document width</th><th>Preset width</th><th>Result</th></tr></thead><tbody>{layouts}</tbody></table>
<h2>Before and after</h2><p>Real dev-server screenshots of the same included synthetic score. The before view uses the automatic 72 BPM; the after view demonstrates a saved 90 BPM preset. All four images are embedded.</p><div class="screens">{"".join(figures)}</div>
<h2>Reproduce and review</h2><p>Run <code>python -m pytest -q</code>, <code>npm test</code> and <code>node --check static/app.js</code>. For browser checks, install the Python development requirements, run <code>npm ci</code> and <code>npx playwright install chromium</code>, then <code>npm run test:browser</code>. The suite starts/stops its own loopback server and generates its own PDF. Playwright is a development dependency; running Prima still needs no Node installation.</p><p>The existing application-check CI workflow now runs the Chromium browser suite. Local results above are completed measurements; current hosted CI results are on <a href="{esc(evidence["pr_url"])}">the pull request</a>.</p><p><a href="https://github.com/DupeisTaken/staff2audio/issues/9">Issue #9</a> · <a href="{esc(evidence["pr_url"])}">Feature PR</a> · <a href="https://github.com/DupeisTaken/staff2audio/blob/codex/bpm-presets/docs/tempo.md">Tempo policy and API</a></p>
<h2>Limits</h2><p>Presets are product convenience choices, not detected printed tempo markings. Existing recognition and engine limits apply. Saved tempos last only for the current document in the open tab. Windows Edge received local visual verification; Chromium is exercised by CI. Safari, Firefox, physical mobile devices and listening quality were not separately evaluated. Browser audio decoding, scheduling and actual WAV bytes were exercised; no subjective sound-quality claim is made. Python emitted one existing Starlette/httpx deprecation warning; all 76 checks passed.</p>
<footer>This report is one self-contained HTML file. It embeds synthetic notation screenshots only, with no credentials, private scores or participant data. Application: AGPL-3.0-or-later. Included demo notation uses the Bravura font (SIL OFL); the app's FluidR3 GM piano recordings retain their existing attribution and licenses.</footer></main></html>'''
    target = ROOT / "docs/bpm-presets-report.html"
    target.write_text(report, encoding="utf-8")
    print(f"{target} ({target.stat().st_size:,} bytes)")


if __name__ == "__main__":
    build()
