import test from 'node:test';
import assert from 'node:assert/strict';
import { reinterpretStaff } from '../static/score.js';

const event = (staff_step, midi, extra = {}) => ({ id: `n${staff_step}`, staff_step, midi, onset: 0, duration: 1, ...extra });
const staff = (events, clef = 'treble', key = 0) => ({ clef, key_signature: key, lines: [100, 110, 120, 130, 140], events });
// Independent expectations in C-D-E-F-G-A-B order, avoiding the production helper.
const MAJOR_OFFSETS = [
  [-1,-1,-1,-1,-1,-1,-1], [-1,-1,-1,0,-1,-1,-1], [0,-1,-1,0,-1,-1,-1],
  [0,-1,-1,0,0,-1,-1], [0,0,-1,0,0,-1,-1], [0,0,-1,0,0,0,-1], [0,0,0,0,0,0,-1],
  [0,0,0,0,0,0,0], [0,0,0,1,0,0,0], [1,0,0,1,0,0,0], [1,0,0,1,1,0,0],
  [1,1,0,1,1,0,0], [1,1,0,1,1,1,0], [1,1,1,1,1,1,0], [1,1,1,1,1,1,1],
];

for (const clef of ['treble', 'bass']) for (let key = -7; key <= 7; key++) {
  test(`${clef} key ${key}: independent diatonic expectations for all seven letters`, () => {
    const steps = clef === 'treble' ? [-2,-1,0,1,2,3,4] : [3,4,5,6,7,8,9];
    const naturals = clef === 'treble' ? [60,62,64,65,67,69,71] : [48,50,52,53,55,57,59];
    const value = staff(steps.map((step, i) => event(step, naturals[i])), clef);
    assert.equal(reinterpretStaff(value, clef, key), value);
    assert.deepEqual(value.events.map(e => e.midi), naturals.map((n,i) => n + MAJOR_OFFSETS[key + 7][i]));
    assert.deepEqual(value.events.map(e => e.letter), [...'CDEFGAB']);
    assert.ok(value.events.every(e => e.alteration_source === 'key' && e.explicit_accidental === null));
    assert.equal(value.key_signature, key); assert.match(value.key_name, /major \/ .* minor$/);
  });
}

test('repeated key changes return to original pitches with coherent metadata', () => {
  const value = staff([event(1, 66, { letter: 'F', octave: 4, natural_midi: 65, alteration: 1, alteration_source: 'key' }),
    event(6, 74, { alteration_source: 'key' })], 'treble', 1);
  for (const key of [-7, 4, -2, 7, 0, 1]) reinterpretStaff(value, 'treble', key);
  assert.deepEqual(value.events.map(e => e.midi), [66,74]);
  assert.deepEqual(value.events.map(e => [e.letter, e.octave, e.natural_midi, e.alteration]), [['F',4,65,1], ['D',5,74,0]]);
  assert.equal(value.events[0].name, 'F♯4');
});

test('clef switching uses written position, reapplies key by the new letter, and roundtrips', () => {
  const value = staff([event(1, 66, { alteration_source: 'key' }), event(0, 64, { alteration_source: 'key' })], 'treble', 1);
  reinterpretStaff(value, 'bass', 1);
  assert.deepEqual(value.events.map(e => e.midi), [45,43]); // A2/G2, not F-sharp transposed by a constant.
  assert.deepEqual(value.events.map(e => [e.letter, e.octave, e.natural_midi, e.alteration]), [['A',2,45,0], ['G',2,43,0]]);
  reinterpretStaff(value, 'treble', 1); assert.deepEqual(value.events.map(e => e.midi), [66,64]);
});

test('explicit natural and inherited measure natural survive a key/clef change', () => {
  const value = staff([event(1, 65, { alteration: 0, explicit_accidental: 0, alteration_source: 'explicit' }),
    event(1, 65, { alteration: 0, explicit_accidental: null, alteration_source: 'measure' }),
    event(1, 66, { alteration: 1, explicit_accidental: null, alteration_source: 'key' })], 'treble', 1);
  reinterpretStaff(value, 'treble', -7);
  assert.deepEqual(value.events.map(e => e.midi), [65,65,64]);
  assert.deepEqual(value.events.map(e => e.explicit_accidental), [0,null,null]);
  reinterpretStaff(value, 'bass', 7);
  assert.deepEqual(value.events.map(e => e.midi), [45,45,46]);
  assert.deepEqual(value.events.map(e => e.alteration_source), ['explicit','measure','key']);
});

test('explicit and inherited sharp/flat/double alterations remain independent of key', () => {
  const value = staff([event(0, 65, { alteration: 1, explicit_accidental: 1, alteration_source: 'explicit' }),
    event(0, 63, { alteration: -1, alteration_source: 'measure' }),
    event(0, 66, { alteration: 2, explicit_accidental: 2, alteration_source: 'explicit' })]);
  reinterpretStaff(value, 'bass', -4);
  assert.deepEqual(value.events.map(e => e.midi), [44,42,45]);
  assert.deepEqual(value.events.map(e => e.name), ['G♯2','G♭2','G𝄪2']);
  reinterpretStaff(value, 'treble', 0); assert.deepEqual(value.events.map(e => e.midi), [65,63,66]);
});

test('manual edits and rests are preserved, including their metadata and identity', () => {
  const manual = event(1, 81, { manualPitch: true, natural_midi: 65, custom: 'keep' });
  const rest = event(null, null, { name: 'Rest', alteration_source: null });
  const snapshot = structuredClone([manual, rest]);
  const value = staff([manual, rest]); reinterpretStaff(value, 'bass', 7);
  assert.deepEqual(value.events, snapshot); assert.equal(value.events[0], manual); assert.equal(value.events[1], rest);
  assert.equal(value.clef, 'bass'); assert.equal(value.key_name, 'C♯ major / A♯ minor');
});

test('coordinate and legacy-step fallback infer old-key versus explicit accidentals', () => {
  const value = staff([{ midi: 66, y: 135, duration: 1 }, { midi: 65, y: 135, duration: 1 },
    { midi: 65, step: 1, duration: 1, explicit_accidental: 0 }], 'treble', 1);
  reinterpretStaff(value, 'treble', 0);
  assert.deepEqual(value.events.map(e => e.midi), [65,65,65]);
  assert.deepEqual(value.events.map(e => e.alteration_source), ['key','explicit','explicit']);
  assert.ok(value.events.every(e => e.staff_step === 1));
  reinterpretStaff(value, 'treble', 1); assert.deepEqual(value.events.map(e => e.midi), [66,65,65]);
});

test('written spelling can recover position when coordinates and staff_step are absent', () => {
  const value = staff([{ midi: 60, letter: 'C', octave: 4, alteration_source: 'key' }]);
  reinterpretStaff(value, 'bass', 0);
  assert.equal(value.events[0].staff_step, -2); assert.equal(value.events[0].midi, 40); assert.equal(value.events[0].name, 'E2');
});

test('unrecoverable notes remain intact; clamped notes retain alteration for roundtrips', () => {
  const unknown = { midi: 60, duration: 1 };
  const value = staff([unknown, event(38, 109, { alteration_source: 'explicit', alteration: 1, explicit_accidental: 1 })], 'bass');
  reinterpretStaff(value, 'treble', 0);
  assert.deepEqual(unknown, { midi: 60, duration: 1 });
  assert.equal(value.events[1].midi, 127); assert.equal(value.events[1].pitch_clamped, true);
  assert.equal(value.events[1].alteration, 1);
  reinterpretStaff(value, 'bass', 0);
  assert.equal(value.events[1].natural_midi, 108); assert.equal(value.events[1].midi, 109);
  assert.equal(value.events[1].pitch_clamped, false);
});

test('invalid target or malformed event fails without a partial mutation', () => {
  const value = staff([event(0,64)]), snapshot = structuredClone(value);
  for (const [clef,key] of [['alto',0], ['treble',8], ['bass',1.5]]) {
    assert.throws(() => reinterpretStaff(value, clef, key), RangeError); assert.deepEqual(value, snapshot);
  }
  value.events.push({ midi: NaN }); const originalFirst = structuredClone(value.events[0]);
  assert.throws(() => reinterpretStaff(value, 'bass', 1), TypeError);
  assert.deepEqual(value.events[0], originalFirst); assert.equal(value.clef, 'treble');
});
