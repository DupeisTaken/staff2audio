/** Written pitch and contextual MIDI spelling. These helpers never change sound. */
const LETTERS = "CDEFGAB";
const NATURALS = [0, 2, 4, 5, 7, 9, 11];
const SIGNS = { "-2": "𝄫", "-1": "♭", 0: "", 1: "♯", 2: "𝄪" };
const SHARPS = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLATS = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
const validKey = value => Number.isInteger(value) && value >= -7 && value <= 7;
const keyValue = value => validKey(value) ? value : 0;

function midiValue(value) {
  if (!Number.isInteger(value) || value < 0 || value > 127) {
    throw new RangeError("A pitch must be an integer MIDI number from 0 to 127, or null for a rest.");
  }
  return value;
}

function keyAlterations(signature) {
  const alterations = Object.fromEntries([...LETTERS].map(letter => [letter, 0]));
  const order = signature > 0 ? "FCGDAEB" : "BEADGCF";
  for (const letter of order.slice(0, Math.abs(signature))) alterations[letter] = Math.sign(signature);
  return alterations;
}

/** Spell scale members by their key's letters, including E♯/B♯ and C♭/F♭.
 * Chromatic pitches use sharps in sharp/C keys and flats in flat keys.
 */
export function pitchName(midi, keySignature = 0) {
  if (midi === null) return "Rest";
  midiValue(midi);
  const key = keyValue(keySignature), alterations = keyAlterations(key);
  for (let index = 0; index < LETTERS.length; index++) {
    const letter = LETTERS[index], alteration = alterations[letter];
    if (mod(NATURALS[index] + alteration, 12) === midi % 12) {
      // Derive the octave from the written letter, not the sounding pitch class:
      // C♭4 sounds B3, while B♯3 sounds C4.
      const octave = (midi - NATURALS[index] - alteration) / 12 - 1;
      return `${letter}${SIGNS[alteration]}${octave}`;
    }
  }
  return `${(key < 0 ? FLATS : SHARPS)[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export const nameForMidi = pitchName;

/** Transpose the signature's tonic, preferring its existing sharp/flat orientation
 * when an enharmonic choice exists within the conventional fifteen signatures.
 */
export function transposedKeySignature(signature = 0, semitones = 0) {
  const key = keyValue(signature);
  const shift = Number.isFinite(semitones) ? Math.round(semitones) : 0;
  const tonic = mod(7 * key + shift, 12);
  const candidates = [];
  for (let candidate = -7; candidate <= 7; candidate++) {
    if (mod(7 * candidate, 12) === tonic) candidates.push(candidate);
  }
  const orientationCost = candidate => key === 0 || Math.sign(candidate) === Math.sign(key) ? 0 : 1;
  return candidates.sort((a, b) => orientationCost(a) - orientationCost(b) ||
    Math.abs(a) - Math.abs(b) || b - a)[0];
}

/** Preserve validated written spelling; manual edits and stale metadata use MIDI.
 * Supplying a transposition names the actual clamped piano pitch in the moved key.
 */
export function eventName(event, staff = {}, { transpose = 0 } = {}) {
  if (!event || event.midi === null || event.midi === undefined) return "Rest";
  const midi = midiValue(event.midi);
  const key = keyValue(typeof staff === "number" ? staff : staff?.key_signature);
  const shift = Number.isFinite(transpose) ? Math.round(transpose) : 0;
  const soundingMidi = Math.max(0, Math.min(127, midi + shift));
  // Whole octaves leave the written accidental and harmonic function intact.
  // Preserve that spelling only when the piano can actually play the shift.
  if (shift % 12 === 0 && soundingMidi === midi + shift && !event.manualPitch) {
    const { letter, octave, alteration } = event;
    if (typeof letter === "string" && letter.length === 1 && LETTERS.includes(letter) &&
        Number.isInteger(octave) && Number.isInteger(alteration) && alteration >= -2 && alteration <= 2) {
      const writtenMidi = 12 * (octave + 1) + NATURALS[LETTERS.indexOf(letter)] + alteration;
      if (writtenMidi === midi) return `${letter}${SIGNS[alteration]}${octave + shift / 12}`;
    }
  }
  return pitchName(soundingMidi, shift === 0 ? key : transposedKeySignature(key, shift));
}

/** Readable labels for aria-labels: screen readers vary in musical-symbol speech. */
export function spokenPitchName(name) {
  if (name === "Rest") return "Rest";
  const match = /^([A-G])([♯♭𝄪𝄫♮]?)(-?\d+)$/u.exec(String(name));
  if (!match) return String(name);
  const accidental = { "": "natural", "♮": "natural", "♯": "sharp", "♭": "flat",
    "𝄪": "double sharp", "𝄫": "double flat" }[match[2]];
  return `${match[1]} ${accidental} ${match[3]}`;
}
