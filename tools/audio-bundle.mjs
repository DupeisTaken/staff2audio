import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const commit = '044fab8e1456bfafc5776e86dfd6bb8697149aef';
const url = `https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/${commit}/FluidR3_GM/acoustic_grand_piano-mp3.js`;
const response = await fetch(url);
if (!response.ok) throw new Error(`Sample download failed: HTTP ${response.status}`);
const source = await response.text();
const hash = crypto.createHash('sha256').update(source).digest('hex');
const expected = '00eebe0214c12ff8f32c47c2f7ac92ef352800e868ab0f883b80854486ac4ca6';
if (hash !== expected) throw new Error(`Source integrity mismatch: ${hash}`);
// Extract only literal MP3 data: never evaluate the downloaded JavaScript.
const samples = Object.fromEntries([...source.matchAll(/"([A-G]b?\d+)"\s*:\s*"(data:audio\/mp3;base64,[A-Za-z0-9+/=]+)"/g)].map(m => [m[1], m[2]]));
if (Object.keys(samples).length !== 88) throw new Error(`Expected 88 piano keys, received ${Object.keys(samples).length}`);
await fs.mkdir('static/audio', { recursive: true });
await fs.writeFile('static/audio/grand-piano.json', JSON.stringify({ instrument: 'FluidR3 GM Acoustic Grand Piano', source: url, sha256: hash, samples }));
console.log(`Bundled ${Object.keys(samples).length} samples (${source.length} source bytes)`);
