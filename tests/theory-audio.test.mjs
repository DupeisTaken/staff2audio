import test from 'node:test';
import assert from 'node:assert/strict';
import { PianoPlayer } from '../static/piano.js';
import {
  balancedVoiceGain,
  buildSatbEvents,
  buildMelodyHarmonizationEvents,
  buildComparisonEvents,
  TheoryAudioController,
} from '../static/theory-audio.js';

const param = () => ({
  value: 1,
  calls: [],
  setValueAtTime(...args) { this.calls.push(['setValueAtTime', ...args]); },
  linearRampToValueAtTime(...args) { this.calls.push(['linearRampToValueAtTime', ...args]); },
  setTargetAtTime(...args) { this.calls.push(['setTargetAtTime', ...args]); },
  cancelScheduledValues(...args) { this.calls.push(['cancelScheduledValues', ...args]); },
});

class FakeContext {
  constructor() {
    this.currentTime = 10;
    this.destination = {};
    this.sources = [];
    this.gains = [];
  }
  createGain() {
    const g = { gain: param(), connect() {}, disconnect() {} };
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const source = {
      playbackRate: param(),
      connect() {},
      disconnect() {},
      start(...args) { this.started = args; },
      stop(time) { this.stops ||= []; this.stops.push(time); },
    };
    this.sources.push(source);
    return source;
  }
  async resume() { this.resumed = true; }
}

function makePlayer(callbacks = {}) {
  const p = new PianoPlayer(callbacks);
  p.context = new FakeContext();
  p.master = p.context.createGain();
  p.buffers = new Map(Array.from({ length: 48 }, (_, i) => [36 + i, { duration: 12 }]));
  p.load = async () => p;
  return p;
}

// ---------------------------------------------------------------------------
// PianoPlayer backward-compatible polyphonic enhancements
// ---------------------------------------------------------------------------

test('PianoPlayer uses event.gain in (0, 1] and defaults to 0.8 otherwise in live and WAV rendering', async () => {
  const p = makePlayer();
  try {
    await p.play([
      { id: 'default', midi: 60, onset: 0, duration: 1 },
      { id: 'custom', midi: 64, onset: 0, duration: 1, gain: 0.35 },
      { id: 'invalid-zero', midi: 67, onset: 0, duration: 1, gain: 0 },
      { id: 'invalid-high', midi: 72, onset: 0, duration: 1, gain: 1.5 },
    ], { tempo: 60 });
    // gains[0] is master; gains[1..4] are voice envelopes in event order.
    const peaks = p.context.gains.slice(1).map(g => g.gain.calls.find(c => c[0] === 'linearRampToValueAtTime')[1]);
    assert.deepEqual(peaks, [0.8, 0.35, 0.8, 0.8]);
  } finally { p.stop(); }

  const originalOffline = globalThis.OfflineAudioContext;
  let rendered;
  class Offline extends FakeContext {
    constructor(channels, length, sampleRate) { super(); Object.assign(this, { channels, length, sampleRate }); rendered = this; }
    async startRendering() { return { numberOfChannels: this.channels, length: this.length, sampleRate: this.sampleRate, getChannelData: () => new Float32Array(this.length) }; }
  }
  globalThis.OfflineAudioContext = Offline;
  try {
    await p.exportWav([
      { id: 'a', midi: 60, onset: 0, duration: 1, gain: 0.42 },
      { id: 'b', midi: 64, onset: 0, duration: 1 },
    ], { tempo: 60 });
    const offlinePeaks = rendered.gains.slice(1).map(g => g.gain.calls.find(c => c[0] === 'linearRampToValueAtTime')[1]);
    assert.deepEqual(offlinePeaks, [0.42, 0.8]);
  } finally {
    globalThis.OfflineAudioContext = originalOffline;
    p.stop();
  }
});

test('PianoPlayer onActiveEvents reports simultaneous chord notes and clears on pause, seek, stop, and end', async () => {
  const snapshots = [];
  const singleNotes = [];
  const p = makePlayer({
    onNote: n => singleNotes.push(n ? n.playedMidi : null),
    onActiveEvents: evs => snapshots.push(evs.map(e => ({ voice: e.voice, playedMidi: e.playedMidi }))),
  });
  const chordScore = [
    { id: 'c0-B', midi: 48, onset: 0, duration: 1, voice: 'B' },
    { id: 'c0-S', midi: 64, onset: 0, duration: 1, voice: 'S' },
    { id: 'c1-B', midi: 55, onset: 1, duration: 1, voice: 'B' },
    { id: 'c1-S', midi: 67, onset: 1, duration: 1, voice: 'S' },
  ];
  try {
    await p.play(chordScore, { tempo: 60, transpose: 2 });
    assert.equal(snapshots.length, 1);
    assert.deepEqual(snapshots[0], [{ voice: 'B', playedMidi: 50 }, { voice: 'S', playedMidi: 66 }]);
    assert.equal(singleNotes[0], 50);

    // Same chord tick should not refire onActiveEvents.
    p.context.currentTime = 10.4;
    p._tick();
    assert.equal(snapshots.length, 1);

    // Second chord fires new active set.
    p.context.currentTime = 11.1;
    p._tick();
    assert.equal(snapshots.length, 2);
    assert.deepEqual(snapshots[1], [{ voice: 'B', playedMidi: 57 }, { voice: 'S', playedMidi: 69 }]);

    // Pause clears active events.
    p.pause();
    assert.deepEqual(snapshots.at(-1), []);

    // Seek while paused emits [].
    const countBeforeSeek = snapshots.length;
    await p.seek(0.5);
    assert.equal(snapshots.length, countBeforeSeek + 1);
    assert.deepEqual(snapshots.at(-1), []);

    // Natural end emits [].
    await p.play(chordScore, { tempo: 60, fromBeat: 1 });
    p.context.currentTime = 12.2;
    p._tick();
    assert.equal(p.state, 'stopped');
    assert.deepEqual(snapshots.at(-1), []);
  } finally { p.stop(); }
});

test('PianoPlayer previewChord supports simultaneous and arpeggiated playback and stop cancellation', async () => {
  const p = makePlayer();
  try {
    await p.previewChord([48, 55, 64, 72], { arpeggiateSec: 0.05, duration: 0.9, gain: 0.4 });
    assert.equal(p.context.sources.length, 4);
    assert.equal(p._voices.size, 4);
    const starts = p.context.sources.map(s => Number((s.started[0] - 10.005).toFixed(4)));
    assert.deepEqual(starts, [0, 0.05, 0.1, 0.15]);
    const peaks = p.context.gains.slice(1).map(g => g.gain.calls.find(c => c[0] === 'linearRampToValueAtTime')[1]);
    assert.deepEqual(peaks, [0.4, 0.4, 0.4, 0.4]);

    p.stop();
    assert.equal(p._voices.size, 0);
    for (const src of p.context.sources) assert.ok(src.stops.at(-1) <= 10.02 + 1e-9);
  } finally { p.stop(); }

  // Generation guard cancels pending previewChord when stop() runs during load.
  let resolveLoad;
  p.load = () => new Promise(r => { resolveLoad = r; });
  const prevCount = p.context.sources.length;
  const pending = p.previewChord([60, 64, 67]);
  p.stop();
  resolveLoad(p);
  await pending;
  assert.equal(p.context.sources.length, prevCount);
});

// ---------------------------------------------------------------------------
// buildSatbEvents
// ---------------------------------------------------------------------------

test('buildSatbEvents balances gain, respects mute/solo, and rolls arpeggios bottom-to-top', () => {
  const chords = [
    { onset: 0, duration: 2, voices: { S: { midi: 72, spell: 'C5' }, A: { midi: 64 }, T: 60, B: { midi: 48 } } },
    { onset: 2, duration: 2, voices: { S: 71, A: 62, T: 55, B: 43 } },
  ];

  // Full 4 voices
  const full = buildSatbEvents(chords);
  assert.equal(full.length, 8);
  const c0 = full.filter(e => e.chordIndex === 0);
  assert.deepEqual(c0.map(e => e.voice), ['B', 'T', 'A', 'S']);
  assert.equal(c0.find(e => e.voice === 'A').gain, balancedVoiceGain(4, 'A'));
  assert.ok(c0.find(e => e.voice === 'S').gain > c0.find(e => e.voice === 'A').gain);
  assert.equal(c0.find(e => e.voice === 'S').spell, 'C5');

  // Mute A & T -> 2 active voices
  const outer = buildSatbEvents(chords, { mutedVoices: new Set(['A', 'T']) });
  assert.equal(outer.length, 4);
  assert.deepEqual([...new Set(outer.map(e => e.voice))], ['B', 'S']);
  assert.equal(outer[0].gain, balancedVoiceGain(2, 'B'));

  // Solo Tenor -> 1 active voice at 0.78 gain
  const solo = buildSatbEvents(chords, { soloVoice: 'T', mutedVoices: new Set(['T']) });
  assert.equal(solo.length, 2);
  assert.deepEqual(solo.map(e => e.voice), ['T', 'T']);
  assert.equal(solo[0].gain, 0.78);

  // Arpeggiation bottom-to-top with positive clamped duration on short chord
  const arp = buildSatbEvents([
    { onset: 0, duration: 2, voices: { S: 72, A: 64, T: 60, B: 48 } },
    { onset: 2, duration: 0.2, voices: { S: 71, A: 62, T: 55, B: 43 } },
  ], { arpeggiateBeats: 0.15 });
  const first = arp.filter(e => e.chordIndex === 0);
  assert.deepEqual(first.map(e => e.voice), ['B', 'T', 'A', 'S']);
  assert.deepEqual(first.map(e => Number(e.onset.toFixed(2))), [0, 0.15, 0.3, 0.45]);
  assert.deepEqual(first.map(e => Number(e.duration.toFixed(2))), [2, 1.85, 1.7, 1.55]);

  const shortChord = arp.filter(e => e.chordIndex === 1);
  assert.ok(shortChord.every(e => e.duration >= 0.05));
  assert.ok(shortChord[0].onset < shortChord[1].onset && shortChord[1].onset < shortChord[2].onset && shortChord[2].onset < shortChord[3].onset);
});

// ---------------------------------------------------------------------------
// buildMelodyHarmonizationEvents
// ---------------------------------------------------------------------------

test('buildMelodyHarmonizationEvents supports melody, outer, and satb modes with passing eighth notes', () => {
  const melody = [
    { onset: 0, duration: 1, midi: 72, spell: 'C5' },
    { onset: 1, duration: 0.5, midi: 74, spell: 'D5', nct: 'PT' },
    { onset: 1.5, duration: 0.5, midi: 76, spell: 'E5' },
    { onset: 2, duration: 2, midi: 74, spell: 'D5' },
  ];
  const harmonization = [
    { onset: 0, duration: 2, bass: { midi: 48, spell: 'C3' }, roman: 'I' },
    { onset: 2, duration: 2, bass: { midi: 43, spell: 'G2' }, roman: 'V' },
  ];
  const satbPreview = [
    { onset: 0, duration: 2, voices: { S: 72, A: 64, T: 60, B: 48 } },
    { onset: 2, duration: 2, voices: { S: 74, A: 62, T: 59, B: 43 } },
  ];

  // Melody-only mode preserves all 4 melody rhythms
  const melOnly = buildMelodyHarmonizationEvents(melody, harmonization, satbPreview, { mode: 'melody' });
  assert.equal(melOnly.length, 4);
  assert.deepEqual(melOnly.map(e => e.onset), [0, 1, 1.5, 2]);
  assert.deepEqual(melOnly.map(e => e.duration), [1, 0.5, 0.5, 2]);
  assert.ok(melOnly.every(e => e.voice === 'S'));

  // Outer mode: 4 melody notes + 2 student bass notes
  const outer = buildMelodyHarmonizationEvents(melody, harmonization, satbPreview, { mode: 'outer' });
  assert.equal(outer.length, 6);
  assert.equal(outer.filter(e => e.voice === 'S').length, 4);
  assert.equal(outer.filter(e => e.voice === 'B').length, 2);
  assert.equal(outer.find(e => e.voice === 'S' && e.onset === 1).nct, 'PT');

  // SATB mode: 4 melody notes + 2 bass + 2 alto + 2 tenor = 10 events
  const satb = buildMelodyHarmonizationEvents(melody, harmonization, satbPreview, { mode: 'satb', arpeggiateBeats: 0.1 });
  assert.equal(satb.length, 10);
  // Chord 0 simultaneous attack rolls B -> T -> A -> S, while passing notes at 1 and 1.5 stay exact!
  const c0Attacks = satb.filter(e => e.onset < 0.9);
  assert.deepEqual(c0Attacks.map(e => e.voice), ['B', 'T', 'A', 'S']);
  assert.equal(satb.find(e => e.midi === 74 && e.duration === 0.5).onset, 1);
  assert.equal(satb.find(e => e.midi === 76 && e.duration === 0.5).onset, 1.5);

  // SATB mode respects mute & solo
  const soloAlto = buildMelodyHarmonizationEvents(melody, harmonization, satbPreview, { mode: 'satb', soloVoice: 'A' });
  assert.equal(soloAlto.length, 2);
  assert.ok(soloAlto.every(e => e.voice === 'A'));
});

// ---------------------------------------------------------------------------
// buildComparisonEvents & TheoryAudioController
// ---------------------------------------------------------------------------

test('buildComparisonEvents concatenates before and after phases with gap and tempoScale', () => {
  const before = [{ midi: 60, onset: 0, duration: 1 }, { midi: 67, onset: 1, duration: 1 }];
  const after = [{ midi: 60, onset: 0, duration: 1 }, { midi: 65, onset: 1, duration: 1 }];

  const result = buildComparisonEvents(before, after, { gapBeats: 1.5 });
  assert.equal(result.beforeEndBeat, 2);
  assert.equal(result.afterStartBeat, 3.5);
  assert.equal(result.totalDuration, 5.5);
  assert.deepEqual(result.events.map(e => e.phase), ['before', 'before', 'after', 'after']);
  assert.deepEqual(result.events.map(e => e.onset), [0, 1, 3.5, 4.5]);

  const slowed = buildComparisonEvents(before, after, { gapBeats: 1, tempoScale: 0.5 });
  assert.equal(slowed.beforeEndBeat, 4);
  assert.equal(slowed.afterStartBeat, 5);
  assert.equal(slowed.totalDuration, 9);
});

test('TheoryAudioController manages A/B phase transitions, demos, auditioning, and shared PianoPlayer isolation', async () => {
  const externalStates = [];
  const sharedPlayer = makePlayer({ onState: s => externalStates.push(s) });
  const phases = [];
  const activeBatches = [];
  const ctrlStates = [];

  const ctrl = new TheoryAudioController({
    player: sharedPlayer,
    tempo: 60,
    onPhaseChange: phase => phases.push(phase),
    onActiveEvents: evs => activeBatches.push(evs),
    onState: s => ctrlStates.push(s),
  });

  try {
    // 1. Before/After comparison shifts phase live as beat advances.
    const demo = {
      beforeEvents: [{ midi: 60, onset: 4, duration: 1, voice: 'S' }],
      afterEvents: [{ midi: 64, onset: 4, duration: 1, voice: 'S' }],
      gapBeats: 1,
    };
    const cmp = await ctrl.playBeforeAfterComparison(demo, 60);
    assert.equal(cmp.beforeEndBeat, 1);
    assert.equal(cmp.afterStartBeat, 2);
    assert.equal(ctrl.phase, 'before');
    assert.equal(ctrl.state, 'playing');

    sharedPlayer.context.currentTime = 12.1; // beat ~ 2.065 -> after phase
    sharedPlayer._tick();
    assert.equal(ctrl.phase, 'after');
    assert.ok(phases.includes('before') && phases.includes('after'));
    assert.ok(activeBatches.at(-1).some(e => e.midi === 64));

    ctrl.stop();
    assert.equal(ctrl.state, 'stopped');

    // 2. Isolated demo normalizes starting onset to 0.
    const isoEvents = await ctrl.playIsolatedDemo({
      isolated: [{ onset: 6, duration: 1, voices: { S: 72, B: 48 } }],
    }, 80);
    assert.equal(ctrl.phase, 'isolated');
    assert.equal(isoEvents[0].onset, 0);
    ctrl.pause();
    assert.equal(ctrl.state, 'paused');
    ctrl.stop();

    // 3. Audition chord rolls low-to-high when arpeggiated.
    const beforeSources = sharedPlayer.context.sources.length;
    await ctrl.auditionChord([72, 48, 64], { arpeggiate: true, arpeggiateSec: 0.04 });
    assert.equal(sharedPlayer.context.sources.length - beforeSources, 3);
    ctrl.stop();

    // 4. Mute/solo helpers & exportMidi.
    assert.equal(ctrl.toggleMute('A'), true);
    assert.ok(ctrl.mutedVoices.has('A'));
    assert.equal(ctrl.toggleSolo('S'), 'S');
    assert.equal(ctrl.toggleSolo('S'), null);
    const midiBlob = ctrl.exportMidi([{ midi: 60, onset: 0, duration: 1 }]);
    assert.equal(midiBlob.type, 'audio/midi');

    // 5. External play on shared player routes back to original listener, not controller.
    const ctrlCountBefore = ctrlStates.length;
    await sharedPlayer.play([{ midi: 60, onset: 0, duration: 1 }], { tempo: 60 });
    assert.equal(ctrlStates.length, ctrlCountBefore);
    assert.equal(externalStates.at(-1), 'playing');
  } finally {
    sharedPlayer.stop();
  }
});
