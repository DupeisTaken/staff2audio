const LETTERS = 'CDEFGAB';
const SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const KEY_NAMES = [
  'C♭ major / A♭ minor', 'G♭ major / E♭ minor', 'D♭ major / B♭ minor',
  'A♭ major / F minor', 'E♭ major / C minor', 'B♭ major / G minor', 'F major / D minor',
  'C major / A minor', 'G major / E minor', 'D major / B minor', 'A major / F♯ minor',
  'E major / C♯ minor', 'B major / G♯ minor', 'F♯ major / D♯ minor', 'C♯ major / A♯ minor',
];
const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const validKey = key => Number.isInteger(key) && key >= -7 && key <= 7;

function keyOffsets(key) {
  const offsets = Object.fromEntries([...LETTERS].map(letter => [letter, 0]));
  const order = key > 0 ? 'FCGDAEB' : 'BEADGCF';
  for (const letter of order.slice(0, Math.abs(key))) offsets[letter] = Math.sign(key);
  return offsets;
}

function pitchAt(step, clef) {
  const diatonic = (clef === 'bass' ? 18 : 30) + step; // Bottom lines G2 and E4.
  const index = ((diatonic % 7) + 7) % 7;
  const octave = Math.floor(diatonic / 7);
  return { letter: LETTERS[index], octave, natural_midi: 12 * (octave + 1) + SEMITONES[index] };
}

function writtenStep(event, staff) {
  if (isNumber(event.staff_step)) return Math.round(event.staff_step);
  if (isNumber(event.step)) return Math.round(event.step);
  const lines = staff.lines;
  if (Array.isArray(lines) && lines.length >= 5 && isNumber(lines[0]) && isNumber(lines[4]) &&
      lines[4] > lines[0] && isNumber(event.y)) {
    return Math.round((lines[4] - event.y) / ((lines[4] - lines[0]) / 8));
  }
  if (typeof event.letter === 'string' && event.letter.length === 1 && LETTERS.includes(event.letter) && isNumber(event.octave)) {
    return Math.round(event.octave) * 7 + LETTERS.indexOf(event.letter) - (staff.clef === 'bass' ? 18 : 30);
  }
  return null;
}

function accidentalName(alteration) {
  return { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' }[alteration] ?? `(${alteration > 0 ? '+' : ''}${alteration})`;
}

/** Reinterpret written staff positions while preserving user pitches/accidental scope.
 * Explicit and measure accidentals are independent of key. For old payloads without
 * scope metadata, an alteration equal to the old key is necessarily treated as key.
 * Rests, manualPitch events and notes without recoverable position remain untouched.
 */
export function reinterpretStaff(staff, clef, key) {
  if (!staff || !Array.isArray(staff.events)) throw new TypeError('A staff must contain an events array.');
  if (clef !== 'treble' && clef !== 'bass') throw new RangeError('Choose treble or bass clef.');
  if (!validKey(key)) throw new RangeError('A key signature must contain between seven flats and seven sharps.');
  const oldClef = staff.clef === 'bass' ? 'bass' : 'treble';
  const oldOffsets = keyOffsets(validKey(staff.key_signature) ? staff.key_signature : 0);
  const newOffsets = keyOffsets(key);
  // Build patches before mutating, so a malformed event cannot leave a partial edit.
  const updates = staff.events.map(event => {
    if (!event || typeof event !== 'object') throw new TypeError('Every staff event must be an object.');
    if (event.midi === null || event.manualPitch) return null;
    if (!isNumber(event.midi)) throw new TypeError('A note pitch must be a finite MIDI number or null for a rest.');
    const step = writtenStep(event, staff);
    if (step === null) return null;
    const previous = pitchAt(step, oldClef), next = pitchAt(step, clef);
    const inferredAlteration = Math.round(event.midi - previous.natural_midi);
    const explicit = isNumber(event.explicit_accidental) ? Math.round(event.explicit_accidental) : null;
    let source = event.alteration_source;
    if (!['key', 'explicit', 'measure'].includes(source)) {
      source = explicit !== null ? 'explicit' : inferredAlteration === oldOffsets[previous.letter] ? 'key' : 'explicit';
    }
    const alteration = source === 'key' ? newOffsets[next.letter] :
      source === 'explicit' && explicit !== null ? explicit :
        isNumber(event.alteration) ? Math.round(event.alteration) : inferredAlteration;
    const pitch = next.natural_midi + alteration;
    return { ...next, staff_step: step, alteration, alteration_source: source,
      explicit_accidental: source === 'explicit' ? alteration : null,
      midi: Math.max(0, Math.min(127, pitch)), pitch_clamped: pitch < 0 || pitch > 127,
      name: `${next.letter}${accidentalName(alteration)}${next.octave}` };
  });
  updates.forEach((update, index) => { if (update) Object.assign(staff.events[index], update); });
  staff.clef = clef; staff.key_signature = key; staff.key_name = KEY_NAMES[key + 7];
  return staff;
}
