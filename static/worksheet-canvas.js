// Interactive On-Image AP Music Theory Worksheet Annotation & Red-Ink Grading Canvas.
// Zero external dependencies; matches Staff2Audio paper/ink/terracotta/sage aesthetic.
import { parsePitchDisplay } from './grand-staff.js';
import { pitchName } from './note-names.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LETTERS = 'CDEFGAB';
const NATURALS = [0, 2, 4, 5, 7, 9, 11];
const DISPLAY_SIGNS = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };
const ASCII_SIGNS = { '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: '##' };

// Bottom lines: Treble E4 (4*7 + 2 = 30), Bass G2 (2*7 + 4 = 18).
const CLEF_BOTTOM_DIATONIC = Object.freeze({ treble: 30, bass: 18 });
const VOICE_CLEF = Object.freeze({ S: 'treble', A: 'treble', T: 'bass', B: 'bass' });
const VOICE_DEFAULT_STEP = Object.freeze({ S: 6, A: 2, T: 6, B: 2 });
const REVIEW_CONFIDENCE_THRESHOLD = 0.72;

const validKey = value => Number.isInteger(value) && value >= -7 && value <= 7;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function keyAlterations(keySignature = 0) {
  const key = validKey(keySignature) ? keySignature : 0;
  const map = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  const order = key > 0 ? 'FCGDAEB' : 'BEADGCF';
  for (const letter of order.slice(0, Math.abs(key))) map[letter] = Math.sign(key);
  return map;
}

function validateStaffLines(lines) {
  if (!Array.isArray(lines) || lines.length < 5) {
    throw new RangeError('Staff lines must be an array of 5 Y coordinates [y0..y4].');
  }
  const y0 = Number(lines[0]);
  const y4 = Number(lines[4]);
  if (!Number.isFinite(y0) || !Number.isFinite(y4) || y4 <= y0) {
    throw new RangeError('Staff lines must have finite increasing Y coordinates from lines[0] to lines[4].');
  }
  return { top: y0, bottom: y4, space: (y4 - y0) / 4 };
}

function ledgerLinesForStep(staffStep, lines) {
  const { bottom, space } = validateStaffLines(lines);
  const halfSpace = space / 2;
  const ledgers = [];
  if (staffStep >= 10) {
    const topEven = Math.floor(staffStep / 2) * 2;
    for (let step = 10; step <= topEven; step += 2) {
      ledgers.push(bottom - step * halfSpace);
    }
  } else if (staffStep <= -2) {
    const bottomEven = Math.ceil(staffStep / 2) * 2;
    for (let step = -2; step >= bottomEven; step -= 2) {
      ledgers.push(bottom - step * halfSpace);
    }
  }
  return ledgers;
}

function formatAsciiPitch(parsed) {
  return `${parsed.letter}${ASCII_SIGNS[parsed.alteration] ?? ''}${parsed.octave}`;
}

function resolvePitchInput(raw, keySignature = 0) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') return parsePitchDisplay(raw);
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const midi = clamp(Math.round(raw), 0, 127);
    return parsePitchDisplay(pitchName(midi, keySignature));
  }
  if (typeof raw === 'object') {
    if (raw.missing === true && !raw.pitch && !raw.spell && !raw.display && !raw.letter && raw.midi == null) {
      return null;
    }
    if (typeof raw.spell === 'string') {
      const parsed = parsePitchDisplay(raw.spell);
      if (parsed) return parsed;
    }
    if (typeof raw.display === 'string') {
      const parsed = parsePitchDisplay(raw.display);
      if (parsed) return parsed;
    }
    if (typeof raw.pitch === 'string' || (raw.pitch && typeof raw.pitch === 'object')) {
      const parsed = resolvePitchInput(raw.pitch, keySignature);
      if (parsed) return parsed;
    }
    if (typeof raw.letter === 'string' && Number.isInteger(raw.octave)) {
      const parsed = parsePitchDisplay(raw);
      if (parsed) return parsed;
    }
    if (raw.midi !== null && raw.midi !== undefined && Number.isFinite(Number(raw.midi))) {
      const midi = clamp(Math.round(Number(raw.midi)), 0, 127);
      return parsePitchDisplay(pitchName(midi, keySignature));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pure Geometry Exports (unit-testable in Node without DOM)
// ---------------------------------------------------------------------------

/**
 * Compute the integer diatonic staff step from an image Y coordinate and 5 staff line Ys.
 * Step 0 = bottom line (E4 treble / G2 bass); +1 per half-space upward.
 */
export function staffStepFromY(y, lines) {
  const { bottom, space } = validateStaffLines(lines);
  if (!Number.isFinite(Number(y))) {
    throw new RangeError('Y coordinate must be a finite number.');
  }
  const step = Math.round((bottom - Number(y)) / (space / 2));
  return step === 0 ? 0 : step;
}

/**
 * Inverse of staffStepFromY: return the exact image Y coordinate for a staff step.
 */
export function yFromStaffStep(staffStep, lines) {
  const { bottom, space } = validateStaffLines(lines);
  if (!Number.isFinite(Number(staffStep))) {
    throw new RangeError('staffStep must be a finite number.');
  }
  return bottom - Number(staffStep) * (space / 2);
}

/**
 * Snap an image Y coordinate on a detected staff to the nearest diatonic pitch,
 * applying the active key signature alteration by default.
 */
export function pitchFromWorksheetY(y, clef = 'treble', lines, keySignature = 0) {
  const normalizedClef = clef === 'bass' ? 'bass' : 'treble';
  const rawStep = staffStepFromY(y, lines);
  const staffStep = clamp(rawStep, -12, 20);
  const snappedY = yFromStaffStep(staffStep, lines);
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
    y: snappedY,
    midi,
    spell: `${letter}${ASCII_SIGNS[alteration]}${octave}`,
    display: `${letter}${DISPLAY_SIGNS[alteration]}${octave}`,
  };
}

/**
 * Compute the exact staffStep, Y coordinate, and ledger lines for a written pitch on a detected staff.
 */
export function yFromPitchOnStaff(pitch, clef = 'treble', lines) {
  if (!Array.isArray(lines) || lines.length < 5) return null;
  const parsed = resolvePitchInput(pitch, 0);
  if (!parsed) return null;
  const normalizedClef = clef === 'bass' ? 'bass' : 'treble';
  const staffStep = parsed.diatonicStep - CLEF_BOTTOM_DIATONIC[normalizedClef];
  const y = yFromStaffStep(staffStep, lines);
  const ledgerLines = ledgerLinesForStep(staffStep, lines);
  return {
    y,
    staffStep,
    diatonicStep: parsed.diatonicStep,
    ledgerLines,
    letter: parsed.letter,
    octave: parsed.octave,
    alteration: parsed.alteration,
    midi: parsed.midi,
    spell: formatAsciiPitch(parsed),
    display: parsed.display,
  };
}

function normalizeStaffGeometry(rawStaff, fallbackWidth = 1000) {
  if (!rawStaff || !Array.isArray(rawStaff.lines) || rawStaff.lines.length < 5) return null;
  const lines = rawStaff.lines.slice(0, 5).map(Number);
  if (lines.some(v => !Number.isFinite(v)) || lines[4] <= lines[0]) return null;
  const space = Number.isFinite(Number(rawStaff.space)) && Number(rawStaff.space) > 0
    ? Number(rawStaff.space)
    : (lines[4] - lines[0]) / 4;
  const left = Number.isFinite(Number(rawStaff.left)) ? Number(rawStaff.left) : 0;
  const right = Number.isFinite(Number(rawStaff.right)) ? Number(rawStaff.right) : fallbackWidth;
  return { lines, left, right, space, top: lines[0], bottom: lines[4] };
}

function normalizeSystems(systems, width = 1000) {
  if (!Array.isArray(systems)) return [];
  return systems
    .map((sys, idx) => {
      if (!sys || typeof sys !== 'object') return null;
      const treble = normalizeStaffGeometry(sys.treble, width);
      const bass = normalizeStaffGeometry(sys.bass, width);
      if (!treble && !bass) return null;
      const space = treble?.space ?? bass?.space ?? 10;
      const left = Math.min(treble?.left ?? Infinity, bass?.left ?? Infinity);
      const right = Math.max(treble?.right ?? -Infinity, bass?.right ?? -Infinity);
      const top = treble ? treble.top : bass.top;
      const bottom = bass ? bass.bottom : treble.bottom;
      const splitY = treble && bass ? (treble.bottom + bass.top) / 2 : (top + bottom) / 2;
      const barlines = Array.isArray(sys.barlines)
        ? sys.barlines.map(b => (typeof b === 'number' ? b : Number(b?.x))).filter(Number.isFinite).sort((a, b) => a - b)
        : [];
      return {
        index: Number.isInteger(sys.index) ? sys.index : idx,
        treble,
        bass,
        space,
        left: Number.isFinite(left) ? left : 0,
        right: Number.isFinite(right) ? right : width,
        top,
        bottom,
        splitY,
        barlines,
      };
    })
    .filter(Boolean);
}

/**
 * Given image coordinates (x, y) and detected grand-staff systems, identify the matching
 * system and staff ('treble' or 'bass'), splitting cleanly at the treble/bass midpoint.
 */
export function findSystemAndStaffAtPoint(x, y, systems) {
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Array.isArray(systems) || !systems.length) {
    return null;
  }
  const normalized = normalizeSystems(systems);
  if (!normalized.length) return null;

  const sorted = [...normalized].sort((a, b) => a.top - b.top);
  for (let i = 0; i < sorted.length; i++) {
    const sys = sorted[i];
    const prev = i > 0 ? sorted[i - 1] : null;
    const next = i + 1 < sorted.length ? sorted[i + 1] : null;

    const outerPadY = Math.max(24, sys.space * 4.5);
    const minY = prev ? (prev.bottom + sys.top) / 2 : sys.top - outerPadY;
    const maxY = next ? (sys.bottom + next.top) / 2 : sys.bottom + outerPadY;

    if (py < minY || py > maxY) continue;

    // Check horizontal bounds if explicit left/right were provided on the source system.
    const rawSys = systems.find((s, idx) => (Number.isInteger(s?.index) ? s.index : idx) === sys.index);
    const hasExplicitX = Number.isFinite(Number(rawSys?.treble?.left)) || Number.isFinite(Number(rawSys?.bass?.left))
      || Number.isFinite(Number(rawSys?.treble?.right)) || Number.isFinite(Number(rawSys?.bass?.right));
    if (hasExplicitX) {
      const padX = Math.max(10, sys.space * 1.4);
      if (px < sys.left - padX || px > sys.right + padX) continue;
    }

    if (sys.treble && sys.bass) {
      const staff = py <= sys.splitY ? 'treble' : 'bass';
      const target = staff === 'treble' ? sys.treble : sys.bass;
      return {
        systemIndex: sys.index,
        staff,
        lines: target.lines,
        space: target.space,
      };
    }
    const staff = sys.treble ? 'treble' : 'bass';
    const target = sys.treble || sys.bass;
    return {
      systemIndex: sys.index,
      staff,
      lines: target.lines,
      space: target.space,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Overlay Layout Engine (Four-Part SATB & Melody Harmonization)
// ---------------------------------------------------------------------------

function normalizeFigureText(raw) {
  if (raw === null || raw === undefined) return '';
  if (Array.isArray(raw)) return raw.map(v => String(v).trim()).filter(Boolean).join('/');
  return String(raw).trim();
}

function normalizeIssueSpec(issue, index) {
  if (!issue || typeof issue !== 'object') return null;
  const severity = issue.severity === 'warning' || issue.severity === 'info' ? issue.severity : 'error';
  let chordIndices = [];
  if (Array.isArray(issue.chordIndices)) {
    chordIndices = issue.chordIndices.filter(Number.isInteger);
  } else if (Array.isArray(issue.chords)) {
    chordIndices = issue.chords.filter(Number.isInteger);
  } else if (Number.isInteger(issue.fromChord) && Number.isInteger(issue.toChord)) {
    chordIndices = [issue.fromChord, issue.toChord];
  } else if (Number.isInteger(issue.previous_chord_index) && Number.isInteger(issue.chord_index)) {
    chordIndices = [issue.previous_chord_index, issue.chord_index];
  } else if (Number.isInteger(issue.chordIndex)) {
    chordIndices = [issue.chordIndex];
  } else if (Number.isInteger(issue.chord_index)) {
    chordIndices = [issue.chord_index];
  }

  const voices = Array.isArray(issue.voices)
    ? issue.voices.filter(v => ['S', 'A', 'T', 'B'].includes(v))
    : typeof issue.voice === 'string' && ['S', 'A', 'T', 'B'].includes(issue.voice)
      ? [issue.voice]
      : [];

  const noteIndex = Number.isInteger(issue.noteIndex)
    ? issue.noteIndex
    : Number.isInteger(issue.note_index)
      ? issue.note_index
      : null;

  const explicitNotes = Array.isArray(issue.notes) ? issue.notes : null;
  const explicitNoteIds = [];
  if (Array.isArray(issue.explicitNoteIds)) {
    for (const id of issue.explicitNoteIds) {
      if (typeof id === 'string' && id) explicitNoteIds.push(id);
    }
  }
  if (noteIndex !== null && !explicitNoteIds.includes(`melody-${noteIndex}`)) {
    explicitNoteIds.push(`melody-${noteIndex}`);
  }

  return {
    id: issue.id ?? `issue-${index}`,
    issueIndex: Number.isInteger(issue.issueIndex) ? issue.issueIndex : index,
    code: issue.code ?? issue.rule_id ?? issue.type ?? '',
    severity,
    message: issue.message ?? issue.title ?? '',
    chordIndices,
    voices,
    noteIndex,
    explicitNotes,
    explicitNoteIds,
  };
}

function extractVoiceCoord(rawVoice, voiceCoords, voice) {
  const vc = voiceCoords?.[voice];
  if (Array.isArray(vc) && vc.length >= 2) {
    return { x: Number(vc[0]), y: Number(vc[1]) };
  }
  if (vc && typeof vc === 'object') {
    return vc;
  }
  if (rawVoice && typeof rawVoice === 'object') {
    return rawVoice;
  }
  return null;
}

function findSystemForItem(rawSystemIndex, x, y, systems) {
  if (!systems.length) return null;
  if (Number.isInteger(rawSystemIndex)) {
    const byIndex = systems.find(s => s.index === rawSystemIndex);
    if (byIndex) return byIndex;
    if (systems[rawSystemIndex]) return systems[rawSystemIndex];
  }
  if (Number.isFinite(x) && Number.isFinite(y)) {
    const hit = findSystemAndStaffAtPoint(x, y, systems);
    if (hit) {
      const matched = systems.find(s => s.index === hit.systemIndex);
      if (matched) return matched;
    }
  }
  return systems[0];
}

function isSelectionMatch(selection, marker) {
  if (!selection || typeof selection !== 'object') return false;
  if (selection.noteId && String(selection.noteId) === String(marker.noteId)) return true;
  if (Number.isInteger(selection.noteIndex) && marker.noteIndex !== null && marker.noteIndex === selection.noteIndex) {
    if (!selection.voice || selection.voice === marker.voice) return true;
  }
  if (Number.isInteger(selection.chordIndex) && selection.chordIndex === marker.chordIndex) {
    if (!selection.voice || selection.voice === marker.voice) return true;
  }
  return false;
}

/**
 * Pure layout computation for on-image worksheet overlays (both 'four-part' and 'melody' modes).
 * Computes exact marker positions snapped to detected staff lines, editable Roman/figure pills,
 * FRQ 7 given-region dividers, red-ink grading arcs/halos, NCT tags, and cadence badges.
 */
export function computeWorksheetOverlayLayout(model = {}) {
  const mode = model.mode === 'melody' || model.mode === 'melody-harmonize' ? 'melody' : 'four-part';
  const rawKey = model.keySignature ?? model.key_signature ?? model.key?.fifths ?? 0;
  const keySignature = validKey(rawKey) ? rawKey : 0;

  const rawSystems = Array.isArray(model.systems) ? model.systems : [];
  const inferredWidth = rawSystems.reduce((max, s) => Math.max(max, Number(s?.treble?.right) || 0, Number(s?.bass?.right) || 0), 0);
  const inferredHeight = rawSystems.reduce((max, s) => {
    const bl = s?.bass?.lines?.[4] ?? s?.treble?.lines?.[4] ?? 0;
    return Math.max(max, Number(bl) + 80);
  }, 0);

  const width = Number.isFinite(Number(model.width)) && Number(model.width) > 0
    ? Number(model.width)
    : Math.max(600, Math.ceil(inferredWidth + 40));
  const height = Number.isFinite(Number(model.height)) && Number(model.height) > 0
    ? Number(model.height)
    : Math.max(300, Math.ceil(inferredHeight + 40));

  const systems = normalizeSystems(rawSystems, width);
  const selection = model.selection || null;
  const markers = [];
  const columnMeta = [];
  const nctBadges = [];
  const timedItems = []; // For givenRegion & cadence anchoring

  if (mode === 'four-part') {
    const chords = Array.isArray(model.chords) ? model.chords : [];
    let beatCursor = 0;

    chords.forEach((chord, idx) => {
      if (!chord || typeof chord !== 'object') return;
      const chordIndex = Number.isInteger(chord.index) ? chord.index : idx;
      const duration = Number.isFinite(Number(chord.duration)) && Number(chord.duration) > 0 ? Number(chord.duration) : 1;
      const onset = Number.isFinite(Number(chord.onset)) && Number(chord.onset) >= 0 ? Number(chord.onset) : beatCursor;
      beatCursor = Math.max(beatCursor, onset + duration);

      const voiceMap = chord.voices && typeof chord.voices === 'object' ? chord.voices : chord;
      const voiceCoords = chord.voice_coords || chord.voiceCoords || {};
      const chordX = Number.isFinite(Number(chord.x)) ? Number(chord.x) : null;

      // Determine the system for this chord
      const sampleCoord = ['S', 'A', 'T', 'B']
        .map(v => extractVoiceCoord(voiceMap[v], voiceCoords, v))
        .find(c => c && Number.isFinite(Number(c.y)));
      const sys = findSystemForItem(
        chord.system_index ?? chord.systemIndex,
        chordX ?? (sampleCoord ? Number(sampleCoord.x) : NaN),
        sampleCoord ? Number(sampleCoord.y) : NaN,
        systems,
      );
      const systemIndex = sys ? sys.index : (Number.isInteger(chord.system_index) ? chord.system_index : 0);
      const fallbackX = sys
        ? sys.left + ((idx + 1) / (chords.length + 1)) * Math.max(80, sys.right - sys.left)
        : 100 + idx * 80;

      let bassMarkerY = null;
      const chordMarkerXs = [];

      for (const voice of ['S', 'A', 'T', 'B']) {
        const hasVoiceKey = Object.prototype.hasOwnProperty.call(voiceMap, voice);
        const hasCoordKey = Boolean(voiceCoords && Object.prototype.hasOwnProperty.call(voiceCoords, voice));
        if (!hasVoiceKey && !hasCoordKey) continue;

        const rawVoice = voiceMap[voice];
        const coord = extractVoiceCoord(rawVoice, voiceCoords, voice);
        const clef = VOICE_CLEF[voice];
        const staffObj = sys ? (clef === 'bass' ? sys.bass : sys.treble) : null;
        const space = staffObj?.space ?? sys?.space ?? 10;
        const parsed = resolvePitchInput(rawVoice, keySignature);
        const missing = !parsed || Boolean(rawVoice?.missing) || Boolean(coord?.missing);

        const x = Number.isFinite(Number(coord?.x))
          ? Number(coord.x)
          : chordX !== null
            ? chordX
            : fallbackX;

        let y;
        let staffStep = null;
        let ledgerLines = [];
        if (parsed && staffObj?.lines) {
          const snapped = yFromPitchOnStaff(parsed, clef, staffObj.lines);
          y = snapped.y;
          staffStep = snapped.staffStep;
          ledgerLines = snapped.ledgerLines;
        } else if (Number.isFinite(Number(coord?.y))) {
          y = Number(coord.y);
          if (staffObj?.lines) staffStep = staffStepFromY(y, staffObj.lines);
        } else if (staffObj?.lines) {
          staffStep = VOICE_DEFAULT_STEP[voice];
          y = yFromStaffStep(staffStep, staffObj.lines);
        } else {
          y = clef === 'bass' ? height * 0.65 : height * 0.35;
        }

        const source = rawVoice?.source ?? coord?.source ?? chord.source ?? (missing ? 'manual' : 'printed');
        const rawConf = rawVoice?.confidence ?? coord?.confidence ?? chord.confidence;
        const confidence = Number.isFinite(Number(rawConf)) ? Number(rawConf) : (missing ? 0 : 1);
        const needsReview = Boolean(missing || confidence < REVIEW_CONFIDENCE_THRESHOLD);
        const noteId = rawVoice?.id ?? `note-${chordIndex}-${voice}`;
        const nctLabel = typeof rawVoice?.nct === 'string'
          ? rawVoice.nct
          : rawVoice?.nct?.label ?? rawVoice?.nct?.type ?? null;

        const marker = {
          noteId,
          chordIndex,
          noteIndex: null,
          voice,
          clef,
          staff: clef,
          systemIndex,
          onset,
          duration,
          x,
          y,
          radius: Number(Math.max(4.5, space * 0.48).toFixed(2)),
          space,
          letter: parsed?.letter ?? null,
          octave: parsed?.octave ?? null,
          alteration: parsed?.alteration ?? null,
          staffStep,
          ledgerLines,
          midi: parsed?.midi ?? null,
          spell: parsed ? formatAsciiPitch(parsed) : null,
          display: parsed ? parsed.display : '?',
          source,
          confidence,
          missing,
          needsReview,
          selected: false,
          nct: nctLabel,
        };
        marker.selected = isSelectionMatch(selection, marker);
        markers.push(marker);
        chordMarkerXs.push(x);
        if (voice === 'B') bassMarkerY = y;
      }

      const metaX = chordX !== null
        ? chordX
        : chordMarkerXs.length
          ? chordMarkerXs.reduce((a, b) => a + b, 0) / chordMarkerXs.length
          : fallbackX;
      const bassStaff = sys?.bass || sys?.treble;
      const space = bassStaff?.space ?? sys?.space ?? 10;
      const bassBottom = bassStaff ? bassStaff.bottom : height * 0.72;
      const defaultFigureY = Math.max(bassBottom + space * 1.9, (bassMarkerY ?? bassBottom) + space * 1.4);
      const figureY = Number.isFinite(Number(chord.figure_y ?? chord.figureY))
        ? Math.min(height - 22, Number(chord.figure_y ?? chord.figureY))
        : Math.min(height - 26, defaultFigureY);
      const romanY = Number.isFinite(Number(chord.roman_y ?? chord.romanY))
        ? Math.min(height - 10, Number(chord.roman_y ?? chord.romanY))
        : Math.min(height - 10, figureY + space * 1.75);

      const roman = String(chord.roman ?? chord.label ?? '').trim();
      const figure = normalizeFigureText(chord.figure ?? chord.figures ?? chord.figuredBass);

      columnMeta.push({
        chordIndex,
        systemIndex,
        onset,
        duration,
        x: metaX,
        y: romanY,
        romanY,
        figureY,
        roman,
        figure,
        space,
        cadence: chord.cadence ?? null,
      });

      timedItems.push({ onset, duration, x: metaX, systemIndex, chordIndex });
    });
  } else {
    // Melody harmonization mode (FRQ 7)
    const melody = Array.isArray(model.melody) ? model.melody : [];
    const harmonization = Array.isArray(model.harmonization) ? model.harmonization : [];

    // First lay out harmonization slots so melody notes can inherit matching chordIndex
    let hCursor = 0;
    const normalizedSlots = [];
    harmonization.forEach((slot, idx) => {
      if (!slot || typeof slot !== 'object') return;
      const chordIndex = Number.isInteger(slot.index)
        ? slot.index
        : Number.isInteger(slot.chordIndex)
          ? slot.chordIndex
          : idx;
      const duration = Number.isFinite(Number(slot.duration)) && Number(slot.duration) > 0 ? Number(slot.duration) : 1;
      const onset = Number.isFinite(Number(slot.onset)) && Number(slot.onset) >= 0 ? Number(slot.onset) : hCursor;
      hCursor = Math.max(hCursor, onset + duration);

      const rawX = Number.isFinite(Number(slot.x)) ? Number(slot.x) : null;
      const rawY = Number.isFinite(Number(slot.y)) ? Number(slot.y) : null;
      const sys = findSystemForItem(slot.system_index ?? slot.systemIndex, rawX ?? NaN, rawY ?? NaN, systems);
      const systemIndex = sys ? sys.index : (Number.isInteger(slot.system_index) ? slot.system_index : 0);
      const bassStaff = sys?.bass || sys?.treble;
      const space = bassStaff?.space ?? sys?.space ?? 10;
      const x = rawX !== null
        ? rawX
        : sys
          ? sys.left + ((idx + 1) / (harmonization.length + 1)) * Math.max(80, sys.right - sys.left)
          : 100 + idx * 80;

      const bassRaw = slot.bass ?? slot.voices?.B ?? (slot.pitch !== undefined ? slot.pitch : null);
      const parsed = resolvePitchInput(bassRaw, keySignature);
      const missing = !parsed || Boolean(slot.missing) || Boolean(bassRaw?.missing);

      let y;
      let staffStep = null;
      let ledgerLines = [];
      if (parsed && bassStaff?.lines) {
        const snapped = yFromPitchOnStaff(parsed, 'bass', bassStaff.lines);
        y = snapped.y;
        staffStep = snapped.staffStep;
        ledgerLines = snapped.ledgerLines;
      } else if (rawY !== null) {
        y = rawY;
        if (bassStaff?.lines) staffStep = staffStepFromY(y, bassStaff.lines);
      } else if (bassStaff?.lines) {
        staffStep = VOICE_DEFAULT_STEP.B;
        y = yFromStaffStep(staffStep, bassStaff.lines);
      } else {
        y = height * 0.68;
      }

      const source = bassRaw?.source ?? slot.source ?? (missing ? 'manual' : 'handwritten');
      const rawConf = bassRaw?.confidence ?? slot.confidence;
      const confidence = Number.isFinite(Number(rawConf)) ? Number(rawConf) : (missing ? 0 : 1);
      const needsReview = Boolean(missing || confidence < REVIEW_CONFIDENCE_THRESHOLD);
      const noteId = bassRaw?.id ?? slot.id ?? `bass-${chordIndex}`;

      const bassMarker = {
        noteId,
        chordIndex,
        noteIndex: null,
        voice: 'B',
        clef: 'bass',
        staff: 'bass',
        systemIndex,
        onset,
        duration,
        x,
        y,
        radius: Number(Math.max(4.5, space * 0.48).toFixed(2)),
        space,
        letter: parsed?.letter ?? null,
        octave: parsed?.octave ?? null,
        alteration: parsed?.alteration ?? null,
        staffStep,
        ledgerLines,
        midi: parsed?.midi ?? null,
        spell: parsed ? formatAsciiPitch(parsed) : null,
        display: parsed ? parsed.display : '?',
        source,
        confidence,
        missing,
        needsReview,
        selected: false,
        nct: null,
      };
      bassMarker.selected = isSelectionMatch(selection, bassMarker);
      markers.push(bassMarker);

      const bassBottom = bassStaff ? bassStaff.bottom : height * 0.72;
      const defaultFigureY = Math.max(bassBottom + space * 1.9, y + space * 1.4);
      const figureY = Number.isFinite(Number(slot.figure_y ?? slot.figureY))
        ? Number(slot.figure_y ?? slot.figureY)
        : Math.min(height - 26, defaultFigureY);
      const roman = String(slot.roman ?? slot.label ?? '').trim();
      const figure = normalizeFigureText(slot.figure ?? slot.figures ?? slot.figuredBass);
      const romanY = Number.isFinite(Number(slot.roman_y ?? slot.romanY))
        ? Number(slot.roman_y ?? slot.romanY)
        : Math.min(height - 10, figure ? figureY + space * 1.7 : defaultFigureY);

      columnMeta.push({
        chordIndex,
        systemIndex,
        onset,
        duration,
        x,
        y: romanY,
        romanY,
        figureY,
        roman,
        figure,
        space,
        cadence: slot.cadence ?? null,
      });

      normalizedSlots.push({ chordIndex, onset, duration, x, systemIndex });
      timedItems.push({ onset, duration, x, systemIndex, chordIndex });
    });

    // Lay out melody (Soprano) notes
    let mCursor = 0;
    melody.forEach((item, idx) => {
      if (!item || typeof item !== 'object') return;
      const noteIndex = Number.isInteger(item.index) ? item.index : idx;
      const duration = Number.isFinite(Number(item.duration)) && Number(item.duration) > 0 ? Number(item.duration) : 1;
      const onset = Number.isFinite(Number(item.onset)) && Number(item.onset) >= 0 ? Number(item.onset) : mCursor;
      mCursor = Math.max(mCursor, onset + duration);

      const rawX = Number.isFinite(Number(item.x)) ? Number(item.x) : null;
      const rawY = Number.isFinite(Number(item.y)) ? Number(item.y) : null;
      const sys = findSystemForItem(item.system_index ?? item.systemIndex, rawX ?? NaN, rawY ?? NaN, systems);
      const systemIndex = sys ? sys.index : (Number.isInteger(item.system_index) ? item.system_index : 0);
      const trebleStaff = sys?.treble || sys?.bass;
      const space = trebleStaff?.space ?? sys?.space ?? 10;
      const x = rawX !== null
        ? rawX
        : sys
          ? sys.left + ((idx + 1) / (melody.length + 1)) * Math.max(80, sys.right - sys.left)
          : 100 + idx * 70;

      const parsed = resolvePitchInput(item, keySignature);
      const missing = !parsed || Boolean(item.missing);

      let y;
      let staffStep = null;
      let ledgerLines = [];
      if (parsed && trebleStaff?.lines) {
        const snapped = yFromPitchOnStaff(parsed, 'treble', trebleStaff.lines);
        y = snapped.y;
        staffStep = snapped.staffStep;
        ledgerLines = snapped.ledgerLines;
      } else if (rawY !== null) {
        y = rawY;
        if (trebleStaff?.lines) staffStep = staffStepFromY(y, trebleStaff.lines);
      } else if (trebleStaff?.lines) {
        staffStep = VOICE_DEFAULT_STEP.S;
        y = yFromStaffStep(staffStep, trebleStaff.lines);
      } else {
        y = height * 0.3;
      }

      let chordIndex = Number.isInteger(item.chordIndex) ? item.chordIndex : null;
      if (chordIndex === null) {
        const matchSlot = normalizedSlots.find(s => onset >= s.onset - 1e-6 && onset < s.onset + s.duration - 1e-6);
        chordIndex = matchSlot ? matchSlot.chordIndex : noteIndex;
      }

      const source = item.source ?? 'printed';
      const confidence = Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : (missing ? 0 : 1);
      const needsReview = Boolean(missing || confidence < REVIEW_CONFIDENCE_THRESHOLD);
      const noteId = item.id ?? `melody-${noteIndex}`;
      const nctLabel = typeof item.nct === 'string'
        ? item.nct.trim() || null
        : item.nct?.label ?? item.nct?.type ?? null;

      const marker = {
        noteId,
        chordIndex,
        noteIndex,
        voice: 'S',
        clef: 'treble',
        staff: 'treble',
        systemIndex,
        onset,
        duration,
        x,
        y,
        radius: Number(Math.max(4.5, space * 0.48).toFixed(2)),
        space,
        letter: parsed?.letter ?? null,
        octave: parsed?.octave ?? null,
        alteration: parsed?.alteration ?? null,
        staffStep,
        ledgerLines,
        midi: parsed?.midi ?? null,
        spell: parsed ? formatAsciiPitch(parsed) : null,
        display: parsed ? parsed.display : '?',
        source,
        confidence,
        missing,
        needsReview,
        selected: false,
        nct: nctLabel,
      };
      marker.selected = isSelectionMatch(selection, marker);
      markers.push(marker);

      if (nctLabel) {
        const trebleTop = trebleStaff ? trebleStaff.top : y;
        nctBadges.push({
          noteId,
          chordIndex,
          noteIndex,
          systemIndex,
          x,
          y: Math.max(12, Math.min(trebleTop - space * 1.15, y - marker.radius - space * 1.15)),
          label: String(nctLabel),
          space,
        });
      }

      timedItems.push({ onset, duration, x, systemIndex, chordIndex });
    });
  }

  // Given / Reference region before gradeFromOnset (FRQ 7 printed opening measures).
  const gradeFromOnset = Number(model.gradeFromOnset ?? model.grade_from_onset ?? 0);
  let givenRegion = null;
  if (Number.isFinite(gradeFromOnset) && gradeFromOnset > 0 && systems.length) {
    const rects = [];
    let divider = null;
    const sortedSystems = [...systems].sort((a, b) => a.top - b.top);

    for (const sys of sortedSystems) {
      const sysItems = timedItems.filter(it => it.systemIndex === sys.index);
      const givenItems = sysItems.filter(it => it.onset < gradeFromOnset - 1e-6);
      const gradedItems = sysItems.filter(it => it.onset >= gradeFromOnset - 1e-6);

      const topY = Math.max(4, sys.top - sys.space * 1.6);
      const bottomY = Math.min(height - 4, sys.bottom + sys.space * 1.6);

      if (givenItems.length && gradedItems.length) {
        const lastGivenX = Math.max(...givenItems.map(it => it.x));
        const firstGradedX = Math.min(...gradedItems.map(it => it.x));
        const barBetween = sys.barlines.find(bx => bx > lastGivenX && bx < firstGradedX);
        const boundaryX = Number.isFinite(barBetween)
          ? barBetween
          : (lastGivenX + firstGradedX) / 2;

        const rectW = Math.max(0, boundaryX - sys.left);
        if (rectW > 0) {
          rects.push({
            x: sys.left,
            y: topY,
            width: rectW,
            height: bottomY - topY,
            systemIndex: sys.index,
          });
        }
        divider = {
          x: boundaryX,
          y1: topY,
          y2: bottomY,
          systemIndex: sys.index,
          label: 'Grade starts here →',
        };
      } else if (givenItems.length && !gradedItems.length) {
        const rectW = Math.max(0, sys.right - sys.left);
        if (rectW > 0) {
          rects.push({
            x: sys.left,
            y: topY,
            width: rectW,
            height: bottomY - topY,
            systemIndex: sys.index,
          });
        }
      } else if (!givenItems.length && gradedItems.length && !divider && rects.length) {
        const firstGradedX = Math.min(...gradedItems.map(it => it.x));
        const boundaryX = Math.max(sys.left, firstGradedX - sys.space * 1.8);
        divider = {
          x: boundaryX,
          y1: topY,
          y2: bottomY,
          systemIndex: sys.index,
          label: 'Grade starts here →',
        };
      }
    }

    if (!divider && sortedSystems.length && timedItems.length) {
      const firstGraded = timedItems
        .filter(it => it.onset >= gradeFromOnset - 1e-6)
        .sort((a, b) => a.onset - b.onset)[0];
      if (firstGraded) {
        const sys = systems.find(s => s.index === firstGraded.systemIndex) || sortedSystems[0];
        const topY = Math.max(4, sys.top - sys.space * 1.6);
        const bottomY = Math.min(height - 4, sys.bottom + sys.space * 1.6);
        const boundaryX = Math.max(sys.left, firstGraded.x - sys.space * 1.8);
        if (boundaryX > sys.left) {
          rects.push({
            x: sys.left,
            y: topY,
            width: boundaryX - sys.left,
            height: bottomY - topY,
            systemIndex: sys.index,
          });
        }
        divider = {
          x: boundaryX,
          y1: topY,
          y2: bottomY,
          systemIndex: sys.index,
          label: 'Grade starts here →',
        };
      }
    }

    if (rects.length || divider) {
      givenRegion = { gradeFromOnset, rects, divider };
    }
  }

  // Cadence badges positioned at phrase endings.
  const cadenceBadges = [];
  const rawPhrases = Array.isArray(model.phrases) ? model.phrases : [];
  if (rawPhrases.length) {
    rawPhrases.forEach((phrase, idx) => {
      if (!phrase || typeof phrase !== 'object') return;
      const rawCadence = String(phrase.cadence ?? phrase.actual_cadence ?? phrase.expected_cadence ?? '').trim();
      if (!rawCadence) return;

      const endOnset = Number.isFinite(Number(phrase.end_onset ?? phrase.endOnset ?? phrase.endBeat))
        ? Number(phrase.end_onset ?? phrase.endOnset ?? phrase.endBeat)
        : null;
      const endIndex = Number.isInteger(phrase.endIndex ?? phrase.end_index)
        ? Number(phrase.endIndex ?? phrase.end_index)
        : null;

      let anchor = null;
      if (endIndex !== null) {
        anchor = columnMeta.find(c => c.chordIndex === endIndex) || timedItems[endIndex] || null;
      }
      if (!anchor && endOnset !== null) {
        // Prefer exact onset match, otherwise closest item <= endOnset
        anchor = [...timedItems]
          .filter(it => it.onset <= endOnset + 1e-4)
          .sort((a, b) => Math.abs(a.onset - endOnset) - Math.abs(b.onset - endOnset))[0]
          || timedItems[timedItems.length - 1]
          || null;
      }
      if (!anchor) anchor = timedItems[timedItems.length - 1] || null;
      if (!anchor) return;

      const sys = systems.find(s => s.index === anchor.systemIndex) || systems[0];
      const space = sys?.space ?? 10;
      const topY = sys ? sys.top : height * 0.2;
      const hasGradedVerdict = typeof phrase.passed === 'boolean' || typeof phrase.valid === 'boolean';
      const hasActualCadence = Boolean(phrase.cadence || phrase.actual_cadence);
      const passed = typeof phrase.passed === 'boolean'
        ? phrase.passed
        : typeof phrase.valid === 'boolean'
          ? phrase.valid
          : (hasActualCadence ? true : null);
      const hasMark = /[✓✕✗✔✘]/.test(rawCadence);
      const label = hasMark
        ? rawCadence
        : (hasGradedVerdict || hasActualCadence)
          ? `${rawCadence} ${passed ? '✓' : '✕'}`
          : rawCadence;

      cadenceBadges.push({
        id: phrase.id ?? `cadence-${idx}`,
        name: phrase.name ?? phrase.label ?? `Phrase ${idx + 1}`,
        cadence: rawCadence,
        passed,
        label,
        x: anchor.x,
        y: Math.max(14, topY - space * 2.2),
        systemIndex: anchor.systemIndex,
        endOnset,
      });
    });
  } else {
    columnMeta.forEach((col, idx) => {
      if (!col.cadence) return;
      const sys = systems.find(s => s.index === col.systemIndex) || systems[0];
      const space = sys?.space ?? 10;
      const topY = sys ? sys.top : height * 0.2;
      const rawCadence = typeof col.cadence === 'string' ? col.cadence : col.cadence.type ?? col.cadence.label ?? '';
      if (!rawCadence) return;
      const passed = typeof col.cadence === 'object' && typeof col.cadence.passed === 'boolean'
        ? col.cadence.passed
        : typeof col.cadence === 'object' && typeof col.cadence.valid === 'boolean'
          ? col.cadence.valid
          : true;
      const hasMark = /[✓✕✗✔✘]/.test(rawCadence);
      cadenceBadges.push({
        id: `cadence-${idx}`,
        name: `Phrase ${idx + 1}`,
        cadence: rawCadence,
        passed,
        label: hasMark ? rawCadence : `${rawCadence} ${passed ? '✓' : '✕'}`,
        x: col.x,
        y: Math.max(14, topY - space * 2.2),
        systemIndex: col.systemIndex,
        endOnset: col.onset,
      });
    });
  }

  // Red-ink grading issue overlays (curved dashed arcs & halos on exact marker coordinates).
  const markerById = new Map();
  const markerByChordVoice = new Map();
  for (const m of markers) {
    if (m.noteId) markerById.set(String(m.noteId), m);
    const cvKey = `${m.chordIndex}:${m.voice}`;
    if (!markerByChordVoice.has(cvKey)) markerByChordVoice.set(cvKey, m);
  }

  const issueOverlays = [];
  const rawIssues = Array.isArray(model.issues) ? model.issues : [];
  rawIssues.forEach((rawIssue, idx) => {
    const spec = normalizeIssueSpec(rawIssue, idx);
    if (!spec) return;

    const halos = [];
    const arcs = [];
    const seenHalos = new Set();

    const addHalo = marker => {
      if (!marker) return;
      const key = marker.noteId ? `id:${marker.noteId}` : `${marker.chordIndex}:${marker.voice}`;
      if (seenHalos.has(key)) return;
      seenHalos.add(key);
      halos.push({
        x: marker.x,
        y: marker.y,
        radius: Number((marker.radius + Math.max(4, marker.space * 0.38)).toFixed(2)),
        noteId: marker.noteId,
        chordIndex: marker.chordIndex,
        voice: marker.voice,
        systemIndex: marker.systemIndex,
      });
    };

    const explicitMatched = [];
    for (const id of spec.explicitNoteIds) {
      const m = markerById.get(String(id));
      if (m) {
        addHalo(m);
        explicitMatched.push(m);
      }
    }
    if (spec.explicitNotes && spec.explicitNotes.length) {
      for (const ref of spec.explicitNotes) {
        const m = markerByChordVoice.get(`${ref.chordIndex}:${ref.voice}`);
        if (m) {
          addHalo(m);
          explicitMatched.push(m);
        }
      }
    }

    if (spec.chordIndices.length >= 2 && spec.voices.length >= 1) {
      const [fromChord, toChord] = spec.chordIndices;
      for (const voice of spec.voices) {
        const m1 = markerByChordVoice.get(`${fromChord}:${voice}`);
        const m2 = markerByChordVoice.get(`${toChord}:${voice}`);
        if (m1) addHalo(m1);
        if (m2) addHalo(m2);
        if (m1 && m2) {
          const bowUp = voice === 'S' || voice === 'T';
          const dist = Math.hypot(m2.x - m1.x, m2.y - m1.y);
          const bow = (bowUp ? -1 : 1) * Math.max(16, Math.min(36, dist * 0.22));
          const cx = (m1.x + m2.x) / 2;
          const cy = (m1.y + m2.y) / 2 + bow;
          arcs.push({
            fromChord,
            toChord,
            voice,
            x1: m1.x,
            y1: m1.y,
            x2: m2.x,
            y2: m2.y,
            cx,
            cy,
            path: `M ${m1.x.toFixed(1)} ${m1.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${m2.x.toFixed(1)} ${m2.y.toFixed(1)}`,
          });
        }
      }
    } else if (spec.chordIndices.length === 1) {
      const chordIdx = spec.chordIndices[0];
      if (!halos.length) {
        const targetVoices = spec.voices.length ? spec.voices : ['S', 'A', 'T', 'B'];
        const found = targetVoices.map(v => markerByChordVoice.get(`${chordIdx}:${v}`)).filter(Boolean);
        found.forEach(addHalo);
        if (found.length === 2) {
          const [m1, m2] = found;
          const space = Math.max(m1.space, m2.space, 10);
          const cx = Math.max(m1.x, m2.x) + Math.max(18, space * 1.8);
          const cy = (m1.y + m2.y) / 2;
          arcs.push({
            fromChord: chordIdx,
            toChord: chordIdx,
            voice: `${m1.voice}-${m2.voice}`,
            x1: m1.x,
            y1: m1.y,
            x2: m2.x,
            y2: m2.y,
            cx,
            cy,
            path: `M ${m1.x.toFixed(1)} ${m1.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${m2.x.toFixed(1)} ${m2.y.toFixed(1)}`,
          });
        }
      } else if (explicitMatched.length === 1 && spec.voices.includes('B')) {
        // Melody-bass clash: connect explicit melody note to the accompanying bass note in this chord.
        const m1 = explicitMatched[0];
        const bassMarker = markerByChordVoice.get(`${chordIdx}:B`);
        if (bassMarker && bassMarker !== m1) {
          addHalo(bassMarker);
          const space = Math.max(m1.space, bassMarker.space, 10);
          const cx = Math.max(m1.x, bassMarker.x) + Math.max(18, space * 1.8);
          const cy = (m1.y + bassMarker.y) / 2;
          arcs.push({
            fromChord: chordIdx,
            toChord: chordIdx,
            voice: `${m1.voice}-${bassMarker.voice}`,
            x1: m1.x,
            y1: m1.y,
            x2: bassMarker.x,
            y2: bassMarker.y,
            cx,
            cy,
            path: `M ${m1.x.toFixed(1)} ${m1.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${bassMarker.x.toFixed(1)} ${bassMarker.y.toFixed(1)}`,
          });
        }
      }
    }

    if (halos.length || arcs.length) {
      issueOverlays.push({
        id: spec.id,
        issueIndex: spec.issueIndex,
        code: spec.code,
        severity: spec.severity,
        message: spec.message,
        chordIndices: spec.chordIndices,
        voices: spec.voices,
        noteIndex: spec.noteIndex,
        halos,
        arcs,
      });
    }
  });

  return {
    mode,
    width,
    height,
    preview: model.preview ?? null,
    keySignature,
    systems,
    markers,
    columnMeta,
    givenRegion,
    issueOverlays,
    nctBadges,
    cadenceBadges,
  };
}

// ---------------------------------------------------------------------------
// SVG DOM Helpers & Embedded Styles
// ---------------------------------------------------------------------------

function svgEl(doc, tag, attrs = {}, text = null) {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  if (text !== null) node.textContent = text;
  return node;
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

function embeddedWorksheetStyles() {
  return `
    .ws-svg { font-family: "Segoe UI", Arial, sans-serif; user-select: none; overflow: visible; touch-action: none; }
    .ws-backdrop { fill: var(--paper, #f6f4ef); }
    .ws-given-rect { fill: rgba(77, 104, 87, 0.085); stroke: rgba(77, 104, 87, 0.25); stroke-width: 1; pointer-events: none; }
    .ws-grade-divider { stroke: var(--green, #4d6857); stroke-width: 2; stroke-dasharray: 6 4; pointer-events: none; }
    .ws-grade-divider-bg { fill: #eef3ee; stroke: var(--green, #4d6857); stroke-width: 1.1; }
    .ws-grade-divider-label { font-size: 10.5px; font-weight: 700; fill: var(--green, #4d6857); text-anchor: start; dominant-baseline: central; pointer-events: none; }
    .ws-staff-band { fill: transparent; cursor: crosshair; transition: fill 0.12s ease; }
    .ws-staff-band:hover { fill: rgba(165, 72, 50, 0.045); }
    .ws-hover-preview { pointer-events: none; }
    .ws-hover-notehead { fill: rgba(165, 72, 50, 0.34); stroke: var(--accent, #a54832); stroke-width: 1.4; }
    .ws-hover-ledger { stroke: var(--accent, #a54832); stroke-width: 1.3; stroke-opacity: 0.7; }
    .ws-hover-tip-bg { fill: #fffefa; stroke: var(--accent, #a54832); stroke-width: 1.1; }
    .ws-hover-tip-text { font-size: 10.5px; font-weight: 700; fill: var(--accent, #a54832); text-anchor: middle; dominant-baseline: central; }
    .ws-marker { cursor: grab; transition: opacity 0.14s ease; }
    .ws-marker.dragging { cursor: grabbing; }
    .ws-marker-dot { stroke-width: 2; fill-opacity: 0.24; transition: fill-opacity 0.12s ease, stroke-width 0.12s ease; }
    .ws-marker:hover .ws-marker-dot { fill-opacity: 0.42; stroke-width: 2.6; }
    .ws-voice-S .ws-marker-dot { fill: #2b5b84; stroke: #2b5b84; }
    .ws-voice-A .ws-marker-dot { fill: var(--green, #4d6857); stroke: var(--green, #4d6857); }
    .ws-voice-T .ws-marker-dot { fill: #7a4e8c; stroke: #7a4e8c; }
    .ws-voice-B .ws-marker-dot { fill: var(--ink, #292e2b); stroke: var(--ink, #292e2b); }
    .ws-marker.ws-missing .ws-marker-dot { fill: rgba(182, 139, 39, 0.22); stroke: #b68b27; stroke-dasharray: 3 2; }
    .ws-review-ring { fill: none; stroke: #b68b27; stroke-width: 2; stroke-dasharray: 3.5 2.5; pointer-events: none; }
    .ws-source-handwritten .ws-review-ring { stroke: #b68b27; stroke-opacity: 0.85; }
    .ws-marker-ledger { stroke: var(--ink, #292e2b); stroke-opacity: 0.65; stroke-width: 1.25; pointer-events: none; }
    .ws-marker-label { font-size: 10px; font-weight: 700; fill: var(--ink, #292e2b); text-anchor: middle; paint-order: stroke; stroke: #fffefa; stroke-width: 3.2px; stroke-linejoin: round; pointer-events: none; }
    .ws-voice-S .ws-marker-label { fill: #21486a; }
    .ws-voice-A .ws-marker-label { fill: #354c3e; }
    .ws-voice-T .ws-marker-label { fill: #5e386d; }
    .ws-voice-B .ws-marker-label { fill: var(--ink, #292e2b); }
    .ws-marker.selected .ws-marker-dot { stroke: var(--accent, #a54832); fill: var(--accent, #a54832); fill-opacity: 0.36; stroke-width: 2.8; }
    .ws-marker.selected .ws-marker-label { fill: var(--accent, #a54832); }
    .ws-marker.active .ws-marker-dot { stroke: var(--accent, #a54832); fill: var(--accent, #a54832); fill-opacity: 0.62; stroke-width: 3; }
    .ws-marker.active .ws-marker-label { fill: var(--accent, #a54832); }
    .ws-marker.ws-marker-issue-target .ws-marker-dot { stroke: #b83324; fill: #b83324; fill-opacity: 0.5; stroke-width: 3; }
    .ws-issue-arc { fill: none; stroke-width: 2.2; stroke-dasharray: 5 3.5; stroke-linecap: round; pointer-events: none; }
    .gs-issue-error .ws-issue-arc { stroke: var(--accent, #a54832); }
    .gs-issue-warning .ws-issue-arc { stroke: #b68b27; }
    .gs-issue-info .ws-issue-arc { stroke: var(--green, #4d6857); }
    .ws-issue-halo { fill: none; stroke-width: 2.2; pointer-events: none; }
    .gs-issue-error .ws-issue-halo { stroke: var(--accent, #a54832); fill: rgba(165, 72, 50, 0.16); }
    .gs-issue-warning .ws-issue-halo { stroke: #b68b27; fill: rgba(182, 139, 39, 0.16); }
    .gs-issue-info .ws-issue-halo { stroke: var(--green, #4d6857); fill: rgba(77, 104, 87, 0.15); }
    .ws-svg.gs-has-focused-issue .ws-issue-group { opacity: 0.2; }
    .ws-svg.gs-has-focused-issue .ws-issue-group.gs-issue-focused { opacity: 1; }
    .ws-issue-group.gs-issue-focused .ws-issue-arc { stroke-width: 3.1; stroke-dasharray: 6 3; }
    .ws-issue-group.gs-issue-focused .ws-issue-halo { stroke-width: 3; }
    .ws-nct-bg { fill: #eef3ee; stroke: var(--green, #4d6857); stroke-width: 1.1; }
    .ws-nct-text { font-size: 9.5px; font-weight: 700; fill: var(--green, #4d6857); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
    .ws-cadence-bg { stroke-width: 1.2; }
    .ws-cadence-pass .ws-cadence-bg { fill: #eef3ee; stroke: var(--green, #4d6857); }
    .ws-cadence-pass .ws-cadence-text { fill: var(--green, #4d6857); }
    .ws-cadence-fail .ws-cadence-bg { fill: #f7ece6; stroke: var(--accent, #a54832); }
    .ws-cadence-fail .ws-cadence-text { fill: var(--accent, #a54832); }
    .ws-cadence-text { font-size: 10.5px; font-weight: 700; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
    .ws-meta-pill { cursor: pointer; }
    .ws-meta-pill-bg { fill: rgba(255, 254, 250, 0.94); stroke: rgba(41, 46, 43, 0.28); stroke-width: 1.1; transition: stroke 0.12s ease, fill 0.12s ease; }
    .ws-meta-pill:hover .ws-meta-pill-bg { fill: #f7ece6; stroke: var(--accent, #a54832); stroke-width: 1.5; }
    .ws-meta-pill.ws-meta-empty .ws-meta-pill-bg { stroke-dasharray: 3 2; stroke: #b68b27; fill: rgba(255, 254, 250, 0.85); }
    .ws-roman-text { font-family: Georgia, "Times New Roman", serif; font-size: 12.5px; font-weight: 700; fill: var(--ink, #292e2b); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
    .ws-figure-text { font-size: 10.5px; font-weight: 700; fill: #555a53; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
    .ws-meta-pill.ws-meta-empty .ws-roman-text, .ws-meta-pill.ws-meta-empty .ws-figure-text { fill: #8b7120; font-style: italic; font-size: 10px; }
    .ws-playhead { stroke: var(--accent, #a54832); stroke-width: 2.5; stroke-opacity: 0.82; stroke-linecap: round; pointer-events: none; }
  `;
}

function findNearestColumnForSystem(x, systemIndex, columnMeta) {
  const sameSys = columnMeta.filter(c => c.systemIndex === systemIndex);
  const candidates = sameSys.length ? sameSys : columnMeta;
  if (!candidates.length) return null;
  let best = candidates[0];
  let bestDist = Math.abs(candidates[0].x - x);
  for (let i = 1; i < candidates.length; i++) {
    const d = Math.abs(candidates[i].x - x);
    if (d < bestDist) {
      bestDist = d;
      best = candidates[i];
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Interactive SVG Renderer & Live Highlighting Exports
// ---------------------------------------------------------------------------

/**
 * Render an interactive on-image AP Music Theory worksheet canvas with voice markers,
 * vertical pitch dragging, inline Roman/figure pills, red-ink grading overlays, and playhead.
 */
export function renderWorksheetCanvas(svgElement, model = {}, handlers = {}) {
  if (!svgElement) throw new TypeError('renderWorksheetCanvas requires an SVG element.');
  const doc = svgElement.ownerDocument || globalThis.document;
  const layout = computeWorksheetOverlayLayout(model);
  const editable = handlers.editable ?? model.editable ?? true;

  svgElement.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
  svgElement.setAttribute('role', 'img');
  svgElement.setAttribute('aria-label', model.title || 'Interactive AP Music Theory Worksheet');
  svgElement.classList?.add('ws-svg');
  svgElement.classList?.remove('gs-has-focused-issue', 'ws-has-focused-issue');
  svgElement.replaceChildren?.();
  if (!svgElement.replaceChildren) {
    while (svgElement.firstChild) svgElement.removeChild(svgElement.firstChild);
  }

  svgElement.appendChild(svgEl(doc, 'style', {}, embeddedWorksheetStyles()));

  // Layer 1: Paper backdrop & actual uploaded worksheet image.
  const imageLayer = svgEl(doc, 'g', { class: 'ws-image-layer' });
  imageLayer.appendChild(svgEl(doc, 'rect', {
    class: 'ws-backdrop', x: 0, y: 0, width: layout.width, height: layout.height, rx: 4,
  }));
  if (layout.preview) {
    imageLayer.appendChild(svgEl(doc, 'image', {
      class: 'ws-image',
      href: layout.preview,
      x: 0,
      y: 0,
      width: layout.width,
      height: layout.height,
      preserveAspectRatio: 'xMidYMid meet',
    }));
  }
  svgElement.appendChild(imageLayer);

  // Layer 2: Given / Reference region before gradeFromOnset (FRQ 7).
  if (layout.givenRegion) {
    const givenLayer = svgEl(doc, 'g', { class: 'ws-given-region' });
    for (const r of layout.givenRegion.rects) {
      givenLayer.appendChild(svgEl(doc, 'rect', {
        class: 'ws-given-rect',
        x: r.x.toFixed(1),
        y: r.y.toFixed(1),
        width: r.width.toFixed(1),
        height: r.height.toFixed(1),
        rx: 3,
        'data-system-index': r.systemIndex,
      }));
    }
    if (layout.givenRegion.divider) {
      const div = layout.givenRegion.divider;
      givenLayer.appendChild(svgEl(doc, 'line', {
        class: 'ws-grade-divider',
        x1: div.x.toFixed(1),
        y1: div.y1.toFixed(1),
        x2: div.x.toFixed(1),
        y2: div.y2.toFixed(1),
        'data-system-index': div.systemIndex,
      }));
      const pillW = Math.max(118, div.label.length * 6.4 + 14);
      const pillX = Math.min(layout.width - pillW - 6, div.x + 6);
      const pillY = Math.max(12, div.y1 + 2);
      givenLayer.appendChild(svgEl(doc, 'rect', {
        class: 'ws-grade-divider-bg',
        x: pillX.toFixed(1),
        y: (pillY - 9).toFixed(1),
        width: pillW.toFixed(1),
        height: 18,
        rx: 9,
      }));
      givenLayer.appendChild(svgEl(doc, 'text', {
        class: 'ws-grade-divider-label',
        x: (pillX + 8).toFixed(1),
        y: pillY.toFixed(1),
      }, div.label));
    }
    svgElement.appendChild(givenLayer);
  }

  // Layer 3: Subtle interactive staff bands + hover ghost notehead & pitch tooltip.
  const staffBandsLayer = svgEl(doc, 'g', { class: 'ws-staff-bands' });
  const hoverGroup = svgEl(doc, 'g', { class: 'ws-hover-preview', visibility: 'hidden' });
  const hoverLedgers = svgEl(doc, 'g', { class: 'ws-hover-ledgers' });
  const hoverHead = svgEl(doc, 'ellipse', {
    class: 'ws-hover-notehead', cx: 0, cy: 0, rx: 6, ry: 4.5,
  });
  const hoverTipBg = svgEl(doc, 'rect', {
    class: 'ws-hover-tip-bg', x: 0, y: 0, width: 34, height: 17, rx: 8.5,
  });
  const hoverTipText = svgEl(doc, 'text', {
    class: 'ws-hover-tip-text', x: 0, y: 0,
  }, '');
  hoverGroup.appendChild(hoverLedgers);
  hoverGroup.appendChild(hoverHead);
  hoverGroup.appendChild(hoverTipBg);
  hoverGroup.appendChild(hoverTipText);

  if (editable) {
    const sortedSystems = [...layout.systems].sort((a, b) => a.top - b.top);
    sortedSystems.forEach((sys, idx) => {
      const prev = idx > 0 ? sortedSystems[idx - 1] : null;
      const next = idx + 1 < sortedSystems.length ? sortedSystems[idx + 1] : null;
      const topLimit = prev ? (prev.bottom + sys.top) / 2 : Math.max(0, sys.top - sys.space * 3.2);
      const bottomLimit = next ? (sys.bottom + next.top) / 2 : Math.min(layout.height, sys.bottom + sys.space * 3.2);

      const bands = [];
      if (sys.treble && sys.bass) {
        bands.push({ staff: 'treble', staffObj: sys.treble, top: topLimit, bottom: sys.splitY });
        bands.push({ staff: 'bass', staffObj: sys.bass, top: sys.splitY, bottom: bottomLimit });
      } else if (sys.treble) {
        bands.push({ staff: 'treble', staffObj: sys.treble, top: topLimit, bottom: bottomLimit });
      } else if (sys.bass) {
        bands.push({ staff: 'bass', staffObj: sys.bass, top: topLimit, bottom: bottomLimit });
      }

      for (const band of bands) {
        const rect = svgEl(doc, 'rect', {
          class: 'ws-staff-band',
          x: band.staffObj.left,
          y: band.top,
          width: Math.max(20, band.staffObj.right - band.staffObj.left),
          height: Math.max(20, band.bottom - band.top),
          'data-system-index': sys.index,
          'data-staff': band.staff,
        });

        const resolvePointer = event => {
          const pt = clientToSvgPoint(svgElement, event.clientX, event.clientY, layout);
          const snapped = pitchFromWorksheetY(pt.y, band.staff, band.staffObj.lines, layout.keySignature);
          const nearestCol = findNearestColumnForSystem(pt.x, sys.index, layout.columnMeta);
          const ledgers = ledgerLinesForStep(snapped.staffStep, band.staffObj.lines);
          return { pt, snapped, nearestCol, ledgers };
        };

        const updateHover = event => {
          const { pt, snapped, nearestCol, ledgers } = resolvePointer(event);
          const gx = nearestCol ? nearestCol.x : pt.x;
          const rx = Math.max(4.5, band.staffObj.space * 0.56);
          const ry = Math.max(3.4, band.staffObj.space * 0.42);
          hoverHead.setAttribute('cx', gx.toFixed(1));
          hoverHead.setAttribute('cy', snapped.y.toFixed(1));
          hoverHead.setAttribute('rx', rx.toFixed(1));
          hoverHead.setAttribute('ry', ry.toFixed(1));
          hoverHead.setAttribute('transform', `rotate(-16 ${gx.toFixed(1)} ${snapped.y.toFixed(1)})`);

          hoverLedgers.replaceChildren?.();
          for (const ly of ledgers) {
            hoverLedgers.appendChild(svgEl(doc, 'line', {
              class: 'ws-hover-ledger',
              x1: (gx - rx - 3).toFixed(1),
              y1: ly.toFixed(1),
              x2: (gx + rx + 3).toFixed(1),
              y2: ly.toFixed(1),
            }));
          }

          const tipW = Math.max(32, snapped.display.length * 7.2 + 12);
          const tipX = clamp(gx, tipW / 2 + 4, layout.width - tipW / 2 - 4);
          const tipY = Math.max(12, snapped.y - ry - 14);
          hoverTipBg.setAttribute('x', (tipX - tipW / 2).toFixed(1));
          hoverTipBg.setAttribute('y', (tipY - 8.5).toFixed(1));
          hoverTipBg.setAttribute('width', tipW.toFixed(1));
          hoverTipText.setAttribute('x', tipX.toFixed(1));
          hoverTipText.setAttribute('y', tipY.toFixed(1));
          hoverTipText.textContent = snapped.display;
          hoverGroup.setAttribute('visibility', 'visible');
        };

        rect.addEventListener?.('mousemove', updateHover);
        rect.addEventListener?.('pointermove', updateHover);
        rect.addEventListener?.('mouseleave', () => hoverGroup.setAttribute('visibility', 'hidden'));
        rect.addEventListener?.('pointerleave', () => hoverGroup.setAttribute('visibility', 'hidden'));
        rect.addEventListener?.('click', event => {
          const { pt, snapped, nearestCol } = resolvePointer(event);
          handlers.onStaffClick?.({
            chordIndex: nearestCol ? nearestCol.chordIndex : null,
            systemIndex: sys.index,
            staff: band.staff,
            x: nearestCol ? nearestCol.x : pt.x,
            rawX: pt.x,
            y: snapped.y,
            letter: snapped.letter,
            octave: snapped.octave,
            alteration: snapped.alteration,
            staffStep: snapped.staffStep,
            spell: snapped.spell,
            display: snapped.display,
            midi: snapped.midi,
          });
        });

        staffBandsLayer.appendChild(rect);
      }
    });
  }
  staffBandsLayer.appendChild(hoverGroup);
  svgElement.appendChild(staffBandsLayer);

  // Layer 4: Red-ink grading overlays (halos & curved dashed arcs directly on worksheet coordinates).
  const overlaysLayer = svgEl(doc, 'g', { class: 'ws-overlays' });
  for (const ov of layout.issueOverlays) {
    const group = svgEl(doc, 'g', {
      class: `ws-issue-group gs-issue-group gs-issue-${ov.severity}`,
      'data-issue-id': ov.id,
      'data-issue-index': ov.issueIndex,
      'data-issue-code': ov.code,
    });
    if (ov.message) {
      group.appendChild(svgEl(doc, 'title', {}, ov.message));
    }
    for (const halo of ov.halos) {
      group.appendChild(svgEl(doc, 'circle', {
        class: 'ws-issue-halo gs-issue-halo',
        cx: halo.x.toFixed(1),
        cy: halo.y.toFixed(1),
        r: halo.radius.toFixed(1),
        'data-note-id': halo.noteId || undefined,
        'data-chord-index': halo.chordIndex,
        'data-voice': halo.voice,
      }));
    }
    for (const arc of ov.arcs) {
      group.appendChild(svgEl(doc, 'path', {
        class: 'ws-issue-arc gs-issue-arc',
        d: arc.path,
      }));
    }
    overlaysLayer.appendChild(group);
  }
  svgElement.appendChild(overlaysLayer);

  // Active vertical drag session state (scoped to this render call).
  let activeDrag = null;

  const updateMarkerDragVisual = (drag, snapped) => {
    drag.currentSnapped = snapped;
    drag.dot.setAttribute('cy', snapped.y.toFixed(1));
    if (drag.reviewRing) drag.reviewRing.setAttribute('cy', snapped.y.toFixed(1));
    const labelOffset = drag.marker.voice === 'S' || drag.marker.voice === 'T'
      ? -(drag.marker.radius + 5)
      : drag.marker.radius + 11;
    drag.label.setAttribute('y', (snapped.y + labelOffset).toFixed(1));
    drag.label.textContent = `${drag.marker.voice} ${snapped.display}`;
    drag.group.setAttribute('data-y', snapped.y.toFixed(1));
    drag.group.setAttribute('data-spell', snapped.spell);
    drag.group.setAttribute('data-midi', String(snapped.midi));
  };

  const handleGlobalDragMove = event => {
    if (!activeDrag) return;
    if (activeDrag.pointerId !== undefined && event.pointerId !== undefined && event.pointerId !== activeDrag.pointerId) {
      return;
    }
    const pt = clientToSvgPoint(svgElement, event.clientX, event.clientY, layout);
    const dy = Math.abs(pt.y - activeDrag.startSvgY);
    const snapped = pitchFromWorksheetY(pt.y, activeDrag.staff, activeDrag.lines, layout.keySignature);
    if (dy >= 3 || (activeDrag.startStep !== null && snapped.staffStep !== activeDrag.startStep)) {
      activeDrag.moved = true;
      activeDrag.group.classList?.add('dragging');
      updateMarkerDragVisual(activeDrag, snapped);
    }
  };

  const finishGlobalDrag = event => {
    if (!activeDrag) return;
    if (activeDrag.pointerId !== undefined && event?.pointerId !== undefined && event.pointerId !== activeDrag.pointerId) {
      return;
    }
    const drag = activeDrag;
    activeDrag = null;
    drag.group.classList?.remove('dragging');
    drag.group.releasePointerCapture?.(drag.pointerId);

    if (drag.moved && drag.currentSnapped) {
      drag.suppressClick = true;
      const snapped = drag.currentSnapped;
      handlers.onMoveMarker?.({
        chordIndex: drag.marker.chordIndex,
        voice: drag.marker.voice,
        noteId: drag.marker.noteId,
        letter: snapped.letter,
        octave: snapped.octave,
        alteration: snapped.alteration,
        staffStep: snapped.staffStep,
        spell: snapped.spell,
        display: snapped.display,
        midi: snapped.midi,
        y: snapped.y,
        staff: drag.staff,
        systemIndex: drag.marker.systemIndex,
      });
    }
  };

  if (editable) {
    svgElement.addEventListener?.('pointermove', handleGlobalDragMove);
    svgElement.addEventListener?.('pointerup', finishGlobalDrag);
    svgElement.addEventListener?.('pointercancel', () => {
      if (!activeDrag) return;
      activeDrag.group.classList?.remove('dragging');
      activeDrag = null;
    });
  }

  // Layer 5: Interactive color-coded voice markers overlaid at exact (x, y) coordinates.
  const markersLayer = svgEl(doc, 'g', { class: 'ws-markers' });
  for (const marker of layout.markers) {
    const classes = ['ws-marker', `ws-voice-${marker.voice}`, `ws-source-${marker.source}`];
    if (marker.selected) classes.push('selected');
    if (marker.missing) classes.push('ws-missing');
    if (marker.needsReview) classes.push('ws-needs-review');

    const g = svgEl(doc, 'g', {
      class: classes.join(' '),
      'data-note-id': marker.noteId,
      'data-chord-index': marker.chordIndex,
      'data-voice': marker.voice,
      'data-midi': marker.midi !== null ? marker.midi : '',
      'data-onset': marker.onset,
      'data-duration': marker.duration,
      'data-system-index': marker.systemIndex,
      'data-staff': marker.staff,
      'data-x': marker.x.toFixed(1),
      'data-y': marker.y.toFixed(1),
      'data-spell': marker.spell || '',
      'data-source': marker.source,
      'data-needs-review': marker.needsReview ? 'true' : 'false',
      'data-missing': marker.missing ? 'true' : 'false',
      role: 'button',
      tabindex: 0,
      'aria-label': `${marker.voice} ${marker.missing ? 'missing note' : marker.display}${marker.needsReview ? ' (review)' : ''}`,
    });

    const titleParts = [`${marker.voice}: ${marker.missing ? 'Missing' : marker.display}`];
    if (marker.source) titleParts.push(marker.source);
    if (marker.needsReview) titleParts.push('Review');
    g.appendChild(svgEl(doc, 'title', {}, titleParts.join(' · ')));

    // Subtle ledger lines if the note sits outside the 5-line staff.
    for (const ly of marker.ledgerLines || []) {
      g.appendChild(svgEl(doc, 'line', {
        class: 'ws-marker-ledger',
        x1: (marker.x - marker.radius - 3.5).toFixed(1),
        y1: ly.toFixed(1),
        x2: (marker.x + marker.radius + 3.5).toFixed(1),
        y2: ly.toFixed(1),
      }));
    }

    // Amber dashed review ring for low-confidence / handwritten / missing notes.
    let reviewRing = null;
    if (marker.needsReview || marker.source === 'handwritten') {
      reviewRing = svgEl(doc, 'circle', {
        class: 'ws-review-ring',
        cx: marker.x.toFixed(1),
        cy: marker.y.toFixed(1),
        r: (marker.radius + 3.5).toFixed(1),
      });
      g.appendChild(reviewRing);
    }

    // Main interactive voice marker ring/dot.
    const dot = svgEl(doc, 'circle', {
      class: 'ws-marker-dot',
      cx: marker.x.toFixed(1),
      cy: marker.y.toFixed(1),
      r: marker.radius.toFixed(1),
    });
    g.appendChild(dot);

    // Readable voice + pitch label with white halo.
    const labelOffset = marker.voice === 'S' || marker.voice === 'T'
      ? -(marker.radius + 5)
      : marker.radius + 11;
    const label = svgEl(doc, 'text', {
      class: 'ws-marker-label',
      x: marker.x.toFixed(1),
      y: (marker.y + labelOffset).toFixed(1),
    }, `${marker.voice} ${marker.display}`);
    g.appendChild(label);

    const sys = layout.systems.find(s => s.index === marker.systemIndex) || layout.systems[0];
    const staffObj = sys ? (marker.staff === 'bass' ? sys.bass : sys.treble) : null;
    const dragStateRef = { suppressClick: false };

    const emitSelect = () => {
      handlers.onSelectNote?.({
        chordIndex: marker.chordIndex,
        voice: marker.voice,
        noteId: marker.noteId,
        spell: marker.spell,
        display: marker.display,
        midi: marker.midi,
        onset: marker.onset,
        duration: marker.duration,
        systemIndex: marker.systemIndex,
        staff: marker.staff,
        missing: marker.missing,
        needsReview: marker.needsReview,
      });
    };

    if (editable && staffObj?.lines) {
      g.addEventListener?.('pointerdown', event => {
        if (event.button !== undefined && event.button !== 0) return;
        event.stopPropagation?.();
        const pt = clientToSvgPoint(svgElement, event.clientX, event.clientY, layout);
        dragStateRef.suppressClick = false;
        activeDrag = {
          marker,
          group: g,
          dot,
          reviewRing,
          label,
          staff: marker.staff,
          lines: staffObj.lines,
          pointerId: event.pointerId,
          startSvgY: pt.y,
          startStep: marker.staffStep,
          moved: false,
          currentSnapped: null,
          get suppressClick() { return dragStateRef.suppressClick; },
          set suppressClick(v) { dragStateRef.suppressClick = v; },
        };
        g.setPointerCapture?.(event.pointerId);
      });
      // Also listen directly on the marker so non-bubbling fake DOM tests can dispatch on the marker itself.
      g.addEventListener?.('pointermove', event => {
        if (activeDrag && activeDrag.group === g) {
          event.stopPropagation?.();
          handleGlobalDragMove(event);
        }
      });
      g.addEventListener?.('pointerup', event => {
        if (activeDrag && activeDrag.group === g) {
          event.stopPropagation?.();
          finishGlobalDrag(event);
        }
      });
    }

    g.addEventListener?.('click', event => {
      event.stopPropagation?.();
      if (dragStateRef.suppressClick) {
        dragStateRef.suppressClick = false;
        return;
      }
      emitSelect();
    });

    g.addEventListener?.('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault?.();
        emitSelect();
      } else if (editable && staffObj?.lines && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault?.();
        const delta = event.key === 'ArrowUp' ? 1 : -1;
        const baseStep = Number.isInteger(marker.staffStep) ? marker.staffStep : staffStepFromY(marker.y, staffObj.lines);
        const nextY = yFromStaffStep(baseStep + delta, staffObj.lines);
        const snapped = pitchFromWorksheetY(nextY, marker.staff, staffObj.lines, layout.keySignature);
        handlers.onMoveMarker?.({
          chordIndex: marker.chordIndex,
          voice: marker.voice,
          noteId: marker.noteId,
          letter: snapped.letter,
          octave: snapped.octave,
          alteration: snapped.alteration,
          staffStep: snapped.staffStep,
          spell: snapped.spell,
          display: snapped.display,
          midi: snapped.midi,
          y: snapped.y,
          staff: marker.staff,
          systemIndex: marker.systemIndex,
        });
      }
    });

    markersLayer.appendChild(g);
  }
  svgElement.appendChild(markersLayer);

  // Layer 6: NCT badges & Cadence badges.
  const badgesLayer = svgEl(doc, 'g', { class: 'ws-badges' });
  for (const nct of layout.nctBadges) {
    const w = Math.max(24, nct.label.length * 6.8 + 10);
    const g = svgEl(doc, 'g', {
      class: 'ws-nct-badge',
      'data-note-id': nct.noteId,
      'data-nct': nct.label,
    });
    g.appendChild(svgEl(doc, 'rect', {
      class: 'ws-nct-bg',
      x: (nct.x - w / 2).toFixed(1),
      y: (nct.y - 8).toFixed(1),
      width: w.toFixed(1),
      height: 16,
      rx: 8,
    }));
    g.appendChild(svgEl(doc, 'text', {
      class: 'ws-nct-text',
      x: nct.x.toFixed(1),
      y: nct.y.toFixed(1),
    }, nct.label));
    badgesLayer.appendChild(g);
  }

  for (const cad of layout.cadenceBadges) {
    const w = Math.max(44, cad.label.length * 7.0 + 14);
    const cadClass = cad.passed === false ? 'ws-cadence-fail' : 'ws-cadence-pass';
    const g = svgEl(doc, 'g', {
      class: `ws-cadence-badge ${cadClass}`,
      'data-cadence': cad.cadence,
      'data-passed': cad.passed === null ? '' : (cad.passed ? 'true' : 'false'),
    });
    g.appendChild(svgEl(doc, 'rect', {
      class: 'ws-cadence-bg',
      x: (cad.x - w / 2).toFixed(1),
      y: (cad.y - 9.5).toFixed(1),
      width: w.toFixed(1),
      height: 19,
      rx: 9.5,
    }));
    g.appendChild(svgEl(doc, 'text', {
      class: 'ws-cadence-text',
      x: cad.x.toFixed(1),
      y: cad.y.toFixed(1),
    }, cad.label));
    badgesLayer.appendChild(g);
  }
  svgElement.appendChild(badgesLayer);

  // Layer 7: Editable inline Roman numeral & Figured Bass pill badges below each bass column.
  const metaLayer = svgEl(doc, 'g', { class: 'ws-column-meta' });
  for (const meta of layout.columnMeta) {
    const renderPill = (kind, value, yPos, textClass, placeholder) => {
      const isEmpty = !value;
      const displayText = isEmpty ? placeholder : value;
      const pillW = Math.max(28, displayText.length * 7.6 + 12);
      const pillH = kind === 'roman' ? 20 : 17;
      const g = svgEl(doc, 'g', {
        class: `ws-meta-pill ws-${kind}-pill${isEmpty ? ' ws-meta-empty' : ''}`,
        'data-chord-index': meta.chordIndex,
        'data-kind': kind,
        'data-system-index': meta.systemIndex,
        role: 'button',
        tabindex: 0,
        'aria-label': `Chord ${meta.chordIndex + 1} ${kind === 'roman' ? 'Roman numeral' : 'figured bass'}: ${value || 'empty'}`,
      });
      g.appendChild(svgEl(doc, 'rect', {
        class: 'ws-meta-pill-bg',
        x: (meta.x - pillW / 2).toFixed(1),
        y: (yPos - pillH / 2).toFixed(1),
        width: pillW.toFixed(1),
        height: pillH,
        rx: pillH / 2,
      }));
      g.appendChild(svgEl(doc, 'text', {
        class: textClass,
        x: meta.x.toFixed(1),
        y: yPos.toFixed(1),
      }, displayText));

      const emitMeta = event => {
        event?.stopPropagation?.();
        handlers.onSelectColumnMeta?.({
          chordIndex: meta.chordIndex,
          kind,
          value,
          systemIndex: meta.systemIndex,
        });
      };
      g.addEventListener?.('click', emitMeta);
      g.addEventListener?.('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault?.();
          emitMeta(event);
        }
      });
      metaLayer.appendChild(g);
    };

    if (meta.figure || (layout.mode === 'four-part' && editable)) {
      renderPill('figure', meta.figure, meta.figureY, 'ws-figure-text', 'fig');
    }
    if (meta.roman || editable) {
      renderPill('roman', meta.roman, meta.romanY, 'ws-roman-text', 'RN');
    }
  }
  svgElement.appendChild(metaLayer);

  // Layer 8: Multi-system playback cursor line.
  const firstSys = layout.systems[0];
  const defaultPlayX = layout.columnMeta[0]?.x ?? layout.markers[0]?.x ?? (firstSys ? firstSys.left : 20);
  const defaultTopY = firstSys ? firstSys.top - firstSys.space : 10;
  const defaultBottomY = firstSys ? firstSys.bottom + firstSys.space : layout.height - 10;
  const playhead = svgEl(doc, 'line', {
    class: 'ws-playhead',
    x1: defaultPlayX.toFixed(1),
    y1: defaultTopY.toFixed(1),
    x2: defaultPlayX.toFixed(1),
    y2: defaultBottomY.toFixed(1),
    visibility: 'hidden',
  });
  svgElement.appendChild(playhead);

  svgElement.__worksheetLayout = layout;
  return layout;
}

/**
 * Highlight active playing markers and position the vertical playhead across the active system.
 */
export function highlightWorksheetActiveNotes(svgElement, activeEvents = []) {
  if (!svgElement) return;
  const markerNodes = svgElement.querySelectorAll ? [...svgElement.querySelectorAll('.ws-marker')] : [];
  for (const node of markerNodes) node.classList?.remove('active');

  const playhead = svgElement.querySelector?.('.ws-playhead');
  if (!Array.isArray(activeEvents) || !activeEvents.length) {
    playhead?.setAttribute('visibility', 'hidden');
    return;
  }

  const knownNoteIds = new Set(markerNodes.map(n => n.getAttribute('data-note-id')).filter(Boolean));
  const matchedNodes = [];

  for (const node of markerNodes) {
    const noteId = node.getAttribute('data-note-id');
    const chordIndex = Number(node.getAttribute('data-chord-index'));
    const voice = node.getAttribute('data-voice');
    const rawMidi = node.getAttribute('data-midi');
    const midi = rawMidi !== null && rawMidi !== '' ? Number(rawMidi) : NaN;
    const onset = Number(node.getAttribute('data-onset'));

    const matched = activeEvents.some(event => {
      if (!event || typeof event !== 'object') return false;
      const evId = event.id ?? event.noteId;
      if (evId && knownNoteIds.has(String(evId))) {
        return String(evId) === noteId;
      }
      const evChord = Number.isInteger(event.chordIndex)
        ? event.chordIndex
        : Number.isInteger(event.chord_index)
          ? event.chord_index
          : null;
      if (evChord !== null && event.voice) {
        return evChord === chordIndex
          && event.voice === voice
          && (event.midi === undefined || event.midi === null || Number.isNaN(midi) || Number(event.midi) === midi);
      }
      if (Number.isFinite(Number(event.onset)) && Number.isFinite(Number(event.midi)) && !Number.isNaN(midi)) {
        return Math.abs(Number(event.onset) - onset) <= 0.05 && Number(event.midi) === midi;
      }
      return false;
    });

    if (matched) {
      node.classList?.add('active');
      matchedNodes.push(node);
    }
  }

  const layout = svgElement.__worksheetLayout;
  let cursorX = null;
  let activeSystemIndex = null;

  if (matchedNodes.length) {
    const xs = matchedNodes.map(n => Number(n.getAttribute('data-x'))).filter(Number.isFinite);
    if (xs.length) cursorX = Math.min(...xs);
    const sysAttr = Number(matchedNodes[0].getAttribute('data-system-index'));
    if (Number.isInteger(sysAttr)) activeSystemIndex = sysAttr;
  } else if (layout) {
    const firstChord = activeEvents.find(e => Number.isInteger(e?.chordIndex ?? e?.chord_index));
    const chordIdx = firstChord ? (firstChord.chordIndex ?? firstChord.chord_index) : null;
    const col = Number.isInteger(chordIdx) ? layout.columnMeta.find(c => c.chordIndex === chordIdx) : null;
    if (col) {
      cursorX = col.x;
      activeSystemIndex = col.systemIndex;
    }
  }

  if (cursorX !== null && playhead) {
    const sys = layout?.systems?.find(s => s.index === activeSystemIndex) || layout?.systems?.[0] || null;
    const topY = sys
      ? (sys.treble ? sys.treble.lines[0] - sys.treble.space : sys.top - sys.space)
      : 10;
    const bottomY = sys
      ? (sys.bass ? sys.bass.lines[4] + sys.bass.space : sys.bottom + sys.space)
      : (layout?.height ?? 200) - 10;
    playhead.setAttribute('x1', cursorX.toFixed(1));
    playhead.setAttribute('x2', cursorX.toFixed(1));
    playhead.setAttribute('y1', topY.toFixed(1));
    playhead.setAttribute('y2', bottomY.toFixed(1));
    playhead.setAttribute('visibility', 'visible');
  }
}

/**
 * Spotlight a specific grading issue's red-ink arc/halos and target markers, dimming other overlays.
 */
export function highlightWorksheetIssue(svgElement, issue = null) {
  if (!svgElement) return;
  const groups = svgElement.querySelectorAll ? [...svgElement.querySelectorAll('.ws-issue-group')] : [];
  const markerNodes = svgElement.querySelectorAll ? [...svgElement.querySelectorAll('.ws-marker')] : [];

  for (const g of groups) g.classList?.remove('gs-issue-focused', 'ws-issue-focused');
  for (const m of markerNodes) m.classList?.remove('ws-marker-issue-target', 'gs-issue-target');

  if (!issue) {
    svgElement.classList?.remove('gs-has-focused-issue', 'ws-has-focused-issue');
    return;
  }

  const targetId = typeof issue === 'string' ? issue : issue.id;
  const targetIndex = typeof issue === 'number' ? issue : issue.issueIndex;
  const targetCode = typeof issue === 'object' ? (issue.code ?? issue.rule_id ?? issue.type) : null;

  const matchedGroup = groups.find(g => {
    if (targetId !== undefined && g.getAttribute('data-issue-id') === String(targetId)) return true;
    if (targetIndex !== undefined && Number(g.getAttribute('data-issue-index')) === targetIndex) return true;
    if (targetCode && g.getAttribute('data-issue-code') === String(targetCode)) return true;
    return false;
  });

  if (!matchedGroup) {
    svgElement.classList?.remove('gs-has-focused-issue', 'ws-has-focused-issue');
    return;
  }

  svgElement.classList?.add('gs-has-focused-issue', 'ws-has-focused-issue');
  matchedGroup.classList?.add('gs-issue-focused', 'ws-issue-focused');

  const halos = matchedGroup.querySelectorAll ? [...matchedGroup.querySelectorAll('.ws-issue-halo')] : [];
  const targetIds = new Set(halos.map(h => h.getAttribute('data-note-id')).filter(Boolean));
  const targetKeys = new Set(
    halos
      .filter(h => !h.getAttribute('data-note-id'))
      .map(h => `${h.getAttribute('data-chord-index')}:${h.getAttribute('data-voice')}`),
  );

  for (const node of markerNodes) {
    const noteId = node.getAttribute('data-note-id');
    const key = `${node.getAttribute('data-chord-index')}:${node.getAttribute('data-voice')}`;
    if ((noteId && targetIds.has(noteId)) || targetKeys.has(key)) {
      node.classList?.add('ws-marker-issue-target', 'gs-issue-target');
    }
  }
}
