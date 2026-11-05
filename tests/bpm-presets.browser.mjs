// Optional real-browser regressions. Run `npm ci`, `npx playwright install chromium`,
// then `npm run test:browser`; Python dependencies must already be installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

test('BPM presets in the real local application', { timeout: 90000 }, async (t) => {
  const python = process.env.PRIMA_PYTHON ||
    (existsSync('.venv/Scripts/python.exe') ? '.venv/Scripts/python.exe' : 'python');
  const temporary = await mkdtemp(join(tmpdir(), 'prima-bpm-'));
  const server = spawn(python, ['run.py', '--port', '0', '--no-browser'], { windowsHide: true });
  let browser;
  t.after(async () => {
    await browser?.close();
    server.kill(); // Only the server created by this test.
    await rm(temporary, { recursive: true, force: true });
  });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Server readiness timeout: ${output}`)), 20000);
    server.on('error', error => { clearTimeout(timer); reject(error); });
    server.on('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
    server.stderr.on('data', data => { output += data; });
    server.stdout.on('data', data => {
      output += data;
      const match = /Prima is ready: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PRIMA_BROWSER_CHANNEL ? { channel: process.env.PRIMA_BROWSER_CHANNEL } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const preset = page.locator('#tempoPreset'), tempo = page.locator('#tempo');
  const evidence = { checks: [], layouts: [], exports: {} };
  const loadDemo = async () => {
    await page.goto(url);
    await page.locator('#demoButton').click();
    await page.waitForFunction(() => !document.getElementById('tempoPreset').disabled);
  };
  const downloadBytes = async (id) => {
    const pending = page.waitForEvent('download');
    await page.locator(id).click();
    return readFile(await (await pending).path());
  };
  const midiTempo = bytes => {
    const offset = bytes.indexOf(Buffer.from([0xff, 0x51, 0x03]));
    assert.ok(offset >= 0, 'MIDI has a tempo event');
    return bytes.readUIntBE(offset + 3, 3);
  };

  await t.test('disabled without a staff; presets, manual custom values and reset stay in sync', async () => {
    await page.goto(url);
    assert.equal(await preset.isDisabled(), true);
    await loadDemo();
    assert.equal(await preset.inputValue(), '72');
    await preset.selectOption('120');
    assert.equal(await tempo.inputValue(), '120');
    assert.equal(await page.locator('#totalTime').textContent(), '0:04');
    evidence.exports.quarterMidiMicroseconds = midiTempo(await downloadBytes('#midiButton'));
    assert.equal(evidence.exports.quarterMidiMicroseconds, 500000);
    await tempo.fill('73');
    await tempo.blur();
    assert.equal(await preset.inputValue(), '');
    assert.equal(await preset.locator('option:checked').textContent(), 'Custom · 73 BPM');
    await tempo.fill('56');
    assert.equal(await preset.inputValue(), '56');
    await page.locator('#autoTempoButton').click();
    assert.equal(await tempo.inputValue(), '72');
    assert.equal(await preset.inputValue(), '72');
    assert.equal(await page.locator('#autoTempoButton').isDisabled(), true);
  });

  await t.test('compound presets use dotted beats, retain per-staff choices and export exact timing', async () => {
    await preset.selectOption('90');
    await page.locator('.staff-item').nth(1).click();
    assert.equal(await preset.inputValue(), '48');
    assert.match(await preset.getAttribute('aria-label'), /dotted quarter note/);
    const values = await preset.locator('option').evaluateAll(options => options.filter(o => o.value).map(o => Number(o.value)));
    assert.equal(values[0], 20);
    assert.equal(values.at(-1), 160);
    assert.ok(!values.includes(180));
    await preset.selectOption('60');
    assert.equal(await page.locator('#totalTime').textContent(), '0:04');
    evidence.exports.compoundMidiMicroseconds = midiTempo(await downloadBytes('#midiButton'));
    assert.equal(evidence.exports.compoundMidiMicroseconds, 666667);
    const wav = await downloadBytes('#wavButton');
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.readUInt32LE(24), 44100);
    evidence.exports.compoundWavSeconds = wav.readUInt32LE(40) / (44100 * 4);
    assert.ok(Math.abs(evidence.exports.compoundWavSeconds - 4.16) < 1 / 44100);
    await page.locator('.staff-item').first().click();
    assert.equal(await preset.inputValue(), '90');
    await page.locator('.staff-item').nth(1).click();
    assert.equal(await preset.inputValue(), '60');
    await page.locator('#autoTempoButton').click();
    assert.equal(await preset.inputValue(), '48');
  });

  await t.test('a preset change during playback retains the score position and supports pause/resume', async () => {
    await page.locator('.staff-item').first().click();
    await preset.selectOption('30');
    await page.locator('#playButton').click();
    await page.waitForFunction(() => Number(document.getElementById('seek').value) > 0.2);
    const before = Number(await page.locator('#seek').inputValue());
    await preset.selectOption('120');
    await page.waitForFunction(() => document.getElementById('playLabel').textContent === 'Pause');
    const after = Number(await page.locator('#seek').inputValue());
    assert.ok(after >= before - 0.05 && after < before + 1, `${before} -> ${after}`);
    await page.locator('#playButton').click();
    assert.equal(await page.locator('#playLabel').textContent(), 'Resume');
    await preset.selectOption('80');
    assert.equal(await page.locator('#playLabel').textContent(), 'Resume');
    await page.locator('#playButton').click();
    assert.equal(await page.locator('#playLabel').textContent(), 'Pause');
    await page.locator('#stopButton').click();
    evidence.playbackPosition = { before, after };
  });

  await t.test('native keyboard selection keeps focus and does not trigger the playback shortcut', async () => {
    await preset.selectOption('72');
    await preset.focus();
    await preset.press('ArrowDown');
    await preset.press('Enter');
    assert.equal(await preset.inputValue(), '80');
    assert.equal(await tempo.inputValue(), '80');
    assert.equal(await page.locator('#playLabel').textContent(), 'Play staff');
    assert.equal(await preset.evaluate(el => el === document.activeElement), true);
  });

  await t.test('PDF page navigation retains presets and custom values; a new score clears overrides', async () => {
    const demo = await (await fetch(`${url}/api/demo`)).json();
    const image = join(temporary, 'synthetic.png'), pdf = join(temporary, 'synthetic.pdf');
    await writeFile(image, Buffer.from(demo.preview.split(',')[1], 'base64'));
    const generated = spawnSync(python, ['-c',
      'import fitz, sys; doc=fitz.open(); [(lambda p: p.insert_image(p.rect, filename=sys.argv[1]))(doc.new_page(width=980,height=600)) for _ in range(2)]; doc.save(sys.argv[2])',
      image, pdf], { windowsHide: true, encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    await page.locator('#fileInput').setInputFiles(pdf);
    await page.waitForFunction(() => document.getElementById('scanProgress').textContent.includes('2 of 2 scanned'));
    await page.locator('.staff-item').first().click();
    await preset.selectOption('100');
    await page.locator('#pageSelect').selectOption('2');
    await page.waitForFunction(() => !document.getElementById('tempoPreset').disabled);
    await tempo.fill('77');
    await tempo.blur();
    await page.locator('#pageSelect').selectOption('1');
    await page.waitForFunction(() => document.getElementById('tempoPreset').value === '100');
    await page.locator('#pageSelect').selectOption('2');
    await page.waitForFunction(() => document.getElementById('tempo').value === '77');
    assert.equal(await preset.inputValue(), '');
    await loadDemo();
    assert.equal(await preset.inputValue(), '72');
    assert.equal(await page.locator('#autoTempoButton').isDisabled(), true);
  });

  await t.test('desktop, tablet and narrow mobile layouts fit with readable, labeled controls', async () => {
    const folder = process.env.PRIMA_SCREENSHOTS;
    if (folder) await mkdir(folder, { recursive: true });
    await preset.selectOption('90');
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: width > 700 ? 1100 : 844 });
      const layout = await page.evaluate(() => {
        const select = document.getElementById('tempoPreset'), rect = select.getBoundingClientRect();
        const settings = document.querySelector('.settings').getBoundingClientRect();
        return { width: innerWidth, documentWidth: document.documentElement.scrollWidth,
          controlWidth: rect.width, controlFits: rect.left >= settings.left && rect.right <= settings.right + 1,
          label: select.labels[0].textContent.trim().startsWith('BPM PRESET') };
      });
      assert.ok(layout.documentWidth <= width + 1, `No horizontal overflow at ${width}`);
      assert.ok(layout.controlWidth >= 90 && layout.controlFits && layout.label);
      evidence.layouts.push(layout);
      if (folder && [1440,390].includes(width)) await page.screenshot({
        path: join(folder, width === 1440 ? 'after-desktop.jpg' : 'after-mobile.jpg'),
        type: 'jpeg', quality: 85, fullPage: true,
      });
    }
    assert.deepEqual(errors, []);
  });
  evidence.checks = ['disabled state, custom/manual/reset synchronization', 'compound conversion and per-staff persistence',
    'live playback continuity, pause and resume', 'native keyboard selection and focus',
    'real two-page PDF navigation and new-document reset', 'five desktop/tablet/mobile layouts, no page errors'];
  if (process.env.PRIMA_BROWSER_EVIDENCE)
    await writeFile(process.env.PRIMA_BROWSER_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
});
