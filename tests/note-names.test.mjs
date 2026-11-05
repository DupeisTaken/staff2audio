import test from "node:test";
import assert from "node:assert/strict";
import { pitchName, nameForMidi, eventName, transposedKeySignature, spokenPitchName } from "../static/note-names.js";

// Independently transcribed key signatures in C-D-E-F-G-A-B order.
const KEYS = [
  ["C♭4","D♭4","E♭4","F♭4","G♭4","A♭4","B♭4"],
  ["C♭4","D♭4","E♭4","F4","G♭4","A♭4","B♭4"],
  ["C4","D♭4","E♭4","F4","G♭4","A♭4","B♭4"],
  ["C4","D♭4","E♭4","F4","G4","A♭4","B♭4"],
  ["C4","D4","E♭4","F4","G4","A♭4","B♭4"],
  ["C4","D4","E♭4","F4","G4","A4","B♭4"],
  ["C4","D4","E4","F4","G4","A4","B♭4"],
  ["C4","D4","E4","F4","G4","A4","B4"],
  ["C4","D4","E4","F♯4","G4","A4","B4"],
  ["C♯4","D4","E4","F♯4","G4","A4","B4"],
  ["C♯4","D4","E4","F♯4","G♯4","A4","B4"],
  ["C♯4","D♯4","E4","F♯4","G♯4","A4","B4"],
  ["C♯4","D♯4","E4","F♯4","G♯4","A♯4","B4"],
  ["C♯4","D♯4","E♯4","F♯4","G♯4","A♯4","B4"],
  ["C♯4","D♯4","E♯4","F♯4","G♯4","A♯4","B♯4"],
];
const MIDIS = [
  [59,61,63,64,66,68,70], [59,61,63,65,66,68,70], [60,61,63,65,66,68,70],
  [60,61,63,65,67,68,70], [60,62,63,65,67,68,70], [60,62,63,65,67,69,70],
  [60,62,64,65,67,69,70], [60,62,64,65,67,69,71], [60,62,64,66,67,69,71],
  [61,62,64,66,67,69,71], [61,62,64,66,68,69,71], [61,63,64,66,68,69,71],
  [61,63,64,66,68,70,71], [61,63,65,66,68,70,71], [61,63,65,66,68,70,72],
];

for (let key = -7; key <= 7; key++) {
  test(`key ${key}: all seven diatonic letters have independent expected names`, () => {
    assert.deepEqual(MIDIS[key + 7].map(midi => pitchName(midi, key)), KEYS[key + 7]);
  });
}

test("sharp/flat chromatic choices follow the key, with sharp defaults in C", () => {
  assert.equal(pitchName(68, 1), "G♯4");
  assert.equal(pitchName(68, 3), "G♯4");
  assert.equal(pitchName(68, -2), "A♭4");
  assert.equal(pitchName(63, -3), "E♭4");
  assert.equal(pitchName(63, 0), "D♯4");
  assert.equal(nameForMidi(61, -2), "D♭4");
});

test("recognized spelling preserves explicit chromatic notes and natural cancellations", () => {
  const staff = { key_signature: -3 };
  assert.equal(eventName({ midi: 63, letter: "D", octave: 4, alteration: 1, explicit_accidental: 1 }, staff), "D♯4");
  assert.equal(eventName({ midi: 65, letter: "F", octave: 4, alteration: 0, explicit_accidental: 0 }, { key_signature: 1 }), "F4");
  assert.equal(eventName({ midi: 69, letter: "G", octave: 4, alteration: 2 }, staff), "G𝄪4");
  assert.equal(eventName({ midi: 67, letter: "A", octave: 4, alteration: -2 }, staff), "A𝄫4");
});

test("written octave boundaries and uncommon scale spellings remain exact", () => {
  for (const [midi,letter,octave,alteration,expected] of [
    [59,"C",4,-1,"C♭4"], [60,"B",3,1,"B♯3"], [65,"E",4,1,"E♯4"],
    [64,"F",4,-1,"F♭4"], [60,"D",4,-2,"D𝄫4"], [61,"B",3,2,"B𝄪3"],
  ]) assert.equal(eventName({ midi,letter,octave,alteration }, {}), expected);
  assert.equal(pitchName(59,-7),"C♭4");
  assert.equal(pitchName(60,7),"B♯3");
});

test("manual edits and inconsistent metadata never retain stale names", () => {
  const stale = { midi: 68, letter: "F", octave: 4, alteration: 1, name: "F♯4" };
  assert.equal(eventName(stale, { key_signature: 3 }), "G♯4");
  assert.equal(eventName({ midi: 63, letter: "D", octave: 4, alteration: 1, name: "D♯4", manualPitch: true }, { key_signature: -3 }), "E♭4");
  assert.equal(eventName({ midi: 60, letter: "B", octave: 3, alteration: 1, manualPitch: true }, {}), "C4");
  assert.equal(eventName({ midi: 60, letter: "C", octave: 4, alteration: 3 }, {}), "C4");
});

test("pitch-select candidates can preserve only the existing written enharmonic", () => {
  const event = { midi:63,letter:"D",octave:4,alteration:1 };
  assert.equal(eventName({ ...event,midi:63 },{key_signature:-3}),"D♯4");
  assert.equal(eventName({ ...event,midi:68 },{key_signature:-3}),"A♭4");
  assert.equal(spokenPitchName("D♯4"),"D sharp 4");
  assert.equal(spokenPitchName("A𝄫4"),"A double flat 4");
  assert.equal(spokenPitchName("B𝄪3"),"B double sharp 3");
  assert.equal(spokenPitchName("F4"),"F natural 4");
});

test("transposition moves the key coherently and names the actual clamped pitch", () => {
  assert.equal(transposedKeySignature(2,2),4); // D -> E.
  assert.equal(transposedKeySignature(-2,2),0); // B-flat -> C.
  assert.equal(transposedKeySignature(0,1),-5); // Fewer accidentals: D-flat.
  assert.equal(transposedKeySignature(5,2),7); // Preserve sharp orientation: B -> C-sharp.
  assert.equal(transposedKeySignature(-5,-2),-7); // D-flat -> C-flat.
  assert.equal(eventName({midi:66,letter:"F",octave:4,alteration:1},{key_signature:2},{transpose:2}),"G♯4");
  assert.equal(eventName({midi:70},{key_signature:-2},{transpose:2}),"C5");
  assert.equal(eventName({midi:127},{key_signature:0},{transpose:12}),"G9");
  assert.equal(eventName({midi:0},{key_signature:0},{transpose:-12}),"C-1");
  assert.equal(eventName({midi:65,letter:"E",octave:4,alteration:1},{key_signature:6},{transpose:12}),"E♯5");
});

test("whole-octave transposition preserves validated written enharmonics", () => {
  const staff = { key_signature:-3 };
  for (const [event,shift,expected] of [
    [{midi:63,letter:"D",octave:4,alteration:1},12,"D♯5"],
    [{midi:63,letter:"D",octave:4,alteration:1},-12,"D♯3"],
    [{midi:63,letter:"D",octave:4,alteration:1},24,"D♯6"],
    [{midi:63,letter:"D",octave:4,alteration:1},-24,"D♯2"],
    [{midi:59,letter:"C",octave:4,alteration:-1},12,"C♭5"],
    [{midi:60,letter:"B",octave:3,alteration:1},-12,"B♯2"],
    [{midi:69,letter:"G",octave:4,alteration:2},24,"G𝄪6"],
    [{midi:67,letter:"A",octave:4,alteration:-2},-24,"A𝄫2"],
  ]) assert.equal(eventName(event,staff,{transpose:shift}),expected);
});

test("octave preservation never trusts stale/manual metadata or hides clamping/rests", () => {
  const staff = { key_signature:-3 };
  assert.equal(eventName({midi:63,letter:"D",octave:4,alteration:1,manualPitch:true},staff,{transpose:12}),"E♭5");
  assert.equal(eventName({midi:63,letter:"F",octave:4,alteration:1},staff,{transpose:-12}),"E♭3");
  assert.equal(eventName({midi:125,letter:"E",octave:9,alteration:1},staff,{transpose:24}),"G9");
  assert.equal(eventName({midi:1,letter:"D",octave:-1,alteration:-1},staff,{transpose:-24}),"C-1");
  assert.equal(eventName({midi:null},staff,{transpose:24}),"Rest");
});

test("rests, MIDI boundaries, invalid input, and invalid key fallback are explicit", () => {
  assert.equal(pitchName(null),"Rest");
  assert.equal(eventName({midi:null}, {key_signature:7}, {transpose:7}),"Rest");
  assert.equal(spokenPitchName("Rest"),"Rest");
  assert.equal(pitchName(0),"C-1");
  assert.equal(pitchName(127),"G9");
  assert.equal(pitchName(61,100),"C♯4");
  for (const value of [-1,128,60.5,NaN,undefined,"60"]) assert.throws(() => pitchName(value),RangeError);
});
