import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PianoPlayer, prepareEvents, scoreDuration, tempoValue, transposeMidi, noteNumber, nearestSample, encodeMidi, encodeWav } from '../static/piano.js';

const note = (midi = 60, onset = 0, duration = 1) => ({ id: `${midi}-${onset}`, midi, onset, duration });
const param = () => ({ value: 1, calls: [], setValueAtTime(...a) { this.calls.push(a); }, linearRampToValueAtTime(...a) { this.calls.push(a); }, setTargetAtTime(...a) { this.calls.push(a); }, cancelScheduledValues(...a) { this.calls.push(a); } });
class FakeContext {
  constructor() { this.currentTime = 10; this.destination = {}; this.sources = []; }
  createGain() { return { gain: param(), connect() {}, disconnect() {} }; }
  createBufferSource() {
    const source = { playbackRate: param(), connect() {}, disconnect() {}, start(...args) { this.started = args; }, stop(time) { this.stops ||= []; this.stops.push(time); } };
    this.sources.push(source); return source;
  }
  async resume() { this.resumed = true; }
}
function player(callbacks = {}) {
  const p = new PianoPlayer(callbacks); p.context = new FakeContext(); p.master = p.context.createGain();
  p.buffers = new Map([[60, { duration: 20 }], [64, { duration: 20 }]]);
  p.load = async () => p;
  return p;
}
function readMidi(bytes) {
  const events = []; let offset = 22, tick = 0;
  const variable = () => { let n = 0, byte; do { byte = bytes[offset++]; n = n * 128 + (byte & 127); } while (byte & 128); return n; };
  while (offset < bytes.length) {
    tick += variable(); const status = bytes[offset++];
    if (status === 0xff) { const type = bytes[offset++], count = variable(); events.push({ tick, status, type, data: [...bytes.slice(offset, offset + count)] }); offset += count; }
    else { const count = status === 0xc0 ? 1 : 2; events.push({ tick, status, data: [...bytes.slice(offset, offset + count)] }); offset += count; }
  }
  return events;
}

test('tempo boundaries, MIDI transposition and nearest sampled key', () => {
  assert.equal(tempoValue(15), 30); assert.equal(tempoValue(400), 240); assert.equal(tempoValue(NaN), 90);
  assert.equal(transposeMidi(60, 12), 72); assert.equal(transposeMidi(4, -12), 0); assert.equal(transposeMidi(125, 12), 127);
  assert.equal(noteNumber('A0'), 21); assert.equal(noteNumber('Bb4'), 70); assert.equal(noteNumber('C8'), 108);
  assert.equal(nearestSample(72, new Map([[60, {}]])).rate, 2);
});

test('score validation preserves rests and stable same-onset chords', () => {
  const events = prepareEvents([note(null, 4, 2), note(60), note(64)]);
  assert.deepEqual(events.map(n => n.midi), [60, 64, null]); assert.equal(scoreDuration(events), 6);
  for (const event of [note(60, -1), note(60, 0, 0), note(200), note(NaN)]) assert.throws(() => prepareEvents([event]), /Invalid/);
});

test('MIDI contains grand piano, tempo, transposition, rests and ordered retriggers', () => {
  const bytes = encodeMidi([note(60), note(60, 1), note(null, 2, 2)], { tempo: 120, transpose: 2 });
  assert.equal(Buffer.from(bytes.slice(0, 4)).toString(), 'MThd');
  assert.equal(new DataView(bytes.buffer).getUint32(18), bytes.length - 22);
  const events = readMidi(bytes);
  assert.deepEqual(events[0].data, [7, 161, 32]); assert.equal(events[1].status, 0xc0); assert.deepEqual(events[1].data, [0]);
  assert.deepEqual(events.filter(e => e.tick === 480).map(e => e.status), [0x80, 0x90]);
  assert.deepEqual(events.find(e => e.status === 0x90).data, [62, 90]);
  assert.equal(events.at(-1).tick, 1920); assert.equal(events.at(-1).type, 0x2f);
});

test('WAV is little-endian signed PCM stereo with clipping and interleaving', () => {
  const bytes = encodeWav({ numberOfChannels: 2, length: 3, sampleRate: 44100,
    getChannelData(i) { return i ? [0.5, -0.5, 2] : [-2, 0, 1]; } });
  const view = new DataView(bytes);
  assert.equal(Buffer.from(bytes.slice(0, 4)).toString(), 'RIFF'); assert.equal(view.getUint32(4, true), 48);
  assert.equal(view.getUint16(22, true), 2); assert.equal(view.getUint32(28, true), 176400);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true)), [-32768, 16384, 0, -16384, 32767, 32767]);
});

test('scheduler uses audio-clock time for tempo and transpose, with acoustic release', async () => {
  const p = player();
  try {
    await p.play([note(60), note(null, 1), note(64, 2)], { tempo: 120, transpose: 12 });
    assert.equal(p.context.sources.length, 2);
    assert.ok(Math.abs(p.context.sources[0].started[0] - 10.035) < 1e-9);
    assert.ok(Math.abs(p.context.sources[1].started[0] - 11.035) < 1e-9);
    assert.equal(p.context.sources[0].playbackRate.value, 2 ** (8 / 12));
    assert.ok(Math.abs(p.context.sources[0].stops[0] - 10.68) < 1e-9);
  } finally { p.stop(); }
});

test('pause retains exact beat, resume preserves tempo and stop resets', async () => {
  const p = player();
  try {
    await p.play([note(60, 0, 4)], { tempo: 120 });
    p.context.currentTime = 10.785; p.pause();
    assert.ok(Math.abs(p.currentBeat - 1.5) < 1e-9); assert.equal(p.state, 'paused');
    assert.ok(Math.abs(p.context.sources[0].stops.at(-1) - 10.805) < 1e-9);
    await p.play(); assert.equal(p.tempo, 120);
    assert.ok(Math.abs(p.context.sources.at(-1).started[1] - 0.75) < 1e-9);
    p.stop(); assert.equal(p.currentBeat, 0); assert.equal(p.state, 'stopped');
  } finally { p.stop(); }
});

test('seek cancels queued notes, keeps settings and offsets a sustained note', async () => {
  const p = player();
  try {
    await p.play([note(60, 0, 4), note(64, 4)], { tempo: 60 });
    const old = p.context.sources[0]; await p.seek(2);
    assert.equal(old.stops.at(-1), 10.02);
    assert.deepEqual(p.context.sources.at(-1).started, [10.035, 2]);
    assert.equal(p.currentBeat, 2); assert.equal(p.state, 'playing');
  } finally { p.stop(); }
});

test('stop or a later play cannot resurrect pending asynchronous playback', async () => {
  const p = player(); let resolve;
  p.load = () => new Promise(r => { resolve = r; });
  const pending = p.play([note()]); p.stop(); resolve(); await pending;
  assert.equal(p.state, 'stopped'); assert.equal(p.context.sources.length, 0); assert.equal(p._timer, null);
});

test('loop scheduling crosses boundaries exactly and recovers phase after a late timer', async () => {
  const p = player();
  try {
    await p.play([note(60, 0, 4)], { tempo: 120, fromBeat: 2, loop: true });
    assert.deepEqual(p.context.sources.map(s => s.started[0]), [10.035, 11.035]);
    p.context.currentTime = 21.235; p._tick();
    assert.ok(Math.abs(p.currentBeat - 0.4) < 1e-9);
    const latest = p.context.sources.at(-1);
    assert.ok(latest.started[0] >= 21.235);
    assert.ok(latest.started[0] <= 23.235);
  } finally { p.stop(); }
});

test('natural completion shows end position and a subsequent play starts again', async () => {
  const progress = [], states = [], p = player({ onProgress: (...a) => progress.push(a), onState: s => states.push(s) });
  try {
    await p.play([note()], { tempo: 60 }); p.context.currentTime = 11.1; p._tick();
    assert.equal(p.state, 'stopped'); assert.equal(p.currentBeat, 1); assert.equal(p._timer, null);
    await p.play(); assert.equal(p.currentBeat, 0); assert.equal(states.at(-1), 'playing');
    assert.ok(progress.some(([beat, duration]) => beat === duration));
  } finally { p.stop(); }
});

test('rests are silent; zero-volume and empty-score controls remain usable', async () => {
  const p = player();
  try {
    p.setVolume(0); assert.equal(p._volume, 0);
    await p.play([note(null, 0, 4)]); assert.equal(p.context.sources.length, 0);
    await p.play([]); assert.equal(p.state, 'stopped'); assert.equal(p.duration, 0);
  } finally { p.stop(); }
});

test('bundled sample data is nonexecutable, complete, and contains MPEG frames', async () => {
  const collection = JSON.parse(await fs.readFile(new URL('../static/audio/grand-piano.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(collection.samples).length, 88);
  assert.match(collection.source, /044fab8e1456bfafc5776e86dfd6bb8697149aef/);
  assert.deepEqual(Object.keys(collection.samples).map(noteNumber).sort((a,b) => a-b), Array.from({ length: 88 }, (_, i) => i + 21));
  for (const data of Object.values(collection.samples)) {
    assert.match(data, /^data:audio\/mp3;base64,/); const bytes = Buffer.from(data.split(',')[1], 'base64');
    assert.ok(bytes.length > 1000); assert.equal(bytes[0], 255); assert.equal(bytes[1] & 0xe0, 0xe0);
  }
});

test('load fetches only local data, decodes with bounded concurrency, is idempotent and retries failures', async () => {
  const originalFetch = globalThis.fetch, originalContext = globalThis.AudioContext;
  const collection = JSON.parse(await fs.readFile(new URL('../static/audio/grand-piano.json', import.meta.url), 'utf8'));
  let requests = 0, active = 0, maximum = 0;
  class DecodeContext extends FakeContext {
    async decodeAudioData(data) {
      assert.ok(data.byteLength > 1000); active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setImmediate(resolve)); active--; return { duration: 3 };
    }
  }
  globalThis.AudioContext = DecodeContext;
  globalThis.fetch = async url => {
    requests++; assert.match(url.pathname, /\/static\/audio\/grand-piano.json$/);
    return { ok: requests !== 1, json: async () => collection };
  };
  try {
    const p = new PianoPlayer();
    await assert.rejects(p.load(), /local piano samples/);
    await Promise.all([p.load(), p.load()]); await p.load();
    assert.equal(requests, 2); assert.equal(p.buffers.size, 88); assert.equal(maximum, 4);
  } finally { globalThis.fetch = originalFetch; globalThis.AudioContext = originalContext; }
});

test('WAV rendering uses complete score, current gain and transposition without moving transport', async () => {
  const originalOffline = globalThis.OfflineAudioContext; let rendered;
  class Offline extends FakeContext {
    constructor(channels, length, sampleRate) { super(); Object.assign(this, { channels, length, sampleRate }); rendered = this; }
    async startRendering() { return { numberOfChannels: this.channels, length: this.length, sampleRate: this.sampleRate, getChannelData: () => new Float32Array(this.length) }; }
  }
  globalThis.OfflineAudioContext = Offline;
  const p = player();
  try {
    p.setVolume(0.4); p._beat = 1.5;
    const blob = await p.exportWav([note(60, 1, 2), note(null, 3, 1)], { tempo: 120, transpose: 4 });
    assert.equal(blob.type, 'audio/wav'); assert.equal(rendered.channels, 2); assert.equal(rendered.sampleRate, 44100);
    assert.equal(rendered.length, Math.ceil(2.16 * 44100));
    assert.deepEqual(rendered.sources[0].started, [0.5, 0]); assert.equal(rendered.sources[0].playbackRate.value, 1);
    assert.equal(p.currentBeat, 1.5); assert.equal(p.state, 'stopped');
    await assert.rejects(p.exportWav([note(60, 0, 1000)], { tempo: 30 }), /10 minutes/);
  } finally { globalThis.OfflineAudioContext = originalOffline; p.stop(); }
});

test('missing Web Audio returns the useful error and resets playback state', async () => {
  const originalAudio = globalThis.AudioContext, originalWebkit = globalThis.webkitAudioContext;
  delete globalThis.AudioContext; delete globalThis.webkitAudioContext;
  try { const p = new PianoPlayer(); await assert.rejects(p.play([note()]), /does not support Web Audio/); assert.equal(p.state, 'stopped'); }
  finally { globalThis.AudioContext = originalAudio; globalThis.webkitAudioContext = originalWebkit; }
});
