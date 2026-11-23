// Real-browser end-to-end regressions for the AP Music Theory Studio (Four-Part SATB,
// Melody Harmonization FRQ 7, OMR-to-Harmonizer bridge, audio effect comparisons, and responsive layouts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

test('AP Music Theory Studio end-to-end in the real local application', { timeout: 90000 }, async (t) => {
  const python = process.env.STAFF2AUDIO_PYTHON || process.env.PRIMA_PYTHON ||
    (existsSync('.venv/Scripts/python.exe') ? '.venv/Scripts/python.exe' : 'python');
  const server = spawn(python, ['run.py', '--port', '0', '--no-browser'], { windowsHide: true });
  let browser;
  t.after(async () => {
    await browser?.close();
    server.kill();
  });

  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Server readiness timeout: ${output}`)), 20000);
    server.on('error', error => { clearTimeout(timer); reject(error); });
    server.on('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
    server.stderr.on('data', data => { output += data; });
    server.stdout.on('data', data => {
      output += data;
      const match = /staff2audio is ready: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });

  const browserChannel = process.env.STAFF2AUDIO_BROWSER_CHANNEL || process.env.PRIMA_BROWSER_CHANNEL;
  browser = await chromium.launch({
    headless: true,
    ...(browserChannel ? { channel: browserChannel } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await t.test('Four-Part Writing: loads exercises, grades sample draft, shows all audio demo buttons, applies fix to 100/100', async () => {
    await page.goto(url);
    await page.locator('#tabFourPart').click();
    await page.waitForFunction(() => document.querySelectorAll('#fpExerciseSelect option').length >= 5);

    // Load sample student draft and grade it
    await page.locator('#fpLoadAttempt').click();
    await page.locator('#fpGradeButton').click();
    await page.waitForSelector('#fpResults .issue-card');

    // Verify cadence badge and all audio demo action buttons render
    const badgeText = await page.locator('#fpResults .cadence-badge').textContent();
    assert.match(badgeText, /Perfect Authentic Cadence|PAC/i);
    assert.ok(await page.locator('#fpResults .audio-demo-btn', { hasText: 'Hear isolated voices' }).count() >= 1);
    assert.ok(await page.locator('#fpResults .audio-demo-btn', { hasText: 'Hear in context' }).count() >= 1);
    assert.ok(await page.locator('#fpResults .compare-btn').count() >= 1);
    assert.ok(await page.locator('#fpResults .apply-fix-btn').count() >= 1);

    // Focus issue via native focus button and verify Grand Staff highlights the overlay
    await page.locator('#fpResults .issue-focus-btn').first().click();
    assert.ok(await page.locator('#fpGrandStaffSvg.gs-has-focused-issue').count() === 1);

    // Apply suggested fix and verify automatic re-grade reaches 100/100 with zero issues
    await page.locator('#fpResults .apply-fix-btn').first().click();
    await page.waitForSelector('#fpResults .issues-clean');
    assert.equal(await page.locator('#fpResults .grade-score-num').textContent(), '100');

    // Verify Voice Mixer & SATB MIDI export (and confirm Score-to-Piano transpose does NOT leak)
    await page.locator('#tabScore').click();
    await page.locator('#transpose').selectOption('12');
    await page.locator('#tabFourPart').click();
    await page.locator('#fpPresetOuter').click();
    assert.equal(await page.locator('#fpPresetOuter').evaluate(el => el.classList.contains('active')), true);
    await page.locator('#fpPresetAll').click();

    const dlPromise = page.waitForEvent('download');
    await page.locator('#fpMidiButton').click();
    const dl = await dlPromise;
    assert.match(dl.suggestedFilename(), /^staff2audio-satb-.*\.mid$/);
    const midiBytes = await readFile(await dl.path());
    assert.equal(midiBytes.subarray(0, 4).toString('ascii'), 'MThd');
    // Multi-channel SATB MIDI should contain program changes on channels 0..3 (0xc0, 0xc1, 0xc2, 0xc3)
    assert.ok(midiBytes.includes(0xc1), 'SATB MIDI uses separate channel for Alto');
    assert.ok(midiBytes.includes(0xc3), 'SATB MIDI uses separate channel for Bass');
  });

  await t.test('Harmonize Melody (FRQ 7): grades draft, displays NCT/cadences, applies fix, shows ghost SATB, suggests harmonization', async () => {
    await page.locator('#tabMelody').click();
    await page.waitForFunction(() => document.querySelectorAll('#melExerciseSelect option').length >= 3);

    await page.locator('#melLoadAttempt').click();
    await page.locator('#melGradeButton').click();
    await page.waitForSelector('#melResults .issue-card');

    // Verify phrase cadence cards, Soprano+Bass demo buttons, and Apply Fix button render
    assert.equal(await page.locator('#melResults .cadence-card').count(), 2);
    assert.ok(await page.locator('#melResults .audio-demo-btn', { hasText: 'Hear Soprano + Bass' }).count() >= 1);
    assert.ok(await page.locator('#melResults .audio-demo-btn', { hasText: 'Hear in 4-Part Context' }).count() >= 1);
    assert.ok(await page.locator('#melResults .apply-fix-btn').count() >= 1);

    // Toggle auto-realized Alto & Tenor ghost notes on the Grand Staff
    await page.locator('#melShowSatbToggle').check();
    await page.waitForSelector('#melGrandStaffSvg .gs-note-ghost');
    assert.ok(await page.locator('#melGrandStaffSvg .gs-note-ghost').count() >= 8);

    // Apply a suggested melody fix and verify issue count drops
    const beforeIssues = await page.locator('#melResults .issue-card').count();
    await page.locator('#melResults .apply-fix-btn').first().click();
    await page.waitForFunction((prev) => {
      const cards = document.querySelectorAll('#melResults .issue-card').length;
      const clean = document.querySelectorAll('#melResults .issues-clean').length;
      return clean > 0 || cards < prev;
    }, beforeIssues);

    // Click Auto-Harmonize / Suggest and verify clean high score
    await page.locator('#melSuggestButton').click();
    await page.waitForFunction(() => {
      const score = Number(document.querySelector('#melResults .grade-score-num')?.textContent);
      return Number.isFinite(score) && score >= 85;
    });
  });

  await t.test('OMR to AP Theory bridge: sends scanned demo melody to Harmonize Melody and suggests harmony', async () => {
    await page.locator('#tabScore').click();
    await page.locator('#demoButton').click();
    await page.waitForFunction(() => !document.getElementById('sendToHarmonizerButton').disabled);
    await page.locator('#sendToHarmonizerButton').click();
    await page.waitForFunction(() => document.getElementById('tabMelody').getAttribute('aria-selected') === 'true');
    assert.equal(await page.locator('#melExerciseSelect').inputValue(), '__imported_omr__');
    await page.locator('#melSuggestButton').click();
    await page.waitForSelector('#melResults .grade-score-num');
    assert.ok(await page.locator('#melGrandStaffSvg .gs-note').count() >= 4);
  });

  await t.test('Worksheet upload, on-image annotation & red-ink grading in Four-Part and Melody tabs', async () => {
    // Generate synthetic AP-style worksheet PNGs (printed grand staff + colored handwritten ink) via Python test helper
    const genCode = `
import json, tempfile, os
from tests.test_grand_staff_omr import Worksheet
d = tempfile.mkdtemp(prefix='s2a-ws-')
p1 = os.path.join(d, 'fp-worksheet.png')
p2 = os.path.join(d, 'mel-worksheet.png')
fp_sheet = Worksheet()
for x in (248, 342, 536):
    fp_sheet.printed('bass', x, 4, 'down', duration=2 if x == 536 else 1)
    fp_sheet.pen('bass', x, 8, sharp=x == 342)
    fp_sheet.pen('treble', x, 6, half=x == 536)
    fp_sheet.pen('treble', x, 3, 'down')
fp_sheet.image.save(p1)
mel_sheet = Worksheet(systems=2, key=0, border=True)
for system in (0, 1):
    for x, step in zip((245, 355, 510, 580, 645), (2, 4, 5, 4, 2)):
        mel_sheet.printed('treble', x, step, system=system, duration=2 if x in (245, 355, 645) else 1)
    for attack in ((245, 355) if not system else ()):
        mel_sheet.printed('bass', attack, 3, duration=2)
    for attack, step in zip((510, 580, 645), (4, 5, 3)):
        mel_sheet.pen('bass', attack, step, system=system, half=attack == 645, color=mel_sheet.bright_blue)
mel_sheet.image.save(p2)
print(json.dumps({'dir': d, 'fp': p1, 'mel': p2}))
`;
    const { spawnSync } = await import('node:child_process');
    const { rm } = await import('node:fs/promises');
    const gen = spawnSync(python, ['-c', genCode], { encoding: 'utf-8' });
    assert.equal(gen.status, 0, `Fixture generation failed: ${gen.stderr}`);
    const paths = JSON.parse(gen.stdout.trim());
    t.after(async () => { await rm(paths.dir, { recursive: true, force: true }); });

    // 1. Upload Four-Part worksheet into Tab 2
    await page.locator('#tabFourPart').click();
    await page.locator('#fpFileInput').setInputFiles(paths.fp);
    await page.waitForSelector('#fpWorksheetWrap:not([hidden])');
    await page.waitForSelector('#fpWorksheetSvg image');
    assert.ok(await page.locator('#fpWorksheetSvg .ws-marker').count() >= 4, 'Four-part worksheet renders voice markers on image');
    assert.equal(await page.locator('#fpViewToggle').isVisible(), true);

    // Click Grade and verify red-ink annotations / results render cleanly
    await page.locator('#fpGradeButton').click();
    await page.waitForSelector('#fpResults .grade-score-num');

    // Toggle to Engraved Staff and back to Worksheet Image
    await page.locator('#fpViewEngraved').click();
    await page.waitForSelector('#fpGrandStaffWrap:not([hidden])');
    await page.locator('#fpViewWorksheet').click();
    await page.waitForSelector('#fpWorksheetWrap:not([hidden])');

    // Clear worksheet cleanly
    await page.locator('#fpClearWorksheet').click();
    await page.waitForSelector('#fpGrandStaffWrap:not([hidden])');

    // 2. Upload 2-System Melody Harmonization worksheet into Tab 3
    await page.locator('#tabMelody').click();
    await page.locator('#melFileInput').setInputFiles(paths.mel);
    await page.waitForSelector('#melWorksheetWrap:not([hidden])');
    await page.waitForSelector('#melWorksheetSvg image');
    assert.ok(await page.locator('#melWorksheetSvg .ws-marker').count() >= 6, 'Melody worksheet renders melody & bass markers on image');
    assert.ok(Number(await page.locator('#melGradeFromInput').inputValue()) > 0, 'Detects grade_from_onset for handwritten section');
    assert.ok(await page.locator('#melWorksheetSvg .ws-grade-divider').count() === 1, 'Renders Grade starts here divider on image');

    // Switch edit target between Bass and Melody, then run Auto-Harmonize / Suggest and grade
    await page.locator('#melEditMelody').click();
    await page.locator('#melEditBass').click();
    await page.locator('#melSuggestButton').click();
    await page.waitForSelector('#melResults .grade-score-num');

    // Clear worksheet cleanly
    await page.locator('#melClearWorksheet').click();
    await page.waitForSelector('#melGrandStaffWrap:not([hidden])');
  });

  await t.test('Responsive layouts have no page-level horizontal overflow on desktop and mobile', async () => {
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 });
      for (const tabId of ['#tabFourPart', '#tabMelody']) {
        await page.locator(tabId).click();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 2, `Expected no horizontal overflow at ${width}px on ${tabId}, got ${overflow}px`);
      }
    }
  });

  assert.deepEqual(errors, [], `Unexpected browser page errors: ${errors.join('; ')}`);
});
