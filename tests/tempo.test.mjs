import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendTempo, toQuarterBpm, fromQuarterBpm, clampDisplayBpm, tempoPresets } from '../static/tempo.js';

const note = (duration, extra = {}) => ({ midi: 60, duration, confidence: 0.95, ...extra });
const staff = (time_signature = '4/4', events = [note(1), note(0.5)]) => ({ time_signature, events });

test('presets offer exact familiar practice tempos plus the supported endpoints', () => {
  assert.deepEqual(tempoPresets(), [30,40,48,56,60,72,80,90,100,120,144,160,180,200,240]);
  assert.deepEqual(tempoPresets(1.5), [20,30,40,48,56,60,72,80,90,100,120,144,160]);
  assert.deepEqual(tempoPresets(2), [15,30,40,48,56,60,72,80,90,100,120]);
  assert.deepEqual(tempoPresets(0.5), [60,72,80,90,100,120,144,160,180,200,240,300,360,480]);
});

test('presets stay sorted, unique and engine-compatible for every recognized meter', () => {
  for (const numerator of [1,2,3,4,6,9,12,32]) for (const denominator of [1,2,4,8,16,32]) {
    const factor = recommendTempo(staff(`${numerator}/${denominator}`)).quarterNotesPerBeat;
    const values = tempoPresets(factor);
    assert.equal(values[0], Math.ceil(30 / factor));
    assert.equal(values.at(-1), Math.floor(240 / factor));
    assert.deepEqual(values, [...new Set(values)].sort((a,b) => a-b));
    for (const bpm of values) {
      assert.ok(Number.isInteger(bpm));
      assert.equal(toQuarterBpm(bpm, factor), bpm * factor);
    }
  }
  const values = tempoPresets();
  values.push(73);
  assert.ok(!tempoPresets().includes(73), 'callers cannot mutate the shared choices');
});

test('presets reject unsupported beat units consistently with tempo conversion', () => {
  for (const factor of [0,-1,NaN,Infinity,1000,1e-300]) assert.throws(() => tempoPresets(factor), RangeError);
});

test('4/4 quarter/eighth notes get the transparent 60–80, default72 quarter pulse', () => {
  const result = recommendTempo(staff());
  assert.deepEqual([result.bpm, result.minBpm, result.maxBpm, result.quarterBpm], [72,60,80,72]);
  assert.equal(result.quarterNotesPerBeat, 1); assert.equal(result.beatLabel, 'quarter note');
  assert.equal(result.beatSymbol, '♩'); assert.equal(result.unitLabel, 'quarter note BPM');
  assert.match(result.reason, /suggested starting range/);
});

test('reliably recognized sixteenths and dotted sixteenths use slower simple practice range', () => {
  for (const duration of [0.25, 0.375]) {
    const result = recommendTempo(staff('4/4', [note(1), note(duration)]));
    assert.deepEqual([result.bpm, result.minBpm, result.maxBpm, result.quarterBpm], [56,48,60,56]);
    assert.match(result.reason, /Short sounding/);
  }
});

test('any short sounding value slows the suggestion, regardless of confidence or missing metadata', () => {
  assert.equal(recommendTempo(staff('4/4', [note(0.25, { confidence: 0.1 }), note(0.5)])).bpm, 56);
  assert.equal(recommendTempo(staff('4/4', [note(0.25, { confidence: 0.75 })])).bpm, 56);
  assert.equal(recommendTempo(staff('4/4', [{ midi: 60, duration: 0.25 }])).bpm, 56);
  assert.equal(recommendTempo(staff('4/4', [note(1e-9, { confidence: 0 })])).bpm, 30);
});

test('6/8 uses dotted-quarter display48 = quarter72, with compound recommended range', () => {
  const result = recommendTempo(staff('6/8'));
  assert.deepEqual([result.bpm, result.minBpm, result.maxBpm, result.quarterBpm, result.quarterNotesPerBeat], [48,40,56,72,1.5]);
  assert.equal(result.beatLabel, 'dotted quarter note'); assert.equal(result.beatSymbol, '♩.');
});

test('compound 6/8,9/8,12/8 dense rhythm has a steady dotted-quarter40 = quarter60 pulse', () => {
  for (const meter of ['6/8', '9/8', '12/8']) {
    const result = recommendTempo(staff(meter, [note(0.5), note(0.25)]));
    assert.deepEqual([result.bpm, result.minBpm, result.maxBpm, result.quarterBpm], [40,36,44,60]);
    assert.equal(result.quarterNotesPerBeat, 1.5);
  }
});

test('2/2 half-note pulse72 converts to quarter144 without changing event durations', () => {
  const value = staff('2/2', [note(2), note(1)]), snapshot = structuredClone(value), result = recommendTempo(value);
  assert.equal(result.bpm, 72); assert.equal(result.quarterBpm, 144); assert.equal(result.quarterNotesPerBeat, 2);
  assert.equal(result.beatLabel, 'half note'); assert.deepEqual(value, snapshot);
});

test('3/8 stays simple with explicit eighth-note pulse, and dense range respects engine minimum', () => {
  const result = recommendTempo(staff('3/8'));
  assert.deepEqual([result.bpm, result.quarterBpm, result.quarterNotesPerBeat], [72,36,0.5]);
  assert.equal(result.beatLabel, 'eighth note');
  const ordinarySixteenths = recommendTempo(staff('3/8', [note(0.25)]));
  assert.deepEqual([ordinarySixteenths.bpm, ordinarySixteenths.quarterBpm], [72,36]);
  const dense = recommendTempo(staff('3/8', [note(0.125)]));
  assert.deepEqual([dense.bpm, dense.minBpm, dense.maxBpm, dense.quarterBpm], [60,60,60,30]);
});

test('half-note beat density slows eighths and scales sixteenths while preserving quarter timing', () => {
  const eighths = recommendTempo(staff('2/2', [note(0.5)]));
  assert.deepEqual([eighths.bpm, eighths.minBpm, eighths.maxBpm, eighths.quarterBpm], [56,48,60,112]);
  const sixteenths = recommendTempo(staff('2/2', [note(0.25)]));
  assert.deepEqual([sixteenths.bpm, sixteenths.minBpm, sixteenths.maxBpm, sixteenths.quarterBpm], [28,24,30,56]);
  assert.ok(Math.abs(60 * 0.5 / eighths.quarterBpm - 60 * 0.25 / sixteenths.quarterBpm) < 1e-12);
});

test('faster subdivisions scale dense windows until the engine minimum bounds them', () => {
  const quarterThirtySeconds = recommendTempo(staff('4/4', [note(0.125)]));
  assert.deepEqual([quarterThirtySeconds.bpm, quarterThirtySeconds.minBpm, quarterThirtySeconds.maxBpm], [30,30,30]);
  const compoundThirtySeconds = recommendTempo(staff('6/8', [note(0.125)]));
  assert.deepEqual([compoundThirtySeconds.bpm, compoundThirtySeconds.minBpm, compoundThirtySeconds.maxBpm, compoundThirtySeconds.quarterBpm], [20,20,22,30]);
  assert.match(compoundThirtySeconds.reason, /scale the starting range further/);
  for (const meter of ['4/4','2/2','3/8','6/8']) {
    const extreme = recommendTempo(staff(meter, [note(Number.MIN_VALUE)]));
    assert.equal(extreme.quarterBpm, 30);
  }
});

test('floating point noise at an ordinary division does not invent dense rhythm', () => {
  assert.equal(recommendTempo(staff('4/4', [note(0.5 - 1e-10)])).bpm, 72);
  assert.equal(recommendTempo(staff('6/8', [note(0.5 - 1e-10)])).bpm, 48);
});

test('rest-only, empty and invalid note timings use baseline rather than false density', () => {
  for (const events of [[], [note(0.125, { midi: null })], [note(-1), note(0), note(NaN)],
    [note(0.25, { midi: 999 }), note(0.25, { midi: NaN })]]) {
    assert.equal(recommendTempo(staff('4/4', events)).bpm, 72);
  }
});

test('unrecognized or absent meter safely falls back to quarter-note counting', () => {
  for (const meter of [undefined, null, '', 'garbage', '3/3', '0/4', '99/8', '3+2/8']) {
    const result = recommendTempo({ time_signature: meter, events: [] });
    assert.equal(result.quarterNotesPerBeat, 1); assert.equal(result.bpm, 72); assert.match(result.reason, /Unrecognized or missing/);
  }
  assert.equal(recommendTempo(null).quarterBpm, 72);
  assert.equal(recommendTempo(staff('C')).quarterNotesPerBeat, 1);
  assert.equal(recommendTempo(staff('¢')).quarterNotesPerBeat, 2);
});

test('display input clamps by pulse unit, while conversions preserve fractional roundtrips', () => {
  for (const [factor, min, max] of [[1,30,240],[1.5,20,160],[2,15,120],[0.5,60,480]]) {
    assert.equal(clampDisplayBpm(-100, factor), min); assert.equal(clampDisplayBpm(10000, factor), max);
    assert.equal(toQuarterBpm(min, factor), min * factor); assert.equal(toQuarterBpm(max, factor), max * factor);
    assert.ok(Math.abs(toQuarterBpm(fromQuarterBpm(100, factor), factor) - 100) < 1e-10);
  }
  assert.equal(clampDisplayBpm('72.6'), 73);
  assert.equal(clampDisplayBpm(''), 72); assert.equal(clampDisplayBpm(NaN), 72);
  assert.equal(toQuarterBpm(48, 1.5), 72); assert.equal(fromQuarterBpm(72,1.5), 48);
  assert.equal(toQuarterBpm(0), 30); assert.equal(fromQuarterBpm(999), 240);
});

test('unsupported beat factors fail clearly instead of producing infinities or reversed bounds', () => {
  for (const factor of [0, -1, NaN, Infinity, 1000, 1e-300]) {
    for (const helper of [clampDisplayBpm, toQuarterBpm, fromQuarterBpm]) assert.throws(() => helper(72, factor), RangeError);
  }
});

test('meter-derived factors always yield valid engine tempos and ordered recommended windows', () => {
  for (const numerator of [2,3,4,6,9,12]) for (const denominator of [1,2,4,8,16,32]) for (const duration of [1,0.25]) {
    const result = recommendTempo(staff(`${numerator}/${denominator}`, [note(duration)]));
    assert.ok(result.quarterBpm >= 30 && result.quarterBpm <= 240);
    assert.ok(result.minBpm <= result.bpm && result.bpm <= result.maxBpm);
  }
});

test('compound denominators label the grouped dotted beat rather than the subdivision', () => {
  for (const [meter, label, symbol, factor] of [['6/4','dotted half note','𝅗𝅥.',3], ['6/16','dotted eighth note','♪.',0.75]]) {
    const result = recommendTempo(staff(meter));
    assert.equal(result.beatLabel, label); assert.equal(result.beatSymbol, symbol); assert.equal(result.quarterNotesPerBeat, factor);
  }
});

test('recommendation is one staff-wide pulse regardless of measure numbering or event order', () => {
  const a = staff('4/4', [note(1, { measure: 1 }), note(0.25, { measure: 99 })]);
  const b = staff('4/4', [...a.events].reverse().map(e => ({ ...e, measure: 2 })));
  assert.deepEqual(recommendTempo(a), recommendTempo(b));
});
