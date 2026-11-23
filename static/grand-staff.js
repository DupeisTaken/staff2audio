// Publication-grade interactive SVG Grand Staff renderer and pure engraving layout engine.
// Zero external font or library dependencies; matches Staff2Audio paper/ink/terracotta/sage aesthetic.
import { pitchName } from './note-names.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LETTERS = 'CDEFGAB';
const NATURALS = [0, 2, 4, 5, 7, 9, 11];
const DISPLAY_SIGNS = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };
const ASCII_SIGNS = { '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: '##' };
const ACCIDENTAL_MAP = {
  '': 0, n: 0, '♮': 0,
  '#': 1, '♯': 1,
  '##': 2, x: 2, '𝄪': 2,
  b: -1, '♭': -1,
  bb: -2, '𝄫': -2,
};

// Bottom lines: Treble E4 (4*7 + 2 = 30), Bass G2 (2*7 + 4 = 18).
const CLEF_BOTTOM_DIATONIC = Object.freeze({ treble: 30, bass: 18 });

// Standard Elaine Gould ("Behind Bars") key signature engraving positions.
const SHARP_POSITIONS = Object.freeze({
  treble: [
    { letter: 'F', octave: 5 }, { letter: 'C', octave: 5 }, { letter: 'G', octave: 5 },
    { letter: 'D', octave: 5 }, { letter: 'A', octave: 4 }, { letter: 'E', octave: 5 },
    { letter: 'B', octave: 4 },
  ],
  bass: [
    { letter: 'F', octave: 3 }, { letter: 'C', octave: 3 }, { letter: 'G', octave: 3 },
    { letter: 'D', octave: 3 }, { letter: 'A', octave: 2 }, { letter: 'E', octave: 3 },
    { letter: 'B', octave: 2 },
  ],
});

const FLAT_POSITIONS = Object.freeze({
  treble: [
    { letter: 'B', octave: 4 }, { letter: 'E', octave: 5 }, { letter: 'A', octave: 4 },
    { letter: 'D', octave: 5 }, { letter: 'G', octave: 4 }, { letter: 'C', octave: 5 },
    { letter: 'F', octave: 4 },
  ],
  bass: [
    { letter: 'B', octave: 2 }, { letter: 'E', octave: 3 }, { letter: 'A', octave: 2 },
    { letter: 'D', octave: 3 }, { letter: 'G', octave: 2 }, { letter: 'C', octave: 3 },
    { letter: 'F', octave: 2 },
  ],
});

const VOICE_STEM_DIR = Object.freeze({ S: 'up', A: 'down', T: 'up', B: 'down' });
const VOICE_CLEF = Object.freeze({ S: 'treble', A: 'treble', T: 'bass', B: 'bass' });

const validKey = value => Number.isInteger(value) && value >= -7 && value <= 7;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function keyAlterations(keySignature = 0) {
  const key = validKey(keySignature) ? keySignature : 0;
  const map = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  const order = key > 0 ? 'FCGDAEB' : 'BEADGCF';
  for (const letter of order.slice(0, Math.abs(key))) map[letter] = Math.sign(key);
  return map;
}

/**
 * Parse a written pitch string like "F#4", "Bb3", "C4", "Ebb4", "G♯3" into structured pitch metadata.
 */
export function parsePitchDisplay(spell) {
  if (spell === null || spell === undefined) return null;
  if (typeof spell === 'object') {
    if (typeof spell.spell === 'string') return parsePitchDisplay(spell.spell);
    if (typeof spell.display === 'string') return parsePitchDisplay(spell.display);
    if (typeof spell.letter === 'string' && Number.isInteger(spell.octave)) {
      const letter = spell.letter.toUpperCase();
      const idx = LETTERS.indexOf(letter);
      if (idx < 0) return null;
      const alteration = Number.isInteger(spell.alteration) ? clamp(spell.alteration, -2, 2) : 0;
      const octave = spell.octave;
      const diatonicStep = octave * 7 + idx;
      const midi = (octave + 1) * 12 + NATURALS[idx] + alteration;
      return { letter, alteration, octave, diatonicStep, midi, display: `${letter}${DISPLAY_SIGNS[alteration]}${octave}` };
    }
    return null;
  }
  const text = String(spell).trim();
  if (!text || text.toLowerCase() === 'rest') return null;
  const match = /^([A-Ga-g])(##|bb|x|𝄪|𝄫|#|♯|b|♭|♮|n)?(-?\d+)$/u.exec(text);
  if (!match) return null;
  const letter = match[1].toUpperCase();
  const alteration = ACCIDENTAL_MAP[match[2] || ''];
  const octave = Number(match[3]);
  const letterIndex = LETTERS.indexOf(letter);
  const diatonicStep = octave * 7 + letterIndex;
  const midi = (octave + 1) * 12 + NATURALS[letterIndex] + alteration;
  return {
    letter,
    alteration,
    octave,
    diatonicStep,
    midi,
    display: `${letter}${DISPLAY_SIGNS[alteration]}${octave}`,
  };
}

/**
 * Compute exact Y coordinate and required ledger line Y coordinates for a written pitch on treble or bass staff.
 */
export function staffYPosition(letter, octave, clef = 'treble', staffTopY = 54, lineSpacing = 10) {
  const upper = String(letter).toUpperCase();
  const letterIndex = LETTERS.indexOf(upper);
  if (letterIndex < 0 || !Number.isInteger(octave)) {
    throw new RangeError(`Invalid written pitch ${letter}${octave}`);
  }
  const normalizedClef = clef === 'bass' ? 'bass' : 'treble';
  const diatonicStep = octave * 7 + letterIndex;
  const staffStep = diatonicStep - CLEF_BOTTOM_DIATONIC[normalizedClef];
  const bottomLineY = staffTopY + 4 * lineSpacing;
  const halfSpace = lineSpacing / 2;
  const y = bottomLineY - staffStep * halfSpace;

  const ledgerLines = [];
  if (staffStep >= 10) {
    const topEven = Math.floor(staffStep / 2) * 2;
    for (let step = 10; step <= topEven; step += 2) {
      ledgerLines.push(bottomLineY - step * halfSpace);
    }
  } else if (staffStep <= -2) {
    const bottomEven = Math.ceil(staffStep / 2) * 2;
    for (let step = -2; step >= bottomEven; step -= 2) {
      ledgerLines.push(bottomLineY - step * halfSpace);
    }
  }

  return { y, staffStep, diatonicStep, ledgerLines };
}

/**
 * Snap a pointer Y coordinate on a treble or bass staff to the nearest diatonic pitch,
 * applying the active key signature alteration by default.
 */
export function pitchFromStaffY(y, clef = 'treble', staffTopY = 54, lineSpacing = 10, keySignature = 0) {
  const normalizedClef = clef === 'bass' ? 'bass' : 'treble';
  const bottomLineY = staffTopY + 4 * lineSpacing;
  const halfSpace = lineSpacing / 2;
  const rawStep = Math.round((bottomLineY - y) / halfSpace);
  const staffStep = clamp(rawStep, -10, 18);
  const diatonicStep = CLEF_BOTTOM_DIATONIC[normalizedClef] + staffStep;
  const letterIndex = ((diatonicStep % 7) + 7) % 7;
  const octave = Math.floor(diatonicStep / 7);
  const letter = LETTERS[letterIndex];
  const alteration = keyAlterations(keySignature)[letter];
  const midi = clamp((octave + 1) * 12 + NATURALS[letterIndex] + alteration, 0, 127);
  return {
    letter,
    octave,
    alteration,
    staffStep,
    diatonicStep,
    midi,
    spell: `${letter}${ASCII_SIGNS[alteration]}${octave}`,
    display: `${letter}${DISPLAY_SIGNS[alteration]}${octave}`,
  };
}

/**
 * Return standard engraving key signature accidentals for treble or bass clef (-7..+7).
 */
export function keySignatureAccidentals(keySignature = 0, clef = 'treble') {
  const key = validKey(keySignature) ? keySignature : 0;
  if (key === 0) return [];
  const normalizedClef = clef === 'bass' ? 'bass' : 'treble';
  const count = Math.abs(key);
  const isSharp = key > 0;
  const positions = (isSharp ? SHARP_POSITIONS : FLAT_POSITIONS)[normalizedClef];
  const bottomDiatonic = CLEF_BOTTOM_DIATONIC[normalizedClef];

  return positions.slice(0, count).map(({ letter, octave }) => {
    const diatonicStep = octave * 7 + LETTERS.indexOf(letter);
    return {
      letter,
      octave,
      symbol: isSharp ? '♯' : '♭',
      alteration: isSharp ? 1 : -1,
      step: diatonicStep - bottomDiatonic,
    };
  });
}

function parseTimeSignature(raw) {
  if (!raw) return { beats: 4, beatType: 4 };
  if (typeof raw === 'string') {
    const match = /^(\d+)\s*\/\s*(\d+)$/.exec(raw.trim());
    if (match) return { beats: Number(match[1]) || 4, beatType: Number(match[2]) || 4 };
  }
  if (Array.isArray(raw) && raw.length >= 2) {
    return { beats: Number(raw[0]) || 4, beatType: Number(raw[1]) || 4 };
  }
  if (typeof raw === 'object') {
    const beats = Number(raw.beats ?? raw.numerator ?? 4) || 4;
    const beatType = Number(raw.beatType ?? raw.denominator ?? 4) || 4;
    return { beats, beatType };
  }
  return { beats: 4, beatType: 4 };
}

function parseFiguredBass(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(v => String(v).trim()).filter(Boolean);
  const text = String(raw).trim();
  if (!text) return [];
  if (text.includes('/')) return text.split('/').map(v => v.trim()).filter(Boolean);
  if (text.includes('\n')) return text.split('\n').map(v => v.trim()).filter(Boolean);
  return [text];
}

function resolvePitchFromInput(raw, keySignature) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') return parsePitchDisplay(raw);
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const midi = clamp(Math.round(raw), 0, 127);
    return parsePitchDisplay(pitchName(midi, keySignature));
  }
  if (typeof raw === 'object') {
    if (typeof raw.spell === 'string') {
      const parsed = parsePitchDisplay(raw.spell);
      if (parsed) return parsed;
    }
    if (typeof raw.display === 'string') {
      const parsed = parsePitchDisplay(raw.display);
      if (parsed) return parsed;
    }
    if (typeof raw.letter === 'string' && Number.isInteger(raw.octave)) {
      const parsed = parsePitchDisplay(raw);
      if (parsed) return parsed;
    }
    if (raw.pitch && typeof raw.pitch === 'object') {
      const parsed = resolvePitchFromInput(raw.pitch, keySignature);
      if (parsed) return parsed;
    }
    if (raw.midi !== null && raw.midi !== undefined && Number.isFinite(Number(raw.midi))) {
      const midi = clamp(Math.round(Number(raw.midi)), 0, 127);
      return parsePitchDisplay(pitchName(midi, keySignature));
    }
  }
  return null;
}

function rhythmStyle(duration) {
  const dur = Number.isFinite(Number(duration)) && Number(duration) > 0 ? Number(duration) : 1;
  if (dur >= 3.5) return { filled: false, hasStem: false, flags: 0, dotted: false };
  if (dur >= 2.75) return { filled: false, hasStem: true, flags: 0, dotted: true };
  if (dur >= 1.75) return { filled: false, hasStem: true, flags: 0, dotted: false };
  if (dur >= 1.35) return { filled: true, hasStem: true, flags: 0, dotted: true };
  if (dur >= 0.75) return { filled: true, hasStem: true, flags: 0, dotted: false };
  if (dur >= 0.6) return { filled: true, hasStem: true, flags: 1, dotted: true };
  if (dur >= 0.35) return { filled: true, hasStem: true, flags: 1, dotted: false };
  return { filled: true, hasStem: true, flags: 2, dotted: false };
}

function buildBracePath(x, topY, bottomY) {
  const height = bottomY - topY;
  const midY = (topY + bottomY) / 2;
  const outer = x - 11;
  const tip = x - 15;
  const inner = x - 4;
  return [
    `M ${x} ${topY}`,
    `C ${outer} ${topY + height * 0.04}, ${outer - 2} ${midY - height * 0.14}, ${tip} ${midY}`,
    `C ${outer - 2} ${midY + height * 0.14}, ${outer} ${bottomY - height * 0.04}, ${x} ${bottomY}`,
    `C ${inner - 4} ${bottomY - height * 0.08}, ${inner - 3} ${midY + height * 0.12}, ${tip + 3.4} ${midY}`,
    `C ${inner - 3} ${midY - height * 0.12}, ${inner - 4} ${topY + height * 0.08}, ${x} ${topY} Z`,
  ].join(' ');
}

function accidentalSymbolForAlteration(alteration) {
  return { '-2': '𝄫', '-1': '♭', 0: '♮', 1: '♯', 2: '𝄪' }[alteration] || '';
}

function normalizeIssueSpec(issue, index) {
  if (!issue || typeof issue !== 'object') return null;
  const severity = issue.severity === 'warning' || issue.severity === 'info' ? issue.severity : 'error';
  let chordIndices = [];
  if (Array.isArray(issue.chordIndices)) {
    chordIndices = issue.chordIndices.filter(Number.isInteger);
  } else if (Number.isInteger(issue.fromChord) && Number.isInteger(issue.toChord)) {
    chordIndices = [issue.fromChord, issue.toChord];
  } else if (Number.isInteger(issue.chordIndex)) {
    chordIndices = [issue.chordIndex];
  }
  const voices = Array.isArray(issue.voices)
    ? issue.voices.filter(v => ['S', 'A', 'T', 'B'].includes(v))
    : typeof issue.voice === 'string' && ['S', 'A', 'T', 'B'].includes(issue.voice)
      ? [issue.voice]
      : [];
  const explicitNotes = Array.isArray(issue.notes) ? issue.notes : null;
  const noteIndex = Number.isInteger(issue.noteIndex) ? issue.noteIndex
    : Number.isInteger(issue.note_index) ? issue.note_index : null;
  const explicitNoteIds = Array.isArray(issue.explicitNoteIds)
    ? issue.explicitNoteIds.filter(id => typeof id === 'string' && id)
    : noteIndex !== null ? [`melody-${noteIndex}`] : [];
  return {
    id: issue.id ?? `issue-${index}`,
    issueIndex: index,
    code: issue.code ?? issue.type ?? '',
    severity,
    message: issue.message ?? issue.title ?? '',
    chordIndices,
    voices,
    explicitNotes,
    explicitNoteIds,
  };
}

/**
 * Pure engraving layout computation for both "four-part" and "melody-harmonize" modes.
 * Runs in Node without any browser DOM so every geometric invariant can be unit tested.
 */
export function computeGrandStaffLayout(model = {}, options = {}) {
  const mode = model.mode === 'melody-harmonize' ? 'melody-harmonize' : 'four-part';
  const rawKey = model.keySignature ?? model.key_signature ?? model.key?.fifths ?? 0;
  const keySignature = validKey(rawKey) ? rawKey : 0;
  const timeSignature = parseTimeSignature(model.timeSignature ?? model.time_signature ?? model.meter);
  const beatsPerMeasure = Math.max(1, timeSignature.beats * (4 / timeSignature.beatType));

  const lineSpacing = options.lineSpacing ?? 10;
  const staffGap = options.staffGap ?? 58;
  const topPadding = options.topPadding ?? 54;
  const trebleTopY = topPadding;
  const trebleBottomY = trebleTopY + 4 * lineSpacing;
  const bassTopY = trebleBottomY + staffGap;
  const bassBottomY = bassTopY + 4 * lineSpacing;
  const romanY = bassBottomY + 42;
  const figuredBassY = romanY + 17;

  const rx = lineSpacing * 0.62;
  const ry = lineSpacing * 0.46;

  const leftMargin = 24;
  const braceX = leftMargin;
  const clefX = leftMargin + 13;
  const clefWidth = 34;
  const keySigX = clefX + clefWidth;
  const keySigAccSpacing = 9.5;
  const keySigCount = Math.abs(keySignature);
  const keySigWidth = keySigCount > 0 ? keySigCount * keySigAccSpacing + 10 : 0;
  const timeSigX = keySigX + keySigWidth + 6;
  const timeSigWidth = 24;
  const musicStartX = timeSigX + timeSigWidth + 22;

  const trebleKeySig = keySignatureAccidentals(keySignature, 'treble').map((acc, idx) => ({
    ...acc,
    x: keySigX + idx * keySigAccSpacing,
    y: staffYPosition(acc.letter, acc.octave, 'treble', trebleTopY, lineSpacing).y,
  }));
  const bassKeySig = keySignatureAccidentals(keySignature, 'bass').map((acc, idx) => ({
    ...acc,
    x: keySigX + idx * keySigAccSpacing,
    y: staffYPosition(acc.letter, acc.octave, 'bass', bassTopY, lineSpacing).y,
  }));

  const columns = [];
  const rawNoteEntries = [];
  const showSatbPreview = Boolean(options.showSatbPreview ?? model.showSatbPreview);
  const selection = model.selection || options.selection || null;

  if (mode === 'four-part') {
    const chords = Array.isArray(model.chords) ? model.chords : [];
    const baseColWidth = options.columnWidth ?? 74;
    let cursorBeat = 0;
    let currentX = musicStartX + baseColWidth * 0.45;
    let prevMeasure = 1;

    chords.forEach((chord, chordIndex) => {
      const duration = Number.isFinite(Number(chord?.duration)) && Number(chord.duration) > 0 ? Number(chord.duration) : 1;
      const onset = Number.isFinite(Number(chord?.onset)) && Number(chord.onset) >= 0 ? Number(chord.onset) : cursorBeat;
      cursorBeat = Math.max(cursorBeat, onset + duration);
      const measure = Math.floor((onset + 1e-6) / beatsPerMeasure) + 1;
      if (chordIndex > 0 && measure > prevMeasure) currentX += 18; // Visual breathing room after barline.
      prevMeasure = measure;

      const x = currentX;
      const colStep = Math.max(baseColWidth, Math.min(98, baseColWidth * (0.72 + duration * 0.28)));
      columns.push({
        chordIndex,
        onset,
        duration,
        x,
        hitLeft: x - colStep * 0.45,
        hitRight: x + colStep * 0.45,
        measure,
        roman: chord?.roman ?? chord?.label ?? '',
        figuredBass: parseFiguredBass(chord?.figuredBass ?? chord?.figures),
        cadence: chord?.cadence ?? null,
      });

      const voiceMap = chord?.voices && typeof chord.voices === 'object' ? chord.voices : (chord || {});
      for (const voice of ['S', 'A', 'T', 'B']) {
        const raw = voiceMap[voice];
        const pitch = resolvePitchFromInput(raw, keySignature);
        if (!pitch) continue;
        rawNoteEntries.push({
          id: raw?.id ?? `note-${chordIndex}-${voice}`,
          chordIndex,
          voice,
          clef: VOICE_CLEF[voice],
          staff: VOICE_CLEF[voice],
          onset,
          duration,
          measure,
          baseX: x,
          pitch,
          ghost: Boolean(raw?.ghost),
          given: Boolean(raw?.given || raw?.locked),
          nct: raw?.nct ?? null,
        });
      }
      currentX += colStep;
    });
  } else {
    // Melody harmonization mode: time-proportional x positions preserving exact melody rhythm.
    const melody = Array.isArray(model.melody) ? model.melody : [];
    const harmonization = Array.isArray(model.harmonization) ? model.harmonization : [];
    const satbPreview = Array.isArray(model.satbPreview) ? model.satbPreview : [];
    const beatWidth = options.beatWidth ?? 68;
    const minGap = options.minNoteGap ?? 38;

    // Collect all unique rhythmic beat positions across melody and harmonization so eighths stay spacious.
    const normalizedMelody = [];
    let mCursor = 0;
    melody.forEach((item, idx) => {
      if (!item || typeof item !== 'object') return;
      const duration = Number.isFinite(Number(item.duration)) && Number(item.duration) > 0 ? Number(item.duration) : 1;
      const onset = Number.isFinite(Number(item.onset)) && Number(item.onset) >= 0 ? Number(item.onset) : mCursor;
      mCursor = Math.max(mCursor, onset + duration);
      normalizedMelody.push({ ...item, index: idx, onset, duration });
    });

    const slotCount = Math.max(harmonization.length, showSatbPreview ? satbPreview.length : 0);
    const normalizedSlots = [];
    let hCursor = 0;
    for (let i = 0; i < slotCount; i++) {
      const h = harmonization[i] || null;
      const p = satbPreview[i] || null;
      const rawDur = h?.duration ?? p?.duration;
      const duration = Number.isFinite(Number(rawDur)) && Number(rawDur) > 0 ? Number(rawDur) : 1;
      const rawOnset = h?.onset ?? p?.onset;
      const onset = Number.isFinite(Number(rawOnset)) && Number(rawOnset) >= 0 ? Number(rawOnset) : hCursor;
      hCursor = Math.max(hCursor, onset + duration);
      normalizedSlots.push({ chordIndex: Number.isInteger(h?.chordIndex) ? h.chordIndex : i, onset, duration, h, p });
    }

    // Build monotonic beat -> X mapping with minimum spacing & measure barline padding.
    const beatKeys = new Set();
    normalizedMelody.forEach(m => beatKeys.add(Number(m.onset.toFixed(4))));
    normalizedSlots.forEach(s => beatKeys.add(Number(s.onset.toFixed(4))));
    const sortedBeats = [...beatKeys].sort((a, b) => a - b);
    const beatToX = new Map();
    let cursorX = musicStartX + 28;
    let prevBeat = sortedBeats[0] ?? 0;
    let prevMeasure = Math.floor((prevBeat + 1e-6) / beatsPerMeasure) + 1;
    sortedBeats.forEach((beat, idx) => {
      const measure = Math.floor((beat + 1e-6) / beatsPerMeasure) + 1;
      if (idx > 0) {
        const deltaBeat = beat - prevBeat;
        const barPadding = measure > prevMeasure ? 20 : 0;
        cursorX += Math.max(minGap, deltaBeat * beatWidth) + barPadding;
      }
      beatToX.set(beat, cursorX);
      prevBeat = beat;
      prevMeasure = measure;
    });

    const xForBeat = onset => {
      const key = Number(onset.toFixed(4));
      if (beatToX.has(key)) return beatToX.get(key);
      return musicStartX + 28 + onset * beatWidth;
    };

    normalizedSlots.forEach((slot, idx) => {
      const x = xForBeat(slot.onset);
      const nextX = idx + 1 < normalizedSlots.length ? xForBeat(normalizedSlots[idx + 1].onset) : x + Math.max(60, slot.duration * beatWidth);
      const prevX = idx > 0 ? xForBeat(normalizedSlots[idx - 1].onset) : x - 36;
      const measure = Math.floor((slot.onset + 1e-6) / beatsPerMeasure) + 1;
      columns.push({
        chordIndex: slot.chordIndex,
        onset: slot.onset,
        duration: slot.duration,
        x,
        hitLeft: (prevX + x) / 2,
        hitRight: (x + nextX) / 2,
        measure,
        roman: slot.h?.roman ?? slot.h?.label ?? '',
        figuredBass: parseFiguredBass(slot.h?.figuredBass ?? slot.h?.figures),
        cadence: slot.h?.cadence ?? null,
      });

      const bassRaw = slot.h?.bass ?? slot.h?.voices?.B ?? (slot.h?.midi !== undefined || slot.h?.spell !== undefined ? slot.h : null);
      const bassPitch = resolvePitchFromInput(bassRaw, keySignature);
      if (bassPitch) {
        rawNoteEntries.push({
          id: bassRaw?.id ?? `bass-${slot.chordIndex}`,
          chordIndex: slot.chordIndex,
          voice: 'B',
          clef: 'bass',
          staff: 'bass',
          onset: slot.onset,
          duration: slot.duration,
          measure,
          baseX: x,
          pitch: bassPitch,
          ghost: false,
          given: Boolean(bassRaw?.given || bassRaw?.locked),
          nct: null,
        });
      }

      if (showSatbPreview && slot.p) {
        const previewVoices = slot.p.voices && typeof slot.p.voices === 'object' ? slot.p.voices : slot.p;
        for (const innerVoice of ['A', 'T']) {
          const innerPitch = resolvePitchFromInput(previewVoices[innerVoice], keySignature);
          if (!innerPitch) continue;
          rawNoteEntries.push({
            id: `ghost-${slot.chordIndex}-${innerVoice}`,
            chordIndex: slot.chordIndex,
            voice: innerVoice,
            clef: VOICE_CLEF[innerVoice],
            staff: VOICE_CLEF[innerVoice],
            onset: slot.onset,
            duration: slot.duration,
            measure,
            baseX: x,
            pitch: innerPitch,
            ghost: true,
            given: false,
            nct: null,
          });
        }
      }
    });

    normalizedMelody.forEach(item => {
      const pitch = resolvePitchFromInput(item, keySignature);
      if (!pitch) return;
      const x = xForBeat(item.onset);
      const measure = Math.floor((item.onset + 1e-6) / beatsPerMeasure) + 1;
      let chordIndex = Number.isInteger(item.chordIndex) ? item.chordIndex : null;
      if (chordIndex === null) {
        const matchSlot = normalizedSlots.find(s => item.onset >= s.onset - 1e-6 && item.onset < s.onset + s.duration - 1e-6);
        chordIndex = matchSlot ? matchSlot.chordIndex : item.index;
      }
      const nctLabel = typeof item.nct === 'string' ? item.nct : item.nct?.label ?? item.nct?.type ?? null;
      rawNoteEntries.push({
        id: item.id ?? `melody-${item.index}`,
        chordIndex,
        voice: 'S',
        clef: 'treble',
        staff: 'treble',
        onset: item.onset,
        duration: item.duration,
        measure,
        baseX: x,
        pitch,
        ghost: false,
        given: true,
        nct: nctLabel,
      });
    });
  }

  // Compute barlines between consecutive measures.
  const barlines = [];
  const measureNumbers = [];
  const allTimedPoints = [
    ...columns.map(c => ({ onset: c.onset, x: c.x, measure: c.measure })),
    ...rawNoteEntries.map(n => ({ onset: n.onset, x: n.baseX, measure: n.measure })),
  ].sort((a, b) => a.onset - b.onset || a.x - b.x);

  const measureFirstX = new Map();
  const measureLastX = new Map();
  for (const pt of allTimedPoints) {
    if (!measureFirstX.has(pt.measure)) measureFirstX.set(pt.measure, pt.x);
    measureLastX.set(pt.measure, Math.max(measureLastX.get(pt.measure) ?? -Infinity, pt.x));
  }
  const sortedMeasures = [...measureFirstX.keys()].sort((a, b) => a - b);
  sortedMeasures.forEach((measure, idx) => {
    if (idx === 0) {
      measureNumbers.push({ measure, x: musicStartX + 4, y: trebleTopY - 14 });
      return;
    }
    const prevMeasure = sortedMeasures[idx - 1];
    const barX = (measureLastX.get(prevMeasure) + measureFirstX.get(measure)) / 2;
    barlines.push({
      x: barX,
      beat: (measure - 1) * beatsPerMeasure,
      measure,
      type: 'single',
    });
    measureNumbers.push({ measure, x: barX + 6, y: trebleTopY - 14 });
  });

  const lastContentX = allTimedPoints.length ? Math.max(...allTimedPoints.map(p => p.x)) : musicStartX + 180;
  const staffRightX = Math.max(musicStartX + 240, lastContentX + 48);
  barlines.push({ x: staffRightX, beat: null, measure: null, type: 'final' });
  const width = Math.ceil(staffRightX + 24);

  // Resolve Y coordinates, second-interval horizontal offsets, accidentals without collisions, and stems.
  const defaultAlts = keyAlterations(keySignature);
  const measureAlts = new Map(); // key: `${measure}:${clef}:${letter}:${octave}` -> alteration

  // Group notes by (onset key, clef) to detect 2nd intervals & accidental collisions on the same staff.
  const staffGroups = new Map();
  const laidOutNotes = rawNoteEntries.map(entry => {
    const staffTopY = entry.clef === 'bass' ? bassTopY : trebleTopY;
    const pos = staffYPosition(entry.pitch.letter, entry.pitch.octave, entry.clef, staffTopY, lineSpacing);
    const rhythm = rhythmStyle(entry.duration);
    const stemDir = VOICE_STEM_DIR[entry.voice] || 'up';
    const isSelected = Boolean(selection && selection.chordIndex === entry.chordIndex && (!selection.voice || selection.voice === entry.voice));
    const note = {
      id: entry.id,
      chordIndex: entry.chordIndex,
      voice: entry.voice,
      clef: entry.clef,
      staff: entry.staff,
      letter: entry.pitch.letter,
      octave: entry.pitch.octave,
      alteration: entry.pitch.alteration,
      diatonicStep: entry.pitch.diatonicStep,
      staffStep: pos.staffStep,
      midi: entry.pitch.midi,
      spell: `${entry.pitch.letter}${ASCII_SIGNS[entry.pitch.alteration]}${entry.pitch.octave}`,
      display: entry.pitch.display,
      onset: entry.onset,
      duration: entry.duration,
      measure: entry.measure,
      baseX: entry.baseX,
      x: entry.baseX,
      y: pos.y,
      offsetX: 0,
      rx,
      ry,
      filled: rhythm.filled,
      hasStem: rhythm.hasStem,
      flags: rhythm.flags,
      dotted: rhythm.dotted,
      stemDir,
      stem: null,
      ledgerLines: pos.ledgerLines,
      accidental: null,
      ghost: entry.ghost,
      given: entry.given,
      nct: entry.nct,
      selected: isSelected,
    };
    const groupKey = `${entry.onset.toFixed(4)}:${entry.clef}`;
    if (!staffGroups.has(groupKey)) staffGroups.set(groupKey, []);
    staffGroups.get(groupKey).push(note);
    return note;
  });

  // Sort groups chronologically so measure-scoped accidentals track left-to-right accurately.
  const orderedGroups = [...staffGroups.values()].sort((a, b) => a[0].onset - b[0].onset);
  for (const group of orderedGroups) {
    // 1. Second-interval horizontal offset (when two voices on same staff are 1 diatonic step apart,
    //    or unison with differing alterations, or tight crossing).
    if (group.length >= 2) {
      const upper = group.find(n => n.voice === 'S' || n.voice === 'T') || group[0];
      const lower = group.find(n => n !== upper && (n.voice === 'A' || n.voice === 'B')) || group[1];
      if (upper && lower) {
        const diff = upper.diatonicStep - lower.diatonicStep;
        const needsOffset = Math.abs(diff) === 1 || (diff === 0 && upper.alteration !== lower.alteration);
        if (needsOffset) {
          // Upper voice (stem up on right) stays at baseX; lower voice (stem down on left) shifts right by ~2*rx
          // so the two stems align cleanly and noteheads kiss without overlapping.
          lower.offsetX = Number((rx * 2.05).toFixed(2));
          lower.x = lower.baseX + lower.offsetX;
        }
      }
    }

    // 2. Measure-scoped accidentals with collision-free horizontal stacking.
    const needsAcc = [];
    // Process top-to-bottom vertically so upper accidental sits closest to notehead.
    const byPitchDesc = [...group].sort((a, b) => b.diatonicStep - a.diatonicStep);
    for (const note of byPitchDesc) {
      const stateKey = `${note.measure}:${note.clef}:${note.letter}:${note.octave}`;
      const activeAlt = measureAlts.has(stateKey) ? measureAlts.get(stateKey) : defaultAlts[note.letter];
      if (note.alteration !== activeAlt) {
        needsAcc.push(note);
        // Only non-ghost notes mutate the printed measure accidental state.
        if (!note.ghost) measureAlts.set(stateKey, note.alteration);
      }
    }

    if (needsAcc.length) {
      const leftmostX = Math.min(...group.map(n => n.x)) - rx;
      const placed = [];
      for (const note of needsAcc) {
        let slot = 0;
        while (placed.some(p => p.slot === slot && Math.abs(p.y - note.y) < lineSpacing * 2.2)) {
          slot++;
        }
        const accX = leftmostX - 8 - slot * 11;
        note.accidental = {
          symbol: accidentalSymbolForAlteration(note.alteration),
          alteration: note.alteration,
          x: accX,
          y: note.y,
        };
        placed.push({ slot, y: note.y });
      }
    }

    // 3. Stem coordinates (extending at least to the staff middle line for far ledger notes).
    for (const note of group) {
      if (!note.hasStem) continue;
      const staffMidY = (note.clef === 'bass' ? bassTopY : trebleTopY) + 2 * lineSpacing;
      const baseLen = lineSpacing * 3.3;
      if (note.stemDir === 'up') {
        const x = note.x + rx - 0.7;
        const y1 = note.y - 1;
        const y2 = Math.min(note.y - baseLen, staffMidY);
        note.stem = { x, y1, y2, dir: 'up' };
      } else {
        const x = note.x - rx + 0.7;
        const y1 = note.y + 1;
        const y2 = Math.max(note.y + baseLen, staffMidY);
        note.stem = { x, y1, y2, dir: 'down' };
      }
    }
  }

  // Phrase & cadence brackets (above treble staff).
  const phrases = [];
  if (Array.isArray(model.phrases)) {
    for (const phrase of model.phrases) {
      if (!phrase || typeof phrase !== 'object') continue;
      const startCol = Number.isInteger(phrase.startIndex) ? columns[phrase.startIndex]
        : columns.find(c => c.onset >= (phrase.startBeat ?? 0) - 1e-6);
      const endCol = Number.isInteger(phrase.endIndex) ? columns[phrase.endIndex]
        : [...columns].reverse().find(c => c.onset <= (phrase.endBeat ?? Infinity) + 1e-6);
      if (!startCol || !endCol) continue;
      phrases.push({
        startX: startCol.x - 16,
        endX: endCol.x + 16,
        y: trebleTopY - 30,
        label: phrase.label ?? '',
        cadence: phrase.cadence ?? endCol.cadence ?? '',
      });
    }
  } else {
    // Auto-surface per-column cadence badges if columns specify cadences.
    columns.forEach(col => {
      if (col.cadence) {
        phrases.push({
          startX: col.x - 18,
          endX: col.x + 18,
          y: trebleTopY - 26,
          label: '',
          cadence: col.cadence,
        });
      }
    });
  }

  // Issue overlays (curved dashed arcs for parallel 5ths/8ves/melodic errors + highlight halos).
  const noteByChordVoice = new Map();
  const noteById = new Map();
  for (const note of laidOutNotes) {
    const key = `${note.chordIndex}:${note.voice}`;
    if (!noteByChordVoice.has(key)) noteByChordVoice.set(key, note);
    if (note.id) noteById.set(String(note.id), note);
  }

  const issueOverlays = [];
  const rawIssues = Array.isArray(model.issues) ? model.issues : [];
  rawIssues.forEach((rawIssue, idx) => {
    const spec = normalizeIssueSpec(rawIssue, idx);
    if (!spec) return;
    const halos = [];
    const arcs = [];
    const seenHalos = new Set();

    const addHalo = note => {
      if (!note) return;
      const key = note.id ? `id:${note.id}` : `${note.chordIndex}:${note.voice}`;
      if (seenHalos.has(key)) return;
      seenHalos.add(key);
      halos.push({
        x: note.x,
        y: note.y,
        noteId: note.id || null,
        chordIndex: note.chordIndex,
        voice: note.voice,
        radius: Math.max(rx, ry) + 4.5,
      });
    };

    if (spec.explicitNoteIds && spec.explicitNoteIds.length) {
      spec.explicitNoteIds.forEach(noteId => addHalo(noteById.get(String(noteId))));
    }
    if (spec.explicitNotes && spec.explicitNotes.length) {
      spec.explicitNotes.forEach(ref => addHalo(noteByChordVoice.get(`${ref.chordIndex}:${ref.voice}`)));
    }

    if (spec.chordIndices.length >= 2 && spec.voices.length >= 1) {
      const [fromChord, toChord] = spec.chordIndices;
      for (const voice of spec.voices) {
        const n1 = noteByChordVoice.get(`${fromChord}:${voice}`);
        const n2 = noteByChordVoice.get(`${toChord}:${voice}`);
        if (n1) addHalo(n1);
        if (n2) addHalo(n2);
        if (n1 && n2) {
          const bowUp = voice === 'S' || voice === 'T';
          const bow = (bowUp ? -1 : 1) * Math.max(16, Math.min(30, Math.abs(n2.x - n1.x) * 0.24));
          const cx = (n1.x + n2.x) / 2;
          const cy = (n1.y + n2.y) / 2 + bow;
          arcs.push({
            fromChord,
            toChord,
            voice,
            x1: n1.x,
            y1: n1.y,
            x2: n2.x,
            y2: n2.y,
            cx,
            cy,
            path: `M ${n1.x.toFixed(1)} ${n1.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${n2.x.toFixed(1)} ${n2.y.toFixed(1)}`,
          });
        }
      }
    } else if (spec.chordIndices.length === 1 && !halos.length) {
      const chordIdx = spec.chordIndices[0];
      const targetVoices = spec.voices.length ? spec.voices : ['S', 'A', 'T', 'B'];
      const found = targetVoices.map(v => noteByChordVoice.get(`${chordIdx}:${v}`)).filter(Boolean);
      found.forEach(addHalo);
      // Connect two offending voices inside one chord (e.g., spacing error between A & T or voice crossing).
      if (found.length === 2) {
        const [n1, n2] = found;
        const cx = Math.max(n1.x, n2.x) + 18;
        const cy = (n1.y + n2.y) / 2;
        arcs.push({
          fromChord: chordIdx,
          toChord: chordIdx,
          voice: `${n1.voice}-${n2.voice}`,
          x1: n1.x,
          y1: n1.y,
          x2: n2.x,
          y2: n2.y,
          cx,
          cy,
          path: `M ${n1.x.toFixed(1)} ${n1.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${n2.x.toFixed(1)} ${n2.y.toFixed(1)}`,
        });
      }
    }

    if (halos.length || arcs.length) {
      issueOverlays.push({
        id: spec.id,
        issueIndex: spec.issueIndex,
        severity: spec.severity,
        code: spec.code,
        message: spec.message,
        chordIndices: spec.chordIndices,
        voices: spec.voices,
        halos,
        arcs,
      });
    }
  });

  const maxFigLines = columns.reduce((max, c) => Math.max(max, c.figuredBass.length), 0);
  const lowestNoteY = laidOutNotes.reduce((max, n) => Math.max(max, n.y), bassBottomY);
  const adjustedRomanY = Math.max(romanY, lowestNoteY + 26);
  const adjustedFiguredBassY = adjustedRomanY + 17;
  const height = Math.ceil(adjustedFiguredBassY + Math.max(1, maxFigLines) * 14 + 16);

  return {
    mode,
    width,
    height,
    lineSpacing,
    staffGap,
    keySignature,
    timeSignature,
    beatsPerMeasure,
    musicStartX,
    staffLeftX: braceX,
    staffRightX,
    treble: {
      topY: trebleTopY,
      bottomY: trebleBottomY,
      lines: [0, 1, 2, 3, 4].map(i => trebleTopY + i * lineSpacing),
    },
    bass: {
      topY: bassTopY,
      bottomY: bassBottomY,
      lines: [0, 1, 2, 3, 4].map(i => bassTopY + i * lineSpacing),
    },
    brace: {
      x: braceX,
      topY: trebleTopY,
      bottomY: bassBottomY,
      path: buildBracePath(braceX, trebleTopY, bassBottomY),
    },
    clefs: {
      treble: { x: clefX, y: trebleTopY + 3 * lineSpacing },
      bass: { x: clefX, y: bassTopY + lineSpacing },
    },
    keySig: {
      x: keySigX,
      treble: trebleKeySig,
      bass: bassKeySig,
    },
    timeSig: {
      x: timeSigX,
      beats: timeSignature.beats,
      beatType: timeSignature.beatType,
      trebleY: trebleTopY + 2 * lineSpacing,
      bassY: bassTopY + 2 * lineSpacing,
    },
    columns,
    barlines,
    measureNumbers,
    notes: laidOutNotes,
    phrases,
    issueOverlays,
    harmony: {
      romanY: adjustedRomanY,
      figuredBassY: adjustedFiguredBassY,
    },
    playhead: {
      topY: trebleTopY - 12,
      bottomY: bassBottomY + 12,
      defaultX: columns[0]?.x ?? musicStartX + 20,
    },
  };
}

// ---------------------------------------------------------------------------
// SVG DOM Rendering & Interactive Highlighting
// ---------------------------------------------------------------------------

function svgEl(doc, tag, attrs = {}, text = null) {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  if (text !== null) node.textContent = text;
  return node;
}

function drawTrebleClef(doc, cx, gLineY, lineSpacing) {
  const s = lineSpacing / 10;
  const g = svgEl(doc, 'g', {
    class: 'gs-clef gs-clef-treble',
    transform: `translate(${cx}, ${gLineY}) scale(${s})`,
    'aria-hidden': 'true',
  });
  // Crisp vector G-clef curling around G4 (origin 0,0), rising above F5 and descending below E4.
  g.appendChild(svgEl(doc, 'path', {
    d: 'M 2 6 C -6 6, -9 -1, -5 -7 C -2 -11, 5 -11, 7 -6 C 9 -1, 4 5, -2 4 C -6 3, -7 -1, -4 -4 C -1 -6, 3 -4, 2 -1',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2.1,
    'stroke-linecap': 'round',
  }));
  g.appendChild(svgEl(doc, 'path', {
    d: 'M 2 -10 C 6 -21, 5 -36, 0 -41 C -4 -36, -5 -22, -1 -8 L 3 16 C 4 21, 1 25, -3 24 C -6 23, -7 20, -5 18',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2.0,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }));
  g.appendChild(svgEl(doc, 'circle', { cx: -4.8, cy: 18.5, r: 2.3, fill: 'currentColor' }));
  return g;
}

function drawBassClef(doc, cx, fLineY, lineSpacing) {
  const s = lineSpacing / 10;
  const g = svgEl(doc, 'g', {
    class: 'gs-clef gs-clef-bass',
    transform: `translate(${cx}, ${fLineY}) scale(${s})`,
    'aria-hidden': 'true',
  });
  g.appendChild(svgEl(doc, 'circle', { cx: -6, cy: 0, r: 3.1, fill: 'currentColor' }));
  g.appendChild(svgEl(doc, 'path', {
    d: 'M -6 -1 C -7 -9, 1 -11, 6 -6 C 10 -1, 8 10, -7 22',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2.6,
    'stroke-linecap': 'round',
  }));
  g.appendChild(svgEl(doc, 'circle', { cx: 12.5, cy: -4.5, r: 1.9, fill: 'currentColor' }));
  g.appendChild(svgEl(doc, 'circle', { cx: 12.5, cy: 5.0, r: 1.9, fill: 'currentColor' }));
  return g;
}

function drawAccidental(doc, alteration, x, y, lineSpacing, className = 'gs-accidental') {
  const s = lineSpacing / 10;
  const g = svgEl(doc, 'g', {
    class: className,
    transform: `translate(${x.toFixed(1)}, ${y.toFixed(1)}) scale(${s})`,
    'aria-hidden': 'true',
  });
  if (alteration === 1) {
    // Sharp
    g.appendChild(svgEl(doc, 'path', {
      d: 'M -2.2 -8 L -2.2 8 M 2.2 -8.5 L 2.2 7.5',
      stroke: 'currentColor', 'stroke-width': 1.15, 'stroke-linecap': 'round',
    }));
    g.appendChild(svgEl(doc, 'path', {
      d: 'M -4.8 -2.1 L 4.8 -4.3 M -4.8 4.1 L 4.8 1.9',
      stroke: 'currentColor', 'stroke-width': 2.1, 'stroke-linecap': 'butt',
    }));
  } else if (alteration === -1) {
    // Flat
    g.appendChild(svgEl(doc, 'path', {
      d: 'M -2.6 -10.5 L -2.6 4.8 C 2.2 2.4, 4.4 -1.2, 2.2 -3.4 C 0.6 -4.8, -1.6 -3.2, -2.6 -1.4',
      fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }));
  } else if (alteration === 0) {
    // Natural
    g.appendChild(svgEl(doc, 'path', {
      d: 'M -2.4 -8.5 L -2.4 3.5 M 2.4 -3.5 L 2.4 8.5',
      stroke: 'currentColor', 'stroke-width': 1.15, 'stroke-linecap': 'round',
    }));
    g.appendChild(svgEl(doc, 'path', {
      d: 'M -2.4 -2.2 L 2.4 -3.6 M -2.4 3.5 L 2.4 2.1',
      stroke: 'currentColor', 'stroke-width': 2.0,
    }));
  } else if (alteration === 2) {
    // Double sharp
    g.appendChild(svgEl(doc, 'path', {
      d: 'M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5',
      stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round',
    }));
    for (const [dx, dy] of [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5]]) {
      g.appendChild(svgEl(doc, 'circle', { cx: dx, cy: dy, r: 1.25, fill: 'currentColor' }));
    }
  } else if (alteration === -2) {
    // Double flat
    for (const dx of [-3.2, 2.4]) {
      g.appendChild(svgEl(doc, 'path', {
        d: `M ${dx - 1.4} -10.5 L ${dx - 1.4} 4.6 C ${dx + 2.4} 2.4, ${dx + 4.0} -1.1, ${dx + 2.1} -3.2 C ${dx + 0.7} -4.4, ${dx - 0.8} -3.0, ${dx - 1.4} -1.4`,
        fill: 'none', stroke: 'currentColor', 'stroke-width': 1.35, 'stroke-linecap': 'round',
      }));
    }
  }
  return g;
}

function drawFlag(doc, x, tipY, dir, count) {
  const group = svgEl(doc, 'g', { class: 'gs-flags', 'aria-hidden': 'true' });
  const sign = dir === 'up' ? 1 : -1;
  for (let i = 0; i < count; i++) {
    const startY = tipY + sign * (i * 6.5);
    const d = dir === 'up'
      ? `M ${x} ${startY} C ${x + 6} ${startY + 4}, ${x + 9} ${startY + 11}, ${x + 5} ${startY + 18}`
      : `M ${x} ${startY} C ${x + 6} ${startY - 4}, ${x + 9} ${startY - 11}, ${x + 5} ${startY - 18}`;
    group.appendChild(svgEl(doc, 'path', {
      d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round',
    }));
  }
  return group;
}

function embeddedStyles() {
  return `
    .gs-svg { font-family: Georgia, "Times New Roman", serif; user-select: none; overflow: visible; }
    .gs-staff-line { stroke: var(--ink, #292e2b); stroke-opacity: 0.55; stroke-width: 1; }
    .gs-barline { stroke: var(--ink, #292e2b); stroke-opacity: 0.65; stroke-width: 1.15; }
    .gs-barline-final-thick { stroke: var(--ink, #292e2b); stroke-width: 3.4; }
    .gs-brace { fill: var(--ink, #292e2b); }
    .gs-clef, .gs-keysig, .gs-timesig { color: var(--ink, #292e2b); fill: var(--ink, #292e2b); }
    .gs-timesig { font-weight: 700; font-size: 18px; text-anchor: middle; dominant-baseline: central; }
    .gs-measure-num { font-family: "Segoe UI", Arial, sans-serif; font-size: 10px; fill: var(--muted, #747970); }
    .gs-ledger { stroke: var(--ink, #292e2b); stroke-opacity: 0.72; stroke-width: 1.15; }
    .gs-note { cursor: pointer; transition: opacity 0.14s ease; }
    .gs-note-S { color: var(--ink, #292e2b); }
    .gs-note-A { color: #3a5646; }
    .gs-note-T { color: #364f68; }
    .gs-note-B { color: var(--ink, #292e2b); }
    .gs-note-ghost { opacity: 0.42; color: var(--muted, #747970); }
    .gs-notehead-filled { fill: currentColor; stroke: currentColor; stroke-width: 0.6; }
    .gs-notehead-hollow { fill: var(--white, #fffefa); stroke: currentColor; stroke-width: 1.8; }
    .gs-stem { stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; }
    .gs-dot { fill: currentColor; }
    .gs-note.selected .gs-notehead-filled { fill: var(--accent, #a54832); stroke: var(--accent, #a54832); }
    .gs-note.selected .gs-notehead-hollow { stroke: var(--accent, #a54832); }
    .gs-note.selected .gs-stem { stroke: var(--accent, #a54832); }
    .gs-note.active { color: var(--accent, #a54832); opacity: 1; }
    .gs-note.active .gs-notehead-filled { fill: var(--accent, #a54832); stroke: var(--accent, #a54832); }
    .gs-note.active .gs-notehead-hollow { stroke: var(--accent, #a54832); fill: #f7ece6; }
    .gs-note.gs-issue-target .gs-notehead-filled { fill: #b83324; stroke: #b83324; }
    .gs-roman { font-family: Georgia, serif; font-size: 14px; font-weight: 600; fill: var(--ink, #292e2b); text-anchor: middle; }
    .gs-figure { font-family: "Segoe UI", Arial, sans-serif; font-size: 10.5px; font-weight: 600; fill: var(--muted, #747970); text-anchor: middle; }
    .gs-nct-bg { fill: #eef3ee; stroke: var(--green, #4d6857); stroke-width: 0.9; }
    .gs-nct-text { font-family: "Segoe UI", Arial, sans-serif; font-size: 9px; font-weight: 700; fill: var(--green, #4d6857); text-anchor: middle; dominant-baseline: central; }
    .gs-phrase-line { fill: none; stroke: var(--green, #4d6857); stroke-width: 1.25; stroke-opacity: 0.78; }
    .gs-cadence-label { font-family: "Segoe UI", Arial, sans-serif; font-size: 10px; font-weight: 700; fill: var(--green, #4d6857); text-anchor: middle; }
    .gs-hit-area { fill: transparent; cursor: crosshair; }
    .gs-hit-area:hover { fill: rgba(165, 72, 50, 0.045); }
    .gs-hover-preview { pointer-events: none; opacity: 0.45; color: var(--accent, #a54832); }
    .gs-issue-arc { fill: none; stroke-width: 1.8; stroke-dasharray: 4 3; stroke-linecap: round; pointer-events: none; }
    .gs-issue-error .gs-issue-arc { stroke: var(--accent, #a54832); }
    .gs-issue-warning .gs-issue-arc { stroke: #b68b27; }
    .gs-issue-info .gs-issue-arc { stroke: var(--green, #4d6857); }
    .gs-issue-halo { fill: none; stroke-width: 2; pointer-events: none; }
    .gs-issue-error .gs-issue-halo { stroke: var(--accent, #a54832); fill: rgba(165, 72, 50, 0.14); }
    .gs-issue-warning .gs-issue-halo { stroke: #b68b27; fill: rgba(182, 139, 39, 0.15); }
    .gs-issue-info .gs-issue-halo { stroke: var(--green, #4d6857); fill: rgba(77, 104, 87, 0.14); }
    .gs-svg.gs-has-focused-issue .gs-issue-group { opacity: 0.22; }
    .gs-svg.gs-has-focused-issue .gs-issue-group.gs-issue-focused { opacity: 1; }
    .gs-issue-group.gs-issue-focused .gs-issue-arc { stroke-width: 2.8; stroke-dasharray: 6 3; }
    .gs-issue-group.gs-issue-focused .gs-issue-halo { stroke-width: 2.8; }
    .gs-playhead { stroke: var(--accent, #a54832); stroke-width: 2; stroke-opacity: 0.72; pointer-events: none; }
    .gs-column-active-band { fill: rgba(165, 72, 50, 0.08); pointer-events: none; }
  `;
}

function clientToSvgPoint(svgElement, clientX, clientY, layout) {
  if (typeof svgElement.getScreenCTM === 'function') {
    const ctm = svgElement.getScreenCTM();
    if (ctm && typeof ctm.inverse === 'function') {
      const inv = ctm.inverse();
      return {
        x: clientX * inv.a + clientY * inv.c + inv.e,
        y: clientX * inv.b + clientY * inv.d + inv.f,
      };
    }
  }
  if (typeof svgElement.getBoundingClientRect === 'function') {
    const rect = svgElement.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return {
        x: ((clientX - rect.left) / rect.width) * layout.width,
        y: ((clientY - rect.top) / rect.height) * layout.height,
      };
    }
  }
  return { x: clientX, y: clientY };
}

/**
 * Render an interactive publication-grade SVG Grand Staff into `svgElement`.
 */
export function renderGrandStaff(svgElement, model = {}, handlers = {}) {
  if (!svgElement) throw new TypeError('renderGrandStaff requires an SVG element.');
  const doc = svgElement.ownerDocument || globalThis.document;
  const options = handlers.options || model.options || {};
  const layout = computeGrandStaffLayout(model, options);
  const editable = handlers.editable ?? options.editable ?? model.editable ?? true;

  svgElement.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
  svgElement.style?.setProperty?.('--gs-width', `${Math.max(560, Math.round(layout.width))}px`);
  svgElement.setAttribute('role', 'img');
  svgElement.setAttribute('aria-label', model.title || 'Interactive Grand Staff');
  svgElement.classList?.add('gs-svg');
  svgElement.classList?.remove('gs-has-focused-issue');
  svgElement.replaceChildren?.();
  if (!svgElement.replaceChildren) {
    while (svgElement.firstChild) svgElement.removeChild(svgElement.firstChild);
  }

  svgElement.appendChild(svgEl(doc, 'style', {}, embeddedStyles()));

  // Layer 1: Background & active column highlight band.
  const bgLayer = svgEl(doc, 'g', { class: 'gs-background' });
  bgLayer.appendChild(svgEl(doc, 'rect', {
    x: 0, y: 0, width: layout.width, height: layout.height, rx: 6, fill: 'var(--white, #fffefa)',
  }));
  const activeBand = svgEl(doc, 'rect', {
    class: 'gs-column-active-band',
    x: 0, y: layout.treble.topY - 10, width: 32, height: layout.bass.bottomY - layout.treble.topY + 20, rx: 4,
    visibility: 'hidden',
  });
  bgLayer.appendChild(activeBand);
  svgElement.appendChild(bgLayer);

  // Layer 2: Staves, brace, clefs, key signatures, time signatures, barlines, measure numbers.
  const stavesLayer = svgEl(doc, 'g', { class: 'gs-staves' });
  for (const y of [...layout.treble.lines, ...layout.bass.lines]) {
    stavesLayer.appendChild(svgEl(doc, 'line', {
      class: 'gs-staff-line',
      x1: layout.staffLeftX, y1: y, x2: layout.staffRightX, y2: y,
    }));
  }
  // Left system connecting barline + curly brace.
  stavesLayer.appendChild(svgEl(doc, 'line', {
    class: 'gs-barline',
    x1: layout.staffLeftX, y1: layout.treble.topY, x2: layout.staffLeftX, y2: layout.bass.bottomY,
  }));
  stavesLayer.appendChild(svgEl(doc, 'path', { class: 'gs-brace', d: layout.brace.path }));

  // Clefs.
  stavesLayer.appendChild(drawTrebleClef(doc, layout.clefs.treble.x, layout.clefs.treble.y, layout.lineSpacing));
  stavesLayer.appendChild(drawBassClef(doc, layout.clefs.bass.x, layout.clefs.bass.y, layout.lineSpacing));

  // Key signatures.
  const keySigGroup = svgEl(doc, 'g', { class: 'gs-keysig' });
  for (const acc of [...layout.keySig.treble, ...layout.keySig.bass]) {
    keySigGroup.appendChild(drawAccidental(doc, acc.alteration, acc.x, acc.y, layout.lineSpacing, 'gs-keysig-acc'));
  }
  stavesLayer.appendChild(keySigGroup);

  // Time signatures (treble & bass).
  for (const baseY of [layout.timeSig.trebleY, layout.timeSig.bassY]) {
    stavesLayer.appendChild(svgEl(doc, 'text', {
      class: 'gs-timesig', x: layout.timeSig.x, y: baseY - layout.lineSpacing,
    }, String(layout.timeSig.beats)));
    stavesLayer.appendChild(svgEl(doc, 'text', {
      class: 'gs-timesig', x: layout.timeSig.x, y: baseY + layout.lineSpacing,
    }, String(layout.timeSig.beatType)));
  }

  // Barlines.
  for (const bar of layout.barlines) {
    if (bar.type === 'final') {
      stavesLayer.appendChild(svgEl(doc, 'line', {
        class: 'gs-barline',
        x1: bar.x - 5.5, y1: layout.treble.topY, x2: bar.x - 5.5, y2: layout.bass.bottomY,
      }));
      stavesLayer.appendChild(svgEl(doc, 'line', {
        class: 'gs-barline-final-thick',
        x1: bar.x, y1: layout.treble.topY, x2: bar.x, y2: layout.bass.bottomY,
      }));
    } else {
      stavesLayer.appendChild(svgEl(doc, 'line', {
        class: 'gs-barline',
        x1: bar.x, y1: layout.treble.topY, x2: bar.x, y2: layout.bass.bottomY,
      }));
    }
  }

  // Measure numbers.
  for (const mn of layout.measureNumbers) {
    stavesLayer.appendChild(svgEl(doc, 'text', {
      class: 'gs-measure-num', x: mn.x, y: mn.y,
    }, String(mn.measure)));
  }
  svgElement.appendChild(stavesLayer);

  // Layer 3: Phrase & cadence brackets.
  const phrasesLayer = svgEl(doc, 'g', { class: 'gs-phrases' });
  for (const ph of layout.phrases) {
    if (ph.endX - ph.startX > 24) {
      phrasesLayer.appendChild(svgEl(doc, 'path', {
        class: 'gs-phrase-line',
        d: `M ${ph.startX} ${ph.y + 7} L ${ph.startX} ${ph.y} L ${ph.endX} ${ph.y} L ${ph.endX} ${ph.y + 7}`,
      }));
    }
    const labelText = [ph.label, ph.cadence].filter(Boolean).join(' · ');
    if (labelText) {
      phrasesLayer.appendChild(svgEl(doc, 'text', {
        class: 'gs-cadence-label',
        x: ph.cadence && !ph.label ? ph.endX - 6 : (ph.startX + ph.endX) / 2,
        y: ph.y - 5,
      }, labelText));
    }
  }
  svgElement.appendChild(phrasesLayer);

  // Layer 4: Issue overlays (halos + curved dashed arcs).
  const overlaysLayer = svgEl(doc, 'g', { class: 'gs-overlays' });
  for (const ov of layout.issueOverlays) {
    const group = svgEl(doc, 'g', {
      class: `gs-issue-group gs-issue-${ov.severity}`,
      'data-issue-id': ov.id,
      'data-issue-index': ov.issueIndex,
      'data-issue-code': ov.code,
    });
    for (const halo of ov.halos) {
      group.appendChild(svgEl(doc, 'circle', {
        class: 'gs-issue-halo',
        cx: halo.x, cy: halo.y, r: halo.radius,
        'data-note-id': halo.noteId || undefined,
        'data-chord-index': halo.chordIndex,
        'data-voice': halo.voice,
      }));
    }
    for (const arc of ov.arcs) {
      group.appendChild(svgEl(doc, 'path', {
        class: 'gs-issue-arc',
        d: arc.path,
      }));
    }
    overlaysLayer.appendChild(group);
  }
  svgElement.appendChild(overlaysLayer);

  // Layer 5: Interactive staff click-to-place columns + hover preview ghost.
  const hitLayer = svgEl(doc, 'g', { class: 'gs-hit-columns' });
  const hoverGroup = svgEl(doc, 'g', { class: 'gs-hover-preview', visibility: 'hidden' });
  const hoverLedgers = svgEl(doc, 'g', { class: 'gs-hover-ledgers' });
  const hoverHead = svgEl(doc, 'ellipse', {
    cx: 0, cy: 0, rx: layout.lineSpacing * 0.62, ry: layout.lineSpacing * 0.46,
    fill: 'currentColor', transform: 'rotate(-16 0 0)',
  });
  hoverGroup.appendChild(hoverLedgers);
  hoverGroup.appendChild(hoverHead);
  hitLayer.appendChild(hoverGroup);

  if (editable) {
    const midStaffSplit = (layout.treble.bottomY + layout.bass.topY) / 2;
    const staffBounds = [
      { staff: 'treble', top: layout.treble.topY - 26, bottom: midStaffSplit, staffTopY: layout.treble.topY },
      { staff: 'bass', top: midStaffSplit, bottom: layout.bass.bottomY + 26, staffTopY: layout.bass.topY },
    ];
    for (const col of layout.columns) {
      const hitX = Math.max(layout.musicStartX, col.hitLeft);
      const hitW = Math.max(24, col.hitRight - hitX);
      for (const band of staffBounds) {
        if (layout.mode === 'melody-harmonize' && band.staff === 'treble') continue; // Soprano melody is fixed in FRQ 7.
        const rect = svgEl(doc, 'rect', {
          class: 'gs-hit-area',
          x: hitX,
          y: band.top,
          width: hitW,
          height: band.bottom - band.top,
          'data-chord-index': col.chordIndex,
          'data-staff': band.staff,
        });
        const resolveHoverPitch = event => {
          const pt = clientToSvgPoint(svgElement, event.clientX, event.clientY, layout);
          const snapped = pitchFromStaffY(pt.y, band.staff, band.staffTopY, layout.lineSpacing, layout.keySignature);
          const pos = staffYPosition(snapped.letter, snapped.octave, band.staff, band.staffTopY, layout.lineSpacing);
          return { snapped, pos };
        };
        rect.addEventListener?.('mousemove', event => {
          const { pos } = resolveHoverPitch(event);
          hoverHead.setAttribute('cx', String(col.x));
          hoverHead.setAttribute('cy', String(pos.y));
          hoverHead.setAttribute('transform', `rotate(-16 ${col.x} ${pos.y})`);
          hoverLedgers.replaceChildren?.();
          for (const ly of pos.ledgerLines) {
            hoverLedgers.appendChild(svgEl(doc, 'line', {
              class: 'gs-ledger',
              x1: col.x - layout.lineSpacing * 0.95, y1: ly,
              x2: col.x + layout.lineSpacing * 0.95, y2: ly,
            }));
          }
          hoverGroup.setAttribute('visibility', 'visible');
        });
        rect.addEventListener?.('mouseleave', () => {
          hoverGroup.setAttribute('visibility', 'hidden');
        });
        rect.addEventListener?.('click', event => {
          const { snapped } = resolveHoverPitch(event);
          handlers.onStaffClick?.({
            chordIndex: col.chordIndex,
            staff: band.staff,
            letter: snapped.letter,
            octave: snapped.octave,
            alteration: snapped.alteration,
            spell: snapped.spell,
            display: snapped.display,
            midi: snapped.midi,
            staffStep: snapped.staffStep,
          });
        });
        hitLayer.appendChild(rect);
      }
    }
  }
  svgElement.appendChild(hitLayer);

  // Layer 6: Notes (ledgers, stems, flags, accidentals, noteheads, dots, NCT badges).
  const notesLayer = svgEl(doc, 'g', { class: 'gs-notes' });
  for (const note of layout.notes) {
    const classes = ['gs-note', `gs-note-${note.voice}`];
    if (note.ghost) classes.push('gs-note-ghost');
    if (note.selected) classes.push('selected');
    const g = svgEl(doc, 'g', {
      class: classes.join(' '),
      'data-note-id': note.id,
      'data-chord-index': note.chordIndex,
      'data-voice': note.voice,
      'data-midi': note.midi,
      'data-onset': note.onset,
      'data-duration': note.duration,
      'data-ghost': note.ghost ? 'true' : 'false',
      'aria-label': `${note.voice} ${note.display}`,
    });

    // Ledger lines.
    for (const ly of note.ledgerLines) {
      g.appendChild(svgEl(doc, 'line', {
        class: 'gs-ledger',
        x1: note.x - note.rx - 3.5, y1: ly,
        x2: note.x + note.rx + 3.5, y2: ly,
      }));
    }

    // Accidental.
    if (note.accidental) {
      g.appendChild(drawAccidental(doc, note.accidental.alteration, note.accidental.x, note.accidental.y, layout.lineSpacing));
    }

    // Stem + flags.
    if (note.stem) {
      g.appendChild(svgEl(doc, 'line', {
        class: 'gs-stem',
        x1: note.stem.x, y1: note.stem.y1, x2: note.stem.x, y2: note.stem.y2,
      }));
      if (note.flags > 0) {
        g.appendChild(drawFlag(doc, note.stem.x, note.stem.y2, note.stem.dir, note.flags));
      }
    }

    // Tilted engraved notehead oval.
    g.appendChild(svgEl(doc, 'ellipse', {
      class: note.filled ? 'gs-notehead-filled' : 'gs-notehead-hollow',
      cx: note.x,
      cy: note.y,
      rx: note.rx,
      ry: note.ry,
      transform: `rotate(-18 ${note.x.toFixed(1)} ${note.y.toFixed(1)})`,
    }));

    // Augmentation dot.
    if (note.dotted) {
      const dotY = note.staffStep % 2 === 0 ? note.y - layout.lineSpacing * 0.35 : note.y;
      g.appendChild(svgEl(doc, 'circle', {
        class: 'gs-dot', cx: note.x + note.rx + 4.5, cy: dotY, r: 2.0,
      }));
    }

    // NCT badge (melody mode).
    if (note.nct) {
      const badgeY = Math.min(layout.treble.topY - 14, note.y - 18);
      const badgeW = Math.max(22, String(note.nct).length * 6.5 + 8);
      g.appendChild(svgEl(doc, 'rect', {
        class: 'gs-nct-bg',
        x: note.x - badgeW / 2, y: badgeY - 7, width: badgeW, height: 14, rx: 7,
      }));
      g.appendChild(svgEl(doc, 'text', {
        class: 'gs-nct-text', x: note.x, y: badgeY,
      }, String(note.nct)));
    }

    g.addEventListener?.('click', event => {
      event.stopPropagation?.();
      handlers.onSelectNote?.({
        chordIndex: note.chordIndex,
        voice: note.voice,
        pitch: {
          letter: note.letter,
          octave: note.octave,
          alteration: note.alteration,
          midi: note.midi,
          spell: note.spell,
          display: note.display,
        },
        midi: note.midi,
        spell: note.spell,
        display: note.display,
        onset: note.onset,
        duration: note.duration,
        ghost: note.ghost,
      });
    });

    notesLayer.appendChild(g);
  }
  svgElement.appendChild(notesLayer);

  // Layer 7: Roman numerals & stacked figured bass.
  const harmonyLayer = svgEl(doc, 'g', { class: 'gs-harmony' });
  for (const col of layout.columns) {
    if (col.roman) {
      harmonyLayer.appendChild(svgEl(doc, 'text', {
        class: 'gs-roman',
        x: col.x,
        y: layout.harmony.romanY,
        'data-chord-index': col.chordIndex,
      }, String(col.roman)));
    }
    col.figuredBass.forEach((fig, lineIdx) => {
      harmonyLayer.appendChild(svgEl(doc, 'text', {
        class: 'gs-figure',
        x: col.x,
        y: layout.harmony.figuredBassY + lineIdx * 12,
        'data-chord-index': col.chordIndex,
      }, fig));
    });
  }
  svgElement.appendChild(harmonyLayer);

  // Layer 8: Playhead cursor line.
  const playhead = svgEl(doc, 'line', {
    class: 'gs-playhead',
    x1: layout.playhead.defaultX,
    y1: layout.playhead.topY,
    x2: layout.playhead.defaultX,
    y2: layout.playhead.bottomY,
    visibility: 'hidden',
  });
  svgElement.appendChild(playhead);

  svgElement.__grandStaffLayout = layout;
  return layout;
}

/**
 * Highlight currently playing notes and position the vertical playhead cursor on the Grand Staff.
 */
export function highlightActiveNotes(svgElement, activeEvents = []) {
  if (!svgElement) return;
  const noteNodes = svgElement.querySelectorAll ? [...svgElement.querySelectorAll('.gs-note')] : [];
  for (const node of noteNodes) node.classList?.remove('active');

  const playhead = svgElement.querySelector?.('.gs-playhead');
  const activeBand = svgElement.querySelector?.('.gs-column-active-band');
  if (!Array.isArray(activeEvents) || !activeEvents.length) {
    playhead?.setAttribute('visibility', 'hidden');
    activeBand?.setAttribute('visibility', 'hidden');
    return;
  }

  const knownNoteIds = new Set(noteNodes.map(n => n.getAttribute('data-note-id')).filter(Boolean));
  const matchedX = [];
  for (const node of noteNodes) {
    const noteId = node.getAttribute('data-note-id');
    const chordIndex = Number(node.getAttribute('data-chord-index'));
    const voice = node.getAttribute('data-voice');
    const midi = Number(node.getAttribute('data-midi'));
    const onset = Number(node.getAttribute('data-onset'));

    const matched = activeEvents.some(event => {
      if (event.id && knownNoteIds.has(String(event.id))) {
        return String(event.id) === noteId;
      }
      if (Number.isInteger(event.chordIndex) && event.voice) {
        return event.chordIndex === chordIndex && event.voice === voice && (event.midi === undefined || event.midi === midi);
      }
      if (Number.isFinite(event.onset) && Number.isFinite(event.midi)) {
        return Math.abs(event.onset - onset) <= 0.05 && event.midi === midi;
      }
      return false;
    });

    if (matched) {
      node.classList?.add('active');
      const head = node.querySelector?.('ellipse');
      const cx = head ? Number(head.getAttribute('cx')) : NaN;
      if (Number.isFinite(cx)) matchedX.push(cx);
    }
  }

  const layout = svgElement.__grandStaffLayout;
  let cursorX = matchedX.length ? Math.min(...matchedX) : null;
  if (cursorX === null && layout) {
    const firstChord = activeEvents.find(e => Number.isInteger(e.chordIndex))?.chordIndex;
    const col = Number.isInteger(firstChord) ? layout.columns.find(c => c.chordIndex === firstChord) : null;
    if (col) cursorX = col.x;
  }

  if (cursorX !== null && playhead) {
    playhead.setAttribute('x1', String(cursorX));
    playhead.setAttribute('x2', String(cursorX));
    playhead.setAttribute('visibility', 'visible');
  }
  if (cursorX !== null && activeBand) {
    activeBand.setAttribute('x', String(cursorX - 16));
    activeBand.setAttribute('visibility', 'visible');
  }
}

/**
 * Emphasize a specific selected theory issue's arc and offending noteheads on the Grand Staff.
 */
export function highlightIssue(svgElement, issue = null) {
  if (!svgElement) return;
  const groups = svgElement.querySelectorAll ? [...svgElement.querySelectorAll('.gs-issue-group')] : [];
  const noteNodes = svgElement.querySelectorAll ? [...svgElement.querySelectorAll('.gs-note')] : [];
  for (const g of groups) g.classList?.remove('gs-issue-focused');
  for (const n of noteNodes) n.classList?.remove('gs-issue-target');

  if (!issue) {
    svgElement.classList?.remove('gs-has-focused-issue');
    return;
  }

  const targetId = typeof issue === 'string' ? issue : issue.id;
  const targetIndex = typeof issue === 'number' ? issue : issue.issueIndex;
  const targetCode = typeof issue === 'object' ? (issue.code ?? issue.type) : null;

  const matchedGroup = groups.find(g => {
    if (targetId !== undefined && g.getAttribute('data-issue-id') === String(targetId)) return true;
    if (targetIndex !== undefined && Number(g.getAttribute('data-issue-index')) === targetIndex) return true;
    if (targetCode && g.getAttribute('data-issue-code') === String(targetCode)) return true;
    return false;
  });

  if (!matchedGroup) {
    svgElement.classList?.remove('gs-has-focused-issue');
    return;
  }

  svgElement.classList?.add('gs-has-focused-issue');
  matchedGroup.classList?.add('gs-issue-focused');

  const halos = matchedGroup.querySelectorAll ? [...matchedGroup.querySelectorAll('.gs-issue-halo')] : [];
  const targetIds = new Set(halos.map(h => h.getAttribute('data-note-id')).filter(Boolean));
  const targetKeys = new Set(halos.filter(h => !h.getAttribute('data-note-id')).map(h => `${h.getAttribute('data-chord-index')}:${h.getAttribute('data-voice')}`));
  for (const node of noteNodes) {
    const noteId = node.getAttribute('data-note-id');
    const key = `${node.getAttribute('data-chord-index')}:${node.getAttribute('data-voice')}`;
    if ((noteId && targetIds.has(noteId)) || targetKeys.has(key)) node.classList?.add('gs-issue-target');
  }
}
