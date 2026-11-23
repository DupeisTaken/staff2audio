// AP Music Theory Studio UI controller (Four-Part Writing SATB & Melody Harmonization FRQ 7).
// Integrates SVG Grand Staff engraving, polyphonic TheoryAudioController, and local FastAPI grading.
import {
  renderGrandStaff,
  highlightActiveNotes,
  highlightIssue,
  parsePitchDisplay,
} from "./grand-staff.js";
import {
  renderWorksheetCanvas,
  highlightWorksheetActiveNotes,
  highlightWorksheetIssue,
} from "./worksheet-canvas.js";
import {
  TheoryAudioController,
  buildSatbEvents,
  buildMelodyHarmonizationEvents,
  SATB_VOICES,
} from "./theory-audio.js";
import { eventName, pitchName } from "./note-names.js";

const LETTERS = "CDEFGAB";
const NATURALS = [0, 2, 4, 5, 7, 9, 11];
const ASCII_ACC = { "-2": "bb", "-1": "b", 0: "", 1: "#", 2: "##" };
const DISPLAY_ACC = { "-2": "𝄫", "-1": "♭", 0: "", 1: "♯", 2: "𝄪" };

const MAJOR_BY_SIG = {
  "-7": "Cb", "-6": "Gb", "-5": "Db", "-4": "Ab", "-3": "Eb", "-2": "Bb", "-1": "F",
  0: "C", 1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F#", 7: "C#",
};
const MINOR_BY_SIG = {
  "-7": "Ab", "-6": "Eb", "-5": "Bb", "-4": "F", "-3": "C", "-2": "G", "-1": "D",
  0: "A", 1: "E", 2: "B", 3: "F#", 4: "C#", 5: "G#", 6: "D#", 7: "A#",
};
const SIG_BY_MAJOR = Object.fromEntries(Object.entries(MAJOR_BY_SIG).map(([k, v]) => [v.toUpperCase(), Number(k)]));
const SIG_BY_MINOR = Object.fromEntries(Object.entries(MINOR_BY_SIG).map(([k, v]) => [v.toUpperCase(), Number(k)]));

const VOICE_LABELS = Object.freeze({
  S: "Soprano",
  A: "Alto",
  T: "Tenor",
  B: "Bass",
});

const VOICE_DEFAULTS = Object.freeze({
  S: "E4",
  A: "C4",
  T: "G3",
  B: "C3",
});

const AP_NUMERAL_CHIPS_MAJOR = ["I", "I6", "ii", "ii6", "iii", "IV", "IV6", "V", "V6", "V7", "vi", "vii°6", "Cad6/4", "V/V", "V7/V"];
const AP_NUMERAL_CHIPS_MINOR = ["i", "i6", "ii°6", "III", "iv", "iv6", "V", "V6", "V7", "VI", "vii°6", "Cad6/4", "V/V", "V7/V"];

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function keyAlterationsMap(keySignature = 0) {
  const sig = Number.isInteger(keySignature) && keySignature >= -7 && keySignature <= 7 ? keySignature : 0;
  const map = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  const order = sig > 0 ? "FCGDAEB" : "BEADGCF";
  for (const letter of order.slice(0, Math.abs(sig))) map[letter] = Math.sign(sig);
  return map;
}

/** Convert (key_tonic, mode) into integer fifths (-7..+7). */
export function keySignatureFromTonicMode(tonic = "C", mode = "major") {
  const clean = String(tonic || "C")
    .trim()
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    .toUpperCase();
  const table = String(mode || "major").toLowerCase() === "minor" ? SIG_BY_MINOR : SIG_BY_MAJOR;
  return table[clean] ?? 0;
}

/** Convert integer fifths (-7..+7) into { tonic, mode }. */
export function tonicModeFromKeySignature(keySignature = 0, mode = "major") {
  const sig = clamp(Math.round(Number(keySignature) || 0), -7, 7);
  const normalizedMode = String(mode || "major").toLowerCase() === "minor" ? "minor" : "major";
  const table = normalizedMode === "minor" ? MINOR_BY_SIG : MAJOR_BY_SIG;
  return { tonic: table[String(sig)] || "C", mode: normalizedMode };
}

/** Format a key label cleanly with music glyphs (e.g. "B♭ Major"). */
export function formatKeyLabel(tonic = "C", mode = "major") {
  const prettyTonic = String(tonic || "C").replace(/#/g, "♯").replace(/b/g, "♭");
  const prettyMode = String(mode || "major").toLowerCase() === "minor" ? "Minor" : "Major";
  return `${prettyTonic} ${prettyMode}`;
}

/** Normalize pitch string (including Unicode accidentals) into ASCII spelling like "F#4" or "Bb3". */
export function normalizeAsciiPitch(pitch) {
  const parsed = parsePitchDisplay(pitch);
  if (!parsed) return null;
  return `${parsed.letter}${ASCII_ACC[parsed.alteration] ?? ""}${parsed.octave}`;
}

/** Format pitch string for human display with Unicode accidentals like "F♯4". */
export function formatDisplayPitch(pitch) {
  const parsed = parsePitchDisplay(pitch);
  return parsed ? parsed.display : String(pitch ?? "");
}

/** Shift a written pitch by diatonic steps, chromatic semitones, or octaves. */
export function nudgePitch(pitch, { diatonic = 0, chromatic = 0, octave = 0, keySignature = 0 } = {}) {
  const parsed = parsePitchDisplay(pitch);
  if (!parsed) return null;
  if (chromatic !== 0) {
    const nextMidi = clamp(parsed.midi + chromatic, 28, 96);
    return normalizeAsciiPitch(pitchName(nextMidi, keySignature));
  }
  const nextStep = clamp(parsed.diatonicStep + diatonic + octave * 7, 14, 62);
  const letterIndex = ((nextStep % 7) + 7) % 7;
  const nextOctave = Math.floor(nextStep / 7);
  const letter = LETTERS[letterIndex];
  const alteration = diatonic !== 0
    ? keyAlterationsMap(keySignature)[letter]
    : parsed.alteration;
  return `${letter}${ASCII_ACC[alteration] ?? ""}${nextOctave}`;
}

/** Set an explicit accidental alteration (-2..+2) on a written pitch string. */
export function setPitchAccidental(pitch, alteration = 0) {
  const parsed = parsePitchDisplay(pitch);
  if (!parsed) return null;
  const alt = clamp(Math.round(Number(alteration) || 0), -2, 2);
  return `${parsed.letter}${ASCII_ACC[alt] ?? ""}${parsed.octave}`;
}

/** Convert an OMR staff from Tab 1 into a Melody Harmonization workspace session payload. */
export function staffToMelodyPayload(staff, title = "Scanned Melody") {
  if (!staff || !Array.isArray(staff.events)) return null;
  const keySig = Number.isInteger(staff.key_signature) ? staff.key_signature : 0;
  const { tonic, mode } = tonicModeFromKeySignature(keySig, "major");
  const timeSig = staff.time_signature || "4/4";
  const rawPitched = [];
  let cursor = 0;

  for (const ev of staff.events) {
    const dur = Number.isFinite(Number(ev.duration)) && Number(ev.duration) > 0 ? Number(ev.duration) : 1;
    const onset = Number.isFinite(Number(ev.onset)) && Number(ev.onset) >= 0 ? Number(ev.onset) : cursor;
    cursor = Math.max(cursor, onset + dur);
    if (ev.midi === null || ev.midi === undefined) continue;
    const rawName = eventName(ev, staff);
    const ascii = normalizeAsciiPitch(rawName) || normalizeAsciiPitch(pitchName(ev.midi, keySig));
    if (!ascii) continue;
    rawPitched.push({ onset: Number(onset.toFixed(4)), duration: Number(dur.toFixed(4)), pitch: ascii, midi: ev.midi });
  }
  if (!rawPitched.length) return null;

  // Lift bass-clef / low-register scans up by whole octaves into treble soprano register so bass accompaniment sits cleanly below.
  const midis = rawPitched.map((n) => n.midi).sort((a, b) => a - b);
  const medianMidi = midis[Math.floor(midis.length / 2)];
  let octaveLift = 0;
  if (staff.clef === "bass" || medianMidi < 58) {
    while (medianMidi + octaveLift * 12 < 64 && octaveLift < 3) octaveLift += 1;
  }
  const pitched = rawPitched.map(({ onset, duration, pitch }) => {
    if (!octaveLift) return { onset, duration, pitch };
    const parsed = parsePitchDisplay(pitch);
    const lifted = parsed ? `${parsed.letter}${ASCII_ACC[parsed.alteration] ?? ""}${parsed.octave + octaveLift}` : pitch;
    return { onset, duration, pitch: lifted };
  });

  // Build harmonic slots aligned to the meter's beat unit (e.g., 1.5 quarter-beats in 6/8, 1 in 4/4 or 3/4).
  const totalBeats = Math.max(cursor, pitched.reduce((max, n) => Math.max(max, n.onset + n.duration), 0));
  const meterMatch = /^(\d+)\s*\/\s*(\d+)$/.exec(String(timeSig));
  const num = meterMatch ? Number(meterMatch[1]) : 4;
  const den = meterMatch ? Number(meterMatch[2]) : 4;
  const baseBeat = den === 8 && num % 3 === 0 && num >= 6 ? 1.5 : den === 2 ? 2 : 1;
  const slotStep = totalBeats / baseBeat > 16 ? baseBeat * 2 : baseBeat;
  const tonicBass = `${tonic}3`;
  const harmonization = [];
  for (let beat = 0; beat < totalBeats - 1e-6; beat += slotStep) {
    const dur = Math.min(slotStep, Number((totalBeats - beat).toFixed(4)));
    harmonization.push({
      onset: Number(beat.toFixed(4)),
      duration: dur > 0 ? dur : baseBeat,
      bass: tonicBass,
      roman: "I",
    });
  }
  if (!harmonization.length) {
    harmonization.push({ onset: 0, duration: baseBeat, bass: tonicBass, roman: "I" });
  }

  const phrases = [
    {
      name: "Phrase 1",
      start_onset: 0,
      end_onset: pitched[pitched.length - 1].onset,
      expected_cadence: "PAC",
    },
  ];

  const liftNote = octaveLift
    ? ` (Raised ${octaveLift} octave${octaveLift > 1 ? "s" : ""} from bass register into soprano range.)`
    : "";

  return {
    id: "__imported_omr__",
    title: title || "Imported Score Melody",
    subtitle: "Imported from Score to Piano",
    key_tonic: tonic,
    mode,
    key_signature: keySig,
    time_signature: timeSig,
    instructions:
      `Harmonize your scanned melody with functional AP harmony and a strong bass line, or click Auto-Harmonize / Suggest to generate a starting harmonization.${liftNote}`,
    melody: pitched,
    phrases,
    starter: { harmonization: structuredClone(harmonization) },
    sample_attempt: null,
    model_solution: null,
  };
}

/** Normalize a backend issue object into the shape expected by renderGrandStaff & highlightIssue. */
export function normalizeIssueForGrandStaff(issue, index = 0) {
  if (!issue || typeof issue !== "object") return null;
  let chordIndices = [];
  if (Array.isArray(issue.chords)) {
    chordIndices = issue.chords.filter(Number.isInteger);
  } else if (Array.isArray(issue.chordIndices)) {
    chordIndices = issue.chordIndices.filter(Number.isInteger);
  } else if (Number.isInteger(issue.previous_chord_index) && Number.isInteger(issue.chord_index)) {
    chordIndices = [issue.previous_chord_index, issue.chord_index];
  } else if (Number.isInteger(issue.chord_index)) {
    chordIndices = [issue.chord_index];
  } else if (Number.isInteger(issue.chordIndex)) {
    chordIndices = [issue.chordIndex];
  }
  const noteIndex = Number.isInteger(issue.note_index)
    ? issue.note_index
    : Number.isInteger(issue.noteIndex)
      ? issue.noteIndex
      : null;
  return {
    id: issue.id ?? `issue-${index}`,
    issueIndex: index,
    code: issue.rule_id ?? issue.code ?? issue.type ?? "",
    severity: issue.severity || "error",
    message: issue.message || issue.title || "",
    chordIndices,
    voices: Array.isArray(issue.voices) ? issue.voices : [],
    noteIndex,
    explicitNoteIds: noteIndex !== null ? [`melody-${noteIndex}`] : [],
  };
}

/** Normalize a backend audio demo clip whether it arrives as a bare event array or { label, events }. */
export function extractDemoClip(raw, defaultLabel = "") {
  if (Array.isArray(raw)) return { label: defaultLabel, events: normalizeAudioEvents(raw) };
  if (raw && typeof raw === "object" && Array.isArray(raw.events)) {
    return { label: raw.label || defaultLabel, events: normalizeAudioEvents(raw.events) };
  }
  return { label: defaultLabel, events: [] };
}

const CADENCE_LABELS = Object.freeze({
  PAC: "Perfect Authentic Cadence",
  IAC: "Imperfect Authentic Cadence",
  HC: "Half Cadence",
  DC: "Deceptive Cadence",
  PC: "Plagal Cadence",
});

function normalizeCadenceDisplay(grade, chordCount) {
  const detail = grade?.cadence_detail;
  if (detail && typeof detail === "object") return detail;
  const raw = grade?.cadence;
  if (!raw) return null;
  if (typeof raw === "string") {
    return {
      type: raw,
      label: CADENCE_LABELS[raw] || raw,
      valid: true,
      chord_indices: chordCount >= 2 ? [chordCount - 2, chordCount - 1] : [Math.max(0, chordCount - 1)],
    };
  }
  if (typeof raw === "object") return raw;
  return null;
}

/** Convert backend audio_demo event objects (which may use pitch strings or snake_case chord_index) to PianoPlayer events. */
export function normalizeAudioEvents(events) {
  if (!Array.isArray(events)) return [];
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || typeof ev !== "object") continue;
    let midi = ev.midi;
    let spell = ev.spell ?? ev.pitch ?? ev.name;
    if (midi === undefined || midi === null || !Number.isFinite(Number(midi))) {
      const parsed = parsePitchDisplay(spell);
      if (parsed) {
        midi = parsed.midi;
        spell = `${parsed.letter}${ASCII_ACC[parsed.alteration] ?? ""}${parsed.octave}`;
      } else {
        continue;
      }
    } else {
      midi = Math.round(Number(midi));
    }
    const onset = Number.isFinite(Number(ev.onset)) && Number(ev.onset) >= 0 ? Number(ev.onset) : 0;
    const duration = Number.isFinite(Number(ev.duration)) && Number(ev.duration) > 0 ? Number(ev.duration) : 1;
    const item = {
      id: ev.id ?? `demo-${i}`,
      midi,
      onset,
      duration,
      voice: ev.voice,
      chordIndex: Number.isInteger(ev.chordIndex) ? ev.chordIndex : Number.isInteger(ev.chord_index) ? ev.chord_index : undefined,
      gain: ev.gain,
      spell,
    };
    out.push(item);
  }
  return out;
}

/** Convert chord array with string pitches into MIDI-enriched chord objects for buildSatbEvents. */
function chordsForAudio(chords) {
  return (Array.isArray(chords) ? chords : []).map((chord, idx) => {
    const voices = {};
    for (const v of SATB_VOICES) {
      const parsed = parsePitchDisplay(chord?.voices?.[v]);
      if (parsed) {
        voices[v] = {
          id: `satb-${idx}-${v}`,
          midi: parsed.midi,
          spell: `${parsed.letter}${ASCII_ACC[parsed.alteration] ?? ""}${parsed.octave}`,
          display: parsed.display,
        };
      }
    }
    return {
      onset: Number.isFinite(Number(chord?.onset)) ? Number(chord.onset) : idx,
      duration: Number.isFinite(Number(chord?.duration)) && Number(chord.duration) > 0 ? Number(chord.duration) : 1,
      voices,
    };
  });
}

/** Convert melody/harmonization/satbPreview with pitch strings into MIDI-enriched structures for buildMelodyHarmonizationEvents. */
function melodyDataForAudio(melody, harmonization, satbPreview) {
  const mList = (Array.isArray(melody) ? melody : []).map((item, idx) => {
    const parsed = parsePitchDisplay(item?.pitch ?? item?.spell);
    if (!parsed) return null;
    return {
      id: `melody-${idx}`,
      onset: Number.isFinite(Number(item.onset)) ? Number(item.onset) : idx,
      duration: Number.isFinite(Number(item.duration)) && Number(item.duration) > 0 ? Number(item.duration) : 1,
      midi: parsed.midi,
      spell: `${parsed.letter}${ASCII_ACC[parsed.alteration] ?? ""}${parsed.octave}`,
      display: parsed.display,
    };
  }).filter(Boolean);

  const hList = (Array.isArray(harmonization) ? harmonization : []).map((slot, idx) => {
    const parsed = parsePitchDisplay(slot?.bass);
    return {
      chordIndex: idx,
      onset: Number.isFinite(Number(slot?.onset)) ? Number(slot.onset) : idx,
      duration: Number.isFinite(Number(slot?.duration)) && Number(slot.duration) > 0 ? Number(slot.duration) : 1,
      bass: parsed
        ? {
            id: `harm-${idx}-B`,
            midi: parsed.midi,
            spell: `${parsed.letter}${ASCII_ACC[parsed.alteration] ?? ""}${parsed.octave}`,
            display: parsed.display,
          }
        : null,
    };
  });

  const pList = (Array.isArray(satbPreview) ? satbPreview : []).map((slot, idx) => {
    const voices = {};
    for (const v of SATB_VOICES) {
      const parsed = parsePitchDisplay(slot?.voices?.[v]);
      if (parsed) {
        voices[v] = {
          id: `harm-${idx}-${v}`,
          midi: parsed.midi,
          spell: `${parsed.letter}${ASCII_ACC[parsed.alteration] ?? ""}${parsed.octave}`,
          display: parsed.display,
        };
      }
    }
    return {
      onset: Number.isFinite(Number(slot?.onset)) ? Number(slot.onset) : idx,
      duration: Number.isFinite(Number(slot?.duration)) && Number(slot.duration) > 0 ? Number(slot.duration) : 1,
      voices,
    };
  });

  return { mList, hList, pList };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createEl(tag, attrs = {}, text = null) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === "className") el.className = v;
    else if (k === "dataset" && typeof v === "object") {
      for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = dv;
    } else el.setAttribute(k, String(v));
  }
  if (text !== null) el.textContent = text;
  return el;
}

const FALLBACK_EXERCISES = {
  four_part: [
    {
      id: "free-satb-sandbox",
      title: "C Major · Free SATB Sandbox",
      subtitle: "Open Four-Part Chorale",
      exercise_type: "free",
      key_tonic: "C",
      mode: "major",
      key_signature: 0,
      time_signature: "4/4",
      locked_voices: [],
      instructions:
        "Compose a four-part SATB progression directly on the Grand Staff or grid below, then grade for AP Music Theory voice-leading rules.",
      starter: {
        chords: [
          { onset: 0, duration: 1, voices: { S: "E5", A: "G4", T: "C4", B: "C3" }, figure: "", roman: "I" },
          { onset: 1, duration: 1, voices: { S: "F5", A: "A4", T: "C4", B: "F3" }, figure: "", roman: "IV" },
          { onset: 2, duration: 1, voices: { S: "D5", A: "G4", T: "B3", B: "G3" }, figure: "", roman: "V" },
          { onset: 3, duration: 1, voices: { S: "C5", A: "G4", T: "E4", B: "C3" }, figure: "", roman: "I" },
        ],
      },
      sample_attempt: null,
      model_solution: null,
    },
  ],
  melody: [
    {
      id: "free-melody-sandbox",
      title: "C Major · Two-Phrase Melody",
      subtitle: "FRQ 7 · Harmonize a Melody",
      key_tonic: "C",
      mode: "major",
      key_signature: 0,
      time_signature: "4/4",
      instructions:
        "Compose a functional bass line and Roman numeral analysis for the given soprano melody.",
      melody: [
        { onset: 0, duration: 1, pitch: "E5" },
        { onset: 1, duration: 1, pitch: "D5" },
        { onset: 2, duration: 1, pitch: "C5" },
        { onset: 3, duration: 1, pitch: "D5" },
      ],
      phrases: [{ name: "Phrase 1", start_onset: 0, end_onset: 3, expected_cadence: "HC" }],
      starter: {
        harmonization: [
          { onset: 0, duration: 1, bass: "C3", roman: "I" },
          { onset: 1, duration: 1, bass: "G3", roman: "V" },
          { onset: 2, duration: 1, bass: "A3", roman: "vi" },
          { onset: 3, duration: 1, bass: "G3", roman: "V" },
        ],
      },
      sample_attempt: null,
      model_solution: null,
    },
  ],
};

/**
 * Initialize the AP Music Theory Studio (mode tabs, Four-Part Writing, Melody Harmonization, OMR bridge).
 */
export function initTheoryStudio({ player, toast = () => {}, onBeforeTheoryPlay = () => {}, onTabChange = () => {} } = {}) {
  const $ = (id) => document.getElementById(id);

  const tabs = [
    { id: "score", tabEl: $("tabScore"), panelEl: $("scoreWorkspace"), edition: "01 / PIANO" },
    { id: "four-part", tabEl: $("tabFourPart"), panelEl: $("fourPartWorkspace"), edition: "02 / SATB" },
    { id: "melody", tabEl: $("tabMelody"), panelEl: $("melodyWorkspace"), edition: "03 / HARMONIZE" },
  ];

  let activeTab = "score";
  let exercisesLoaded = false;
  let exercisesLoading = false;
  let exercises = { four_part: [], melody: [] };

  // -------------------------------------------------------------------------
  // Four-Part Writing State
  // -------------------------------------------------------------------------
  const fp = {
    exercise: null,
    keyTonic: "C",
    mode: "major",
    timeSignature: "4/4",
    exerciseType: "figured_bass",
    lockedVoices: new Set(["B"]),
    unlockOverride: false,
    chords: [],
    activeVoice: "S",
    selectedChord: 0,
    grade: null,
    focusedIssueId: null,
    worksheet: null,
    viewMode: "engraved", // "worksheet" | "engraved"
    uploading: false,
    loop: false,
    busy: false,
    exporting: false,
    phaseLabel: "Ready",
    revision: 0,
    playToken: 0,
  };

  // -------------------------------------------------------------------------
  // Melody Harmonization State
  // -------------------------------------------------------------------------
  const mel = {
    exercise: null,
    importedExercise: null,
    keyTonic: "C",
    mode: "major",
    timeSignature: "4/4",
    melody: [],
    phrases: [],
    harmonization: [],
    satbPreview: [],
    suggestedHarmonization: null,
    suggestedSatbPreview: null,
    selectedSlot: 0,
    selectedMelodyNote: null,
    showSatbPreview: false,
    playMode: "outer", // "melody" | "outer" | "satb"
    gradeFromOnset: 0,
    grade: null,
    focusedIssueId: null,
    worksheet: null,
    viewMode: "engraved", // "worksheet" | "engraved"
    editTarget: "bass", // "bass" | "melody"
    uploading: false,
    busy: false,
    exporting: false,
    phaseLabel: "Ready",
    revision: 0,
    playToken: 0,
  };

  function ensureSelectOption(selectEl, value, label = value) {
    if (!selectEl || value === null || value === undefined || value === "") return;
    const strVal = String(value);
    const exists = [...selectEl.options].some((opt) => opt.value === strVal);
    if (!exists) {
      selectEl.add(new Option(String(label || strVal).replace(/#/g, "♯").replace(/b/g, "♭"), strVal));
    }
  }

  // -------------------------------------------------------------------------
  // Shared PianoPlayer Controllers (one per theory workspace)
  // -------------------------------------------------------------------------
  const fpController = new TheoryAudioController({
    player,
    tempo: 78,
    onActiveEvents: (events) => {
      highlightActiveNotes($("fpGrandStaffSvg"), events);
      highlightWorksheetActiveNotes($("fpWorksheetSvg"), events);
    },
    onPhaseChange: (phase) => {
      updateFpPhase(phase);
    },
    onState: (status) => {
      updateFpTransportUI(status);
      if (status === "stopped") {
        highlightActiveNotes($("fpGrandStaffSvg"), []);
        highlightWorksheetActiveNotes($("fpWorksheetSvg"), []);
        setFpPhaseText("Ready");
      }
    },
  });

  const melController = new TheoryAudioController({
    player,
    tempo: 82,
    onActiveEvents: (events) => {
      highlightActiveNotes($("melGrandStaffSvg"), events);
      highlightWorksheetActiveNotes($("melWorksheetSvg"), events);
    },
    onPhaseChange: (phase) => {
      updateMelPhase(phase);
    },
    onState: (status) => {
      updateMelTransportUI(status);
      if (status === "stopped") {
        highlightActiveNotes($("melGrandStaffSvg"), []);
        highlightWorksheetActiveNotes($("melWorksheetSvg"), []);
        setMelPhaseText("Ready");
      }
    },
  });

  function stopTheoryPlayback() {
    fp.playToken += 1;
    mel.playToken += 1;
    if (fpController.state !== "stopped") fpController.stop();
    if (melController.state !== "stopped") melController.stop();
    highlightActiveNotes($("fpGrandStaffSvg"), []);
    highlightWorksheetActiveNotes($("fpWorksheetSvg"), []);
    highlightActiveNotes($("melGrandStaffSvg"), []);
    highlightWorksheetActiveNotes($("melWorksheetSvg"), []);
    updateFpTransportUI("stopped");
    updateMelTransportUI("stopped");
    setFpPhaseText("Ready");
    setMelPhaseText("Ready");
  }

  function prepareForFpPlay() {
    onBeforeTheoryPlay();
    if (melController.state !== "stopped") melController.stop();
    updateMelTransportUI("stopped");
    highlightActiveNotes($("melGrandStaffSvg"), []);
    highlightWorksheetActiveNotes($("melWorksheetSvg"), []);
  }

  function prepareForMelPlay() {
    onBeforeTheoryPlay();
    if (fpController.state !== "stopped") fpController.stop();
    updateFpTransportUI("stopped");
    highlightActiveNotes($("fpGrandStaffSvg"), []);
    highlightWorksheetActiveNotes($("fpWorksheetSvg"), []);
  }

  // -------------------------------------------------------------------------
  // Tab Switching
  // -------------------------------------------------------------------------
  function switchTab(tabId, { focusTab = false } = {}) {
    if (!tabs.some((t) => t.id === tabId)) return;
    if (activeTab !== tabId) {
      onBeforeTheoryPlay();
      stopTheoryPlayback();
    }
    activeTab = tabId;
    for (const item of tabs) {
      const selected = item.id === tabId;
      item.tabEl?.classList.toggle("active", selected);
      item.tabEl?.setAttribute("aria-selected", String(selected));
      item.tabEl?.setAttribute("tabindex", selected ? "0" : "-1");
      if (item.panelEl) item.panelEl.hidden = !selected;
      if (selected && focusTab) item.tabEl?.focus();
    }
    const editionSpan = document.querySelector(".edition span");
    const activeEntry = tabs.find((t) => t.id === tabId);
    if (editionSpan && activeEntry) editionSpan.textContent = activeEntry.edition;

    if (tabId !== "score" && !exercisesLoaded && !exercisesLoading) {
      loadExercises();
    }
    onTabChange(tabId);
  }

  for (const item of tabs) {
    item.tabEl?.addEventListener("click", () => switchTab(item.id));
    item.tabEl?.addEventListener("keydown", (e) => {
      const idx = tabs.findIndex((t) => t.id === item.id);
      if (e.key === "ArrowRight") {
        e.preventDefault();
        switchTab(tabs[(idx + 1) % tabs.length].id, { focusTab: true });
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        switchTab(tabs[(idx - 1 + tabs.length) % tabs.length].id, { focusTab: true });
      } else if (e.key === "Home") {
        e.preventDefault();
        switchTab(tabs[0].id, { focusTab: true });
      } else if (e.key === "End") {
        e.preventDefault();
        switchTab(tabs[tabs.length - 1].id, { focusTab: true });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Exercise Loading (GET /api/theory/exercises)
  // -------------------------------------------------------------------------
  async function loadExercises() {
    if (exercisesLoading) return;
    exercisesLoading = true;
    try {
      const res = await fetch("/api/theory/exercises", { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Could not load theory exercises (${res.status})`);
      const data = await res.json();
      exercises = {
        four_part: Array.isArray(data.four_part) && data.four_part.length ? data.four_part : FALLBACK_EXERCISES.four_part,
        melody: Array.isArray(data.melody) && data.melody.length ? data.melody : FALLBACK_EXERCISES.melody,
      };
      exercisesLoaded = true;
      setFpNotice("");
      setMelNotice("");
    } catch (err) {
      exercises = structuredClone(FALLBACK_EXERCISES);
      setFpNotice("Loaded offline sandbox exercises. Start the AP Theory backend to grade progressions.", "error");
      setMelNotice("Loaded offline sandbox exercises. Start the AP Theory backend to grade harmonizations.", "error");
    } finally {
      exercisesLoading = false;
      populateFpExerciseSelect();
      populateMelExerciseSelect();
      if (!fp.exercise && exercises.four_part.length) {
        selectFpExercise(exercises.four_part[0].id);
      }
      if (!mel.exercise && exercises.melody.length) {
        selectMelExercise(exercises.melody[0].id);
      }
    }
  }

  // =========================================================================
  // SECTION A: FOUR-PART WRITING STUDIO (SATB)
  // =========================================================================
  function setFpNotice(message, type = "") {
    const el = $("fpNotice");
    if (!el) return;
    el.textContent = message;
    el.className = `notice ${type}`.trim();
    el.hidden = !message;
  }

  function setFpPhaseText(text, tone = "") {
    fp.phaseLabel = text;
    const pill = $("fpPlaybackPhase");
    if (!pill) return;
    pill.textContent = text;
    pill.className = `phase-pill${tone ? ` phase-${tone}` : ""}`;
  }

  function updateFpPhase(phase) {
    if (phase === "before") {
      setFpPhaseText("Comparing: YOUR VERSION", "before");
    } else if (phase === "after") {
      setFpPhaseText("Comparing: CORRECTED FIX", "after");
    } else if (phase === "isolated") {
      setFpPhaseText(fp.customPhaseLabel || "Playing isolated voices", "isolated");
    } else if (phase === "context") {
      setFpPhaseText(fp.customPhaseLabel || "Playing in 4-part context", "context");
    } else if (fpController.state === "playing") {
      setFpPhaseText(describeFpMix(), "playing");
    }
  }

  function describeFpMix() {
    if (fpController.soloVoice) return `Solo: ${VOICE_LABELS[fpController.soloVoice]}`;
    const active = SATB_VOICES.filter((v) => !fpController.mutedVoices.has(v));
    if (active.length === 4) return fpController.arpeggiate ? "Playing rolled SATB" : "Playing full SATB";
    if (active.length === 2 && active.includes("S") && active.includes("B")) return "Playing Outer Voices (S+B)";
    if (active.length === 2 && active.includes("A") && active.includes("T")) return "Playing Inner Voices (A+T)";
    if (!active.length) return "All voices muted";
    return `Playing ${active.join(" + ")}`;
  }

  function updateFpTransportUI(status) {
    const icon = $("fpPlayIcon");
    const label = $("fpPlayLabel");
    if (icon) icon.textContent = status === "playing" ? "Ⅱ" : "▶";
    if (label) label.textContent = status === "playing" ? "Pause" : status === "paused" ? "Resume" : "Play SATB";
  }

  function populateFpExerciseSelect() {
    const sel = $("fpExerciseSelect");
    if (!sel) return;
    sel.replaceChildren();
    for (const ex of exercises.four_part) {
      const label = ex.subtitle ? `${ex.title} — ${ex.subtitle}` : ex.title;
      sel.add(new Option(label, ex.id));
    }
    if (fp.worksheet) {
      sel.add(new Option(`★ ${fp.worksheet.filename} — Uploaded Worksheet`, "__worksheet_fp__"));
    }
    if (fp.exercise) sel.value = fp.exercise.id;
  }

  function normalizeChordList(rawChords, { preserveMissing = false } = {}) {
    let cursor = 0;
    return (Array.isArray(rawChords) ? rawChords : []).map((c, idx) => {
      const duration = Number.isFinite(Number(c?.duration)) && Number(c.duration) > 0 ? Number(c.duration) : 1;
      const onset = Number.isFinite(Number(c?.onset)) && Number(c.onset) >= 0 ? Number(c.onset) : cursor;
      cursor = Math.max(cursor, onset + duration);
      const voiceCoordsRaw = c?.voice_coords ?? c?.voiceCoords;
      const voice_coords = voiceCoordsRaw && typeof voiceCoordsRaw === "object"
        ? structuredClone(voiceCoordsRaw)
        : undefined;
      const voices = {};
      for (const v of SATB_VOICES) {
        const rawPitch = c?.voices?.[v];
        const parsed = normalizeAsciiPitch(rawPitch);
        const isMissing = !parsed && (preserveMissing || Boolean(voice_coords?.[v]?.missing));
        voices[v] = parsed || (isMissing ? null : VOICE_DEFAULTS[v]);
      }
      const givenBass = normalizeAsciiPitch(c?.given_bass ?? c?.givenBass) || null;
      const row = {
        index: Number.isInteger(c?.index) ? c.index : idx,
        onset,
        duration,
        voices,
        figure: c?.figure ?? c?.figured_bass ?? "",
        roman: c?.roman ?? c?.roman_numeral ?? "",
        given_bass: givenBass,
      };
      if (Number.isInteger(c?.system_index)) row.system_index = c.system_index;
      if (Number.isFinite(Number(c?.x))) row.x = Number(c.x);
      if (Number.isFinite(Number(c?.measure))) row.measure = Number(c.measure);
      if (voice_coords) row.voice_coords = voice_coords;
      if (Number.isFinite(Number(c?.figure_y))) row.figure_y = Number(c.figure_y);
      if (Number.isFinite(Number(c?.roman_y))) row.roman_y = Number(c.roman_y);
      return row;
    });
  }

  function markFpVoiceManual(chord, voice) {
    if (!chord || !voice) return;
    if (!chord.voice_coords || typeof chord.voice_coords !== "object") {
      chord.voice_coords = {};
    }
    const existing = chord.voice_coords[voice] && typeof chord.voice_coords[voice] === "object"
      ? chord.voice_coords[voice]
      : {};
    chord.voice_coords[voice] = {
      ...existing,
      staff: voice === "S" || voice === "A" ? "treble" : "bass",
      source: "manual",
      confidence: 1,
      missing: false,
    };
  }

  function markFpDirty() {
    fp.revision += 1;
    fp.grade = null;
    fp.focusedIssueId = null;
  }

  function selectFpExercise(exerciseId, variant = "starter") {
    if (exerciseId === "__worksheet_fp__" && fp.worksheet) return;
    const ex = exercises.four_part.find((item) => item.id === exerciseId) || exercises.four_part[0];
    if (!ex) return;
    stopTheoryPlayback();
    fp.revision += 1;
    const hadWorksheet = Boolean(fp.worksheet);
    fp.worksheet = null;
    fp.viewMode = "engraved";
    fp.exercise = ex;
    fp.keyTonic = ex.key_tonic || "C";
    fp.mode = ex.mode || "major";
    fp.timeSignature = ex.time_signature || "4/4";
    fp.exerciseType = ex.exercise_type || "free";
    fp.lockedVoices = new Set(Array.isArray(ex.locked_voices) ? ex.locked_voices : []);
    fp.unlockOverride = false;
    if ($("fpUnlockVoices")) $("fpUnlockVoices").checked = false;
    if (hadWorksheet) populateFpExerciseSelect();

    const source =
      variant === "attempt" && ex.sample_attempt?.chords
        ? ex.sample_attempt.chords
        : variant === "solution" && ex.model_solution?.chords
          ? ex.model_solution.chords
          : ex.starter?.chords || [];
    fp.chords = normalizeChordList(source);
    fp.selectedChord = 0;
    fp.grade = null;
    fp.focusedIssueId = null;

    // Pick first unlocked voice as active voice
    if (fp.lockedVoices.has(fp.activeVoice)) {
      fp.activeVoice = SATB_VOICES.find((v) => !fp.lockedVoices.has(v)) || "S";
    }

    syncFpSetupControls();
    renderFpAll();
    if (variant === "attempt" && ex.sample_attempt?.description) {
      setFpNotice(`Loaded sample student draft: ${ex.sample_attempt.description}. Click "Grade Four-Part Writing" to inspect and hear the errors.`);
    } else if (variant === "solution") {
      setFpNotice("Loaded AP model solution. Play it back or grade it to verify a clean 100/100 score.");
    } else {
      setFpNotice("");
    }
  }

  function isFpVoiceLocked(voice) {
    return !fp.unlockOverride && fp.lockedVoices.has(voice);
  }

  function syncFpViewMode() {
    const hasWs = Boolean(fp.worksheet);
    const showWorksheet = hasWs && fp.viewMode === "worksheet";
    if ($("fpViewToggle")) $("fpViewToggle").hidden = !hasWs;
    if ($("fpWorksheetWrap")) $("fpWorksheetWrap").hidden = !showWorksheet;
    if ($("fpGrandStaffWrap")) $("fpGrandStaffWrap").hidden = showWorksheet;
    if ($("fpViewWorksheet")) {
      $("fpViewWorksheet").classList.toggle("active", showWorksheet);
      $("fpViewWorksheet").setAttribute("aria-pressed", String(showWorksheet));
    }
    if ($("fpViewEngraved")) {
      $("fpViewEngraved").classList.toggle("active", !showWorksheet);
      $("fpViewEngraved").setAttribute("aria-pressed", String(!showWorksheet));
    }
  }

  function syncFpWorksheetUI() {
    const ws = fp.worksheet;
    $("fpDropzone")?.classList.toggle("loading", fp.uploading);
    const info = $("fpWorksheetInfo");
    if (info) {
      info.hidden = !ws;
      if (ws) {
        const pageTag = ws.pages > 1 ? ` · page ${ws.page}/${ws.pages}` : "";
        info.textContent = `${ws.filename}${pageTag} · ${fp.chords.length} chords`;
      }
    }
    const pageWrap = $("fpWorksheetPageWrap");
    if (pageWrap) {
      const multiPage = Boolean(ws && ws.pages > 1);
      pageWrap.hidden = !multiPage;
      if (multiPage) {
        const sel = $("fpWorksheetPageSelect");
        if (sel) {
          if (sel.options.length !== ws.pages) {
            sel.replaceChildren();
            for (let p = 1; p <= ws.pages; p++) {
              sel.add(new Option(`Page ${p} of ${ws.pages}`, String(p)));
            }
          }
          sel.value = String(ws.page);
          sel.disabled = fp.uploading;
        }
        if ($("fpWorksheetPrevPage")) $("fpWorksheetPrevPage").disabled = fp.uploading || ws.page <= 1;
        if ($("fpWorksheetNextPage")) $("fpWorksheetNextPage").disabled = fp.uploading || ws.page >= ws.pages;
      }
    }
    if ($("fpClearWorksheet")) {
      $("fpClearWorksheet").hidden = !ws;
      $("fpClearWorksheet").disabled = fp.uploading;
    }
    syncFpViewMode();
  }

  function syncFpSetupControls() {
    const ex = fp.exercise;
    ensureSelectOption($("fpKeyTonic"), fp.keyTonic);
    ensureSelectOption($("fpTimeSig"), fp.timeSignature);
    if ($("fpExerciseSelect") && ex) $("fpExerciseSelect").value = ex.id;
    if ($("fpKeyTonic")) $("fpKeyTonic").value = fp.keyTonic;
    if ($("fpKeyMode")) $("fpKeyMode").value = fp.mode;
    if ($("fpTimeSig")) $("fpTimeSig").value = fp.timeSignature;
    if ($("fpExerciseType")) $("fpExerciseType").value = fp.exerciseType;

    const canEditParams = Boolean(fp.worksheet) || fp.exerciseType === "free" || fp.unlockOverride;
    if ($("fpKeyTonic")) $("fpKeyTonic").disabled = !canEditParams;
    if ($("fpKeyMode")) $("fpKeyMode").disabled = !canEditParams;
    if ($("fpTimeSig")) $("fpTimeSig").disabled = !canEditParams;

    if ($("fpLoadAttempt")) $("fpLoadAttempt").disabled = !ex?.sample_attempt?.chords;
    if ($("fpLoadSolution")) $("fpLoadSolution").disabled = !ex?.model_solution?.chords;
    if ($("fpRemoveChord")) $("fpRemoveChord").disabled = fp.chords.length <= 2;

    if ($("fpTitle")) $("fpTitle").textContent = ex?.title || "Four-Part Writing Studio";
    if ($("fpKeyPill")) {
      $("fpKeyPill").textContent = `${formatKeyLabel(fp.keyTonic, fp.mode)} · ${fp.timeSignature}`;
    }
    if ($("fpInstructions")) {
      $("fpInstructions").textContent = ex?.instructions || "Write four-part SATB harmony following AP Music Theory voice-leading conventions.";
    }
    const badges = $("fpLockedBadges");
    if (badges) {
      badges.replaceChildren();
      if (fp.lockedVoices.size) {
        for (const v of fp.lockedVoices) {
          badges.append(
            createEl(
              "span",
              { className: `lock-badge${fp.unlockOverride ? " unlocked" : ""}` },
              `${fp.unlockOverride ? "🔓" : "🔒"} Given ${VOICE_LABELS[v] || v}`,
            ),
          );
        }
      } else {
        badges.append(createEl("span", { className: "lock-badge unlocked" }, "All 4 voices editable"));
      }
    }
    syncFpWorksheetUI();
  }

  function renderFpStaff() {
    const svg = $("fpGrandStaffSvg");
    const wsSvg = $("fpWorksheetSvg");
    if (!svg && !wsSvg) return;
    const keySig = keySignatureFromTonicMode(fp.keyTonic, fp.mode);
    const normalizedIssues = (fp.grade?.issues || []).map((iss, idx) => normalizeIssueForGrandStaff(iss, idx)).filter(Boolean);
    const cadenceObj = normalizeCadenceDisplay(fp.grade, fp.chords.length);
    const cadenceIdx = cadenceObj?.chord_indices?.at(-1);
    const cadenceLabel = cadenceObj ? (cadenceObj.type || cadenceObj.label || null) : null;

    if (svg) {
      const chordsModel = fp.chords.map((c, idx) => {
        const graded = fp.grade?.chords?.[idx];
        const romanText = c.roman || graded?.roman || graded?.roman_numeral || graded?.detected_roman || "";
        return {
          onset: c.onset,
          duration: c.duration,
          roman: romanText,
          figuredBass: c.figure || "",
          cadence: cadenceIdx === idx ? cadenceLabel : null,
          voices: Object.fromEntries(
            SATB_VOICES.map((v) => [v, { spell: c.voices[v] || "", locked: isFpVoiceLocked(v) }]),
          ),
        };
      });

      renderGrandStaff(
        svg,
        {
          mode: "four-part",
          title: fp.exercise?.title || "Four-Part SATB Grand Staff",
          keySignature: keySig,
          timeSignature: fp.timeSignature,
          chords: chordsModel,
          issues: normalizedIssues,
          selection: { chordIndex: fp.selectedChord, voice: fp.activeVoice },
        },
        {
          editable: true,
          onStaffClick: ({ chordIndex, spell }) => {
            if (chordIndex < 0 || chordIndex >= fp.chords.length) return;
            if (isFpVoiceLocked(fp.activeVoice)) {
              toast(`${VOICE_LABELS[fp.activeVoice]} is locked for this exercise. Select another voice or enable "Unlock given voices".`);
              return;
            }
            fp.selectedChord = chordIndex;
            fp.chords[chordIndex].voices[fp.activeVoice] = spell;
            markFpVoiceManual(fp.chords[chordIndex], fp.activeVoice);
            markFpDirty();
            renderFpAll();
            auditionFpChord(chordIndex);
          },
          onSelectNote: ({ chordIndex, voice }) => {
            if (chordIndex < 0 || chordIndex >= fp.chords.length) return;
            fp.selectedChord = chordIndex;
            if (SATB_VOICES.includes(voice)) fp.activeVoice = voice;
            renderFpToolbar();
            renderFpStaff();
            renderFpGrid();
            auditionFpChord(chordIndex);
          },
        },
      );

      if (fp.focusedIssueId !== null) {
        highlightIssue(svg, fp.focusedIssueId);
      }
    }

    if (wsSvg && fp.worksheet) {
      const wsChords = fp.chords.map((c, idx) => {
        const graded = fp.grade?.chords?.[idx];
        const romanText = c.roman || graded?.roman || graded?.roman_numeral || graded?.detected_roman || "";
        return {
          index: idx,
          system_index: c.system_index,
          onset: c.onset,
          duration: c.duration,
          x: c.x,
          voices: { ...c.voices },
          voice_coords: c.voice_coords || {},
          figure: c.figure || "",
          roman: romanText,
          figure_y: c.figure_y,
          roman_y: c.roman_y,
          cadence: cadenceIdx === idx ? cadenceObj : null,
        };
      });

      renderWorksheetCanvas(
        wsSvg,
        {
          mode: "four-part",
          title: fp.exercise?.title || "Uploaded Four-Part SATB Worksheet",
          width: fp.worksheet.width,
          height: fp.worksheet.height,
          preview: fp.worksheet.preview,
          keySignature: keySig,
          systems: fp.worksheet.systems,
          chords: wsChords,
          issues: normalizedIssues,
          selection: { chordIndex: fp.selectedChord, voice: fp.activeVoice },
        },
        {
          editable: true,
          onSelectNote: ({ chordIndex, voice }) => {
            if (chordIndex < 0 || chordIndex >= fp.chords.length) return;
            fp.selectedChord = chordIndex;
            if (SATB_VOICES.includes(voice)) fp.activeVoice = voice;
            renderFpToolbar();
            renderFpStaff();
            renderFpGrid();
            auditionFpChord(chordIndex);
          },
          onMoveMarker: ({ chordIndex, voice, spell }) => {
            if (chordIndex < 0 || chordIndex >= fp.chords.length || !SATB_VOICES.includes(voice)) return;
            if (isFpVoiceLocked(voice)) {
              toast(`${VOICE_LABELS[voice]} is locked for this worksheet. Enable "Unlock given voices" to edit it.`);
              renderFpStaff();
              return;
            }
            fp.selectedChord = chordIndex;
            fp.activeVoice = voice;
            fp.chords[chordIndex].voices[voice] = spell;
            markFpVoiceManual(fp.chords[chordIndex], voice);
            markFpDirty();
            renderFpAll();
            auditionFpChord(chordIndex);
          },
          onStaffClick: ({ chordIndex, spell }) => {
            if (chordIndex === null || chordIndex === undefined || chordIndex < 0 || chordIndex >= fp.chords.length) return;
            if (isFpVoiceLocked(fp.activeVoice)) {
              toast(`${VOICE_LABELS[fp.activeVoice]} is locked for this worksheet. Select another voice or enable "Unlock given voices".`);
              return;
            }
            fp.selectedChord = chordIndex;
            fp.chords[chordIndex].voices[fp.activeVoice] = spell;
            markFpVoiceManual(fp.chords[chordIndex], fp.activeVoice);
            markFpDirty();
            renderFpAll();
            auditionFpChord(chordIndex);
          },
          onSelectColumnMeta: ({ chordIndex, kind }) => {
            if (chordIndex < 0 || chordIndex >= fp.chords.length) return;
            fp.selectedChord = chordIndex;
            renderFpToolbar();
            renderFpStaff();
            renderFpGrid();
            const targetInput = kind === "figure" ? $("fpFigureInput") : $("fpRomanInput");
            if (targetInput) {
              targetInput.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
              targetInput.focus();
              targetInput.select?.();
            }
          },
        },
      );

      if (fp.focusedIssueId !== null) {
        highlightWorksheetIssue(wsSvg, fp.focusedIssueId);
      }
    }
  }

  function auditionFpChord(chordIndex) {
    const chord = fp.chords[chordIndex];
    if (!chord) return;
    const midis = SATB_VOICES
      .map((v) => parsePitchDisplay(chord.voices[v])?.midi)
      .filter((m) => Number.isFinite(m));
    if (!midis.length) return;
    prepareForFpPlay();
    fpController.auditionChord(midis, { arpeggiate: fpController.arpeggiate }).catch(() => {});
  }

  function renderFpToolbar() {
    for (const v of SATB_VOICES) {
      const btn = $(`fpVoice${v}`);
      if (!btn) continue;
      const locked = isFpVoiceLocked(v);
      btn.classList.toggle("active", fp.activeVoice === v);
      btn.classList.toggle("locked", locked);
      btn.setAttribute("aria-pressed", String(fp.activeVoice === v));
      btn.title = locked ? `${VOICE_LABELS[v]} (locked by exercise)` : `Edit ${VOICE_LABELS[v]}`;
    }

    const chord = fp.chords[fp.selectedChord];
    const locked = isFpVoiceLocked(fp.activeVoice);
    if ($("fpSelectedLabel")) {
      $("fpSelectedLabel").textContent = chord
        ? `Chord ${fp.selectedChord + 1} · ${VOICE_LABELS[fp.activeVoice]}${locked ? " (Locked)" : ""}`
        : "No chord selected";
    }
    const pitchInput = $("fpPitchInput");
    if (pitchInput) {
      pitchInput.value = chord?.voices?.[fp.activeVoice] || "";
      pitchInput.disabled = !chord || locked;
    }
    for (const id of ["fpAccFlat", "fpAccNatural", "fpAccSharp", "fpStepDown", "fpStepUp", "fpOctDown", "fpOctUp"]) {
      if ($(id)) $(id).disabled = !chord || locked;
    }
    if ($("fpRomanInput")) {
      $("fpRomanInput").value = chord?.roman || "";
      $("fpRomanInput").disabled = !chord;
    }
    if ($("fpFigureInput")) {
      $("fpFigureInput").value = chord?.figure || "";
      $("fpFigureInput").disabled = !chord;
    }
  }

  function renderFpGrid() {
    const container = $("fpChordGrid");
    if (!container) return;
    container.replaceChildren();

    const table = createEl("table", { className: "theory-grid-table" });
    const thead = createEl("thead");
    const headRow = createEl("tr");
    headRow.append(createEl("th", { className: "grid-row-head" }, "Voice"));
    fp.chords.forEach((_, idx) => {
      const th = createEl("th", { className: idx === fp.selectedChord ? "selected-col" : "" });
      const btn = createEl("button", { type: "button", className: "col-select-btn" }, `#${idx + 1}`);
      btn.addEventListener("click", () => {
        fp.selectedChord = idx;
        renderFpToolbar();
        renderFpStaff();
        renderFpGrid();
        auditionFpChord(idx);
      });
      th.append(btn);
      headRow.append(th);
    });
    thead.append(headRow);
    table.append(thead);

    const tbody = createEl("tbody");
    for (const v of SATB_VOICES) {
      const tr = createEl("tr");
      const locked = isFpVoiceLocked(v);
      tr.append(
        createEl("td", { className: `grid-row-head voice-tag-${v}` }, `${v}${locked ? " 🔒" : ""}`),
      );
      fp.chords.forEach((chord, idx) => {
        const td = createEl("td", {
          className: idx === fp.selectedChord && fp.activeVoice === v ? "selected-cell" : idx === fp.selectedChord ? "selected-col" : "",
        });
        const input = createEl("input", {
          type: "text",
          className: "grid-pitch-input",
          value: chord.voices[v] || "",
          "aria-label": `Chord ${idx + 1} ${VOICE_LABELS[v]} pitch`,
        });
        if (locked) input.disabled = true;
        input.addEventListener("focus", () => {
          fp.selectedChord = idx;
          fp.activeVoice = v;
          renderFpToolbar();
        });
        input.addEventListener("change", () => {
          const parsed = normalizeAsciiPitch(input.value);
          if (!parsed) {
            input.value = chord.voices[v] || "";
            toast("Enter a pitch like E4, F#4, or Bb3.");
            return;
          }
          chord.voices[v] = parsed;
          markFpVoiceManual(chord, v);
          markFpDirty();
          renderFpAll();
          auditionFpChord(idx);
        });
        td.append(input);
        tr.append(td);
      });
      tbody.append(tr);
    }

    // Roman numeral row
    const romanTr = createEl("tr");
    romanTr.append(createEl("td", { className: "grid-row-head" }, "RN"));
    fp.chords.forEach((chord, idx) => {
      const td = createEl("td", { className: idx === fp.selectedChord ? "selected-col" : "" });
      const input = createEl("input", {
        type: "text",
        className: "grid-meta-input",
        value: chord.roman || "",
        placeholder: "I, V7",
        "aria-label": `Chord ${idx + 1} Roman numeral`,
      });
      input.addEventListener("change", () => {
        chord.roman = input.value.trim();
        fp.grade = null;
        renderFpStaff();
        renderFpToolbar();
      });
      td.append(input);
      romanTr.append(td);
    });
    tbody.append(romanTr);

    // Figured bass row
    const figTr = createEl("tr");
    figTr.append(createEl("td", { className: "grid-row-head" }, "Fig"));
    fp.chords.forEach((chord, idx) => {
      const td = createEl("td", { className: idx === fp.selectedChord ? "selected-col" : "" });
      const input = createEl("input", {
        type: "text",
        className: "grid-meta-input",
        value: chord.figure || "",
        placeholder: "6, 6/4",
        "aria-label": `Chord ${idx + 1} figured bass`,
      });
      input.addEventListener("change", () => {
        chord.figure = input.value.trim();
        fp.grade = null;
        renderFpStaff();
        renderFpToolbar();
      });
      td.append(input);
      figTr.append(td);
    });
    tbody.append(figTr);

    table.append(tbody);
    container.append(table);
  }

  function renderFpMixer() {
    for (const v of SATB_VOICES) {
      const soloBtn = document.querySelector(`[data-mixer-solo="${v}"]`);
      const muteBtn = document.querySelector(`[data-mixer-mute="${v}"]`);
      if (soloBtn) {
        const isSolo = fpController.soloVoice === v;
        soloBtn.classList.toggle("active", isSolo);
        soloBtn.setAttribute("aria-pressed", String(isSolo));
      }
      if (muteBtn) {
        const isMuted = fpController.mutedVoices.has(v);
        muteBtn.classList.toggle("active", isMuted);
        muteBtn.setAttribute("aria-pressed", String(isMuted));
      }
    }
    const muted = fpController.mutedVoices;
    const solo = fpController.soloVoice;
    $("fpPresetAll")?.classList.toggle("active", !solo && muted.size === 0);
    $("fpPresetOuter")?.classList.toggle("active", !solo && muted.size === 2 && muted.has("A") && muted.has("T"));
    $("fpPresetInner")?.classList.toggle("active", !solo && muted.size === 2 && muted.has("S") && muted.has("B"));
  }

  function renderFpResults() {
    const container = $("fpResults");
    if (!container) return;
    container.replaceChildren();

    if (!fp.grade) {
      const empty = createEl("div", { className: "results-empty" });
      empty.append(
        createEl("p", { className: "eyebrow" }, "AP THEORY RUBRIC & AUDIO DIAGNOSTICS"),
        createEl("h3", {}, "Ready to grade your four-part writing."),
        createEl(
          "p",
          { className: "muted" },
          "Click Grade Four-Part Writing above to check harmonic spelling, parallel 5ths/8ves, tendency-tone resolutions, spacing, doubling, and cadences — with isolated audio comparisons for every issue.",
        ),
      );
      container.append(empty);
      return;
    }

    const { summary = {}, issues = [] } = fp.grade;
    const cadenceObj = normalizeCadenceDisplay(fp.grade, fp.chords.length);
    container.append(buildScoreSummaryCard(summary, cadenceObj));
    container.append(
      buildIssuesList({
        issues,
        svg: $("fpGrandStaffSvg"),
        focusedId: fp.focusedIssueId,
        onFocus: (issueId) => {
          fp.focusedIssueId = fp.focusedIssueId === issueId ? null : issueId;
          highlightIssue($("fpGrandStaffSvg"), fp.focusedIssueId);
          highlightWorksheetIssue($("fpWorksheetSvg"), fp.focusedIssueId);
          updateFocusedIssueCards(container, fp.focusedIssueId);
        },
        onPlayIsolated: async (issue, rawClip) => {
          const clip = extractDemoClip(rawClip, "Isolated voices");
          if (!clip.events.length) return toast("No isolated audio clip available for this issue.");
          prepareForFpPlay();
          fp.focusedIssueId = issue.id;
          highlightIssue($("fpGrandStaffSvg"), issue.id);
          highlightWorksheetIssue($("fpWorksheetSvg"), issue.id);
          updateFocusedIssueCards(container, issue.id);
          fp.customPhaseLabel = clip.label ? `Playing: ${clip.label}` : "Playing isolated voices";
          const slowTempo = Math.max(54, fpController.tempo - 16);
          try {
            await fpController.playIsolatedDemo(clip.events, slowTempo);
          } catch (err) {
            toast(err.message);
          }
        },
        onPlayContext: async (issue, rawClip) => {
          const clip = extractDemoClip(rawClip, "4-part context");
          if (!clip.events.length) return toast("No context audio clip available for this issue.");
          prepareForFpPlay();
          fp.focusedIssueId = issue.id;
          highlightIssue($("fpGrandStaffSvg"), issue.id);
          highlightWorksheetIssue($("fpWorksheetSvg"), issue.id);
          updateFocusedIssueCards(container, issue.id);
          fp.customPhaseLabel = clip.label ? `Playing: ${clip.label}` : "Playing in 4-part context";
          try {
            await fpController.playContextDemo(clip.events, fpController.tempo);
          } catch (err) {
            toast(err.message);
          }
        },
        onPlayCompare: async (issue, fc) => {
          const beforeEvents = normalizeAudioEvents(fc?.before_events ?? fc?.beforeEvents ?? []);
          const afterEvents = normalizeAudioEvents(fc?.after_events ?? fc?.afterEvents ?? []);
          if (!beforeEvents.length || !afterEvents.length) return toast("No before/after audio comparison available.");
          prepareForFpPlay();
          fp.focusedIssueId = issue.id;
          highlightIssue($("fpGrandStaffSvg"), issue.id);
          highlightWorksheetIssue($("fpWorksheetSvg"), issue.id);
          updateFocusedIssueCards(container, issue.id);
          const slowTempo = Math.max(56, fpController.tempo - 12);
          try {
            await fpController.playBeforeAfterComparison({ beforeEvents, afterEvents, gapBeats: 1.5 }, slowTempo);
          } catch (err) {
            toast(err.message);
          }
        },
        onApplyFix: async (issue, fc) => {
          applyFpFix(issue, fc);
        },
        isolatedButtonLabel: "▶ Hear isolated voices",
        contextButtonLabel: "▶ Hear in context",
      }),
    );
  }

  function applyFpFix(issue, fc) {
    const fixedVoices = fc?.fixed_voices ?? fc?.fixedVoices;
    if (!fixedVoices) return;

    // Support either { S, A, T, B } applied to the target chord (last affected chord) or { [chordIndex]: { S, A, T, B } }
    const hasDirectVoiceKeys = SATB_VOICES.some((v) => typeof fixedVoices[v] === "string");
    if (hasDirectVoiceKeys) {
      const targetIdx = Array.isArray(issue.chords) && issue.chords.length
        ? issue.chords[issue.chords.length - 1]
        : Number.isInteger(issue.chord_index)
          ? issue.chord_index
          : fp.selectedChord;
      if (fp.chords[targetIdx]) {
        for (const v of SATB_VOICES) {
          if (fixedVoices[v] && (!isFpVoiceLocked(v) || fp.chords[targetIdx].voices[v] === fixedVoices[v])) {
            const ascii = normalizeAsciiPitch(fixedVoices[v]);
            if (ascii) {
              fp.chords[targetIdx].voices[v] = ascii;
              markFpVoiceManual(fp.chords[targetIdx], v);
            }
          }
        }
        fp.selectedChord = targetIdx;
      }
    } else if (typeof fixedVoices === "object") {
      for (const [k, voiceMap] of Object.entries(fixedVoices)) {
        const idx = Number(k);
        if (Number.isInteger(idx) && fp.chords[idx] && voiceMap && typeof voiceMap === "object") {
          for (const v of SATB_VOICES) {
            if (voiceMap[v]) {
              const ascii = normalizeAsciiPitch(voiceMap[v]);
              if (ascii) {
                fp.chords[idx].voices[v] = ascii;
                markFpVoiceManual(fp.chords[idx], v);
              }
            }
          }
        }
      }
    }
    fp.focusedIssueId = null;
    renderFpAll();
    toast("Applied suggested voice-leading fix. Re-grading…");
    gradeFourPart();
  }

  function renderFpAll() {
    syncFpSetupControls();
    renderFpToolbar();
    renderFpStaff();
    renderFpGrid();
    renderFpMixer();
    renderFpResults();
  }

  async function gradeFourPart() {
    if (!fp.chords.length) return;
    const missingIdx = fp.chords.findIndex((c) => SATB_VOICES.some((v) => !normalizeAsciiPitch(c.voices?.[v])));
    if (missingIdx !== -1) {
      const missingVoice = SATB_VOICES.find((v) => !normalizeAsciiPitch(fp.chords[missingIdx].voices?.[v]));
      fp.selectedChord = missingIdx;
      if (missingVoice) fp.activeVoice = missingVoice;
      renderFpToolbar();
      renderFpStaff();
      renderFpGrid();
      const msg = `Chord ${missingIdx + 1} (${VOICE_LABELS[missingVoice] || missingVoice}) needs a pitch before grading. Click or drag the amber marker on the staff.`;
      setFpNotice(msg, "error");
      toast(msg);
      return;
    }
    const rev = fp.revision;
    fp.busy = true;
    const btn = $("fpGradeButton");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Grading…";
    }
    setFpNotice("Analyzing voice leading, harmonic spelling, spacing, and cadence…", "busy");
    try {
      const effectiveLocks = fp.unlockOverride ? [] : [...fp.lockedVoices];
      const payload = {
        key_tonic: fp.keyTonic,
        mode: fp.mode,
        time_signature: fp.timeSignature,
        exercise_type: fp.exerciseType,
        chords: fp.chords.map((c) => {
          const row = {
            onset: c.onset,
            duration: c.duration,
            voices: { ...c.voices },
            figure: c.figure || "",
            roman: c.roman || "",
          };
          if (fp.exerciseType === "figured_bass" && c.given_bass) {
            row.given_bass = c.given_bass;
          }
          return row;
        }),
        locked_voices: effectiveLocks,
        check_cadence: true,
      };
      const res = await fetch("/api/theory/grade/four-part", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Grading failed (${res.status})`);
      }
      const data = await res.json();
      if (rev !== fp.revision) return;
      fp.grade = data;
      fp.focusedIssueId = null;
      const errCount = fp.grade?.summary?.error_count ?? fp.grade?.issues?.filter((i) => i.severity === "error").length ?? 0;
      const score = fp.grade?.summary?.score;
      setFpNotice(
        errCount === 0
          ? `Clean voice leading! Score: ${score ?? 100}/100.`
          : `Graded: ${score ?? "—"}/100 · ${errCount} ${errCount === 1 ? "error" : "errors"} found. Click any issue below to highlight it on the Grand Staff and hear the audio comparison.`,
      );
      renderFpStaff();
      renderFpResults();
    } catch (err) {
      if (rev !== fp.revision) return;
      setFpNotice(err.message, "error");
      toast(err.message);
    } finally {
      if (rev === fp.revision) {
        fp.busy = false;
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Grade Four-Part Writing";
        }
      }
    }
  }

  async function startFourPart({ fromBeat = 0 } = {}) {
    if (!fp.chords.length) return;
    const token = ++fp.playToken;
    prepareForFpPlay();
    const events = buildSatbEvents(chordsForAudio(fp.chords), fpController.voiceOptions);
    if (!events.length) {
      toast("Unmute at least one SATB voice to play.");
      return;
    }
    fp.customPhaseLabel = "";
    try {
      if (token !== fp.playToken || activeTab !== "four-part") return;
      setFpPhaseText(describeFpMix(), "playing");
      await fpController.playEvents(events, {
        tempo: fpController.tempo,
        transpose: 0,
        mode: "score",
        phase: "score",
        fromBeat,
        loop: fp.loop,
      });
    } catch (err) {
      if (token === fp.playToken) toast(err.message);
    }
  }

  async function playFourPart() {
    if (!fp.chords.length) return;
    if (fpController.state === "playing") {
      fpController.pause();
      return;
    }
    const resumeBeat = fpController.state === "paused" ? fpController.currentBeat : 0;
    await startFourPart({ fromBeat: resumeBeat });
  }

  // Bind Four-Part UI listeners
  $("fpExerciseSelect")?.addEventListener("change", (e) => selectFpExercise(e.target.value, "starter"));
  $("fpLoadStarter")?.addEventListener("click", () => selectFpExercise(fp.exercise?.id, "starter"));
  $("fpLoadAttempt")?.addEventListener("click", () => selectFpExercise(fp.exercise?.id, "attempt"));
  $("fpLoadSolution")?.addEventListener("click", () => selectFpExercise(fp.exercise?.id, "solution"));
  $("fpGradeButton")?.addEventListener("click", gradeFourPart);

  $("fpUnlockVoices")?.addEventListener("change", (e) => {
    fp.unlockOverride = e.target.checked;
    renderFpAll();
  });

  $("fpKeyTonic")?.addEventListener("change", (e) => {
    fp.keyTonic = e.target.value;
    markFpDirty();
    renderFpAll();
  });
  $("fpKeyMode")?.addEventListener("change", (e) => {
    fp.mode = e.target.value;
    markFpDirty();
    renderFpAll();
  });
  $("fpTimeSig")?.addEventListener("change", (e) => {
    fp.timeSignature = e.target.value;
    markFpDirty();
    renderFpAll();
  });
  $("fpExerciseType")?.addEventListener("change", (e) => {
    fp.exerciseType = e.target.value;
    markFpDirty();
    renderFpAll();
  });

  $("fpAddChord")?.addEventListener("click", () => {
    const last = fp.chords[fp.chords.length - 1];
    const nextOnset = last ? last.onset + last.duration : 0;
    const voices = last ? { ...last.voices } : { ...VOICE_DEFAULTS };
    fp.chords.push({ onset: nextOnset, duration: 1, voices, figure: "", roman: "", given_bass: null });
    fp.selectedChord = fp.chords.length - 1;
    markFpDirty();
    renderFpAll();
  });

  $("fpRemoveChord")?.addEventListener("click", () => {
    if (fp.chords.length <= 2) return;
    fp.chords.pop();
    fp.selectedChord = Math.min(fp.selectedChord, fp.chords.length - 1);
    markFpDirty();
    renderFpAll();
  });

  for (const v of SATB_VOICES) {
    $(`fpVoice${v}`)?.addEventListener("click", () => {
      fp.activeVoice = v;
      renderFpToolbar();
      renderFpStaff();
      renderFpGrid();
    });
  }

  function mutateSelectedFpPitch(fn) {
    const chord = fp.chords[fp.selectedChord];
    if (!chord || isFpVoiceLocked(fp.activeVoice)) return;
    const base = chord.voices[fp.activeVoice] || VOICE_DEFAULTS[fp.activeVoice];
    const next = fn(base);
    if (!next) return;
    chord.voices[fp.activeVoice] = next;
    markFpVoiceManual(chord, fp.activeVoice);
    markFpDirty();
    renderFpAll();
    auditionFpChord(fp.selectedChord);
  }

  $("fpPitchInput")?.addEventListener("change", (e) => {
    const ascii = normalizeAsciiPitch(e.target.value);
    if (!ascii) {
      renderFpToolbar();
      toast("Enter a pitch like E4, F#4, or Bb3.");
      return;
    }
    mutateSelectedFpPitch(() => ascii);
  });
  $("fpAccFlat")?.addEventListener("click", () => mutateSelectedFpPitch((p) => setPitchAccidental(p, -1)));
  $("fpAccNatural")?.addEventListener("click", () => mutateSelectedFpPitch((p) => setPitchAccidental(p, 0)));
  $("fpAccSharp")?.addEventListener("click", () => mutateSelectedFpPitch((p) => setPitchAccidental(p, 1)));
  $("fpStepDown")?.addEventListener("click", () =>
    mutateSelectedFpPitch((p) => nudgePitch(p, { diatonic: -1, keySignature: keySignatureFromTonicMode(fp.keyTonic, fp.mode) })),
  );
  $("fpStepUp")?.addEventListener("click", () =>
    mutateSelectedFpPitch((p) => nudgePitch(p, { diatonic: 1, keySignature: keySignatureFromTonicMode(fp.keyTonic, fp.mode) })),
  );
  $("fpOctDown")?.addEventListener("click", () =>
    mutateSelectedFpPitch((p) => nudgePitch(p, { chromatic: -1, keySignature: keySignatureFromTonicMode(fp.keyTonic, fp.mode) })),
  );
  $("fpOctUp")?.addEventListener("click", () =>
    mutateSelectedFpPitch((p) => nudgePitch(p, { chromatic: 1, keySignature: keySignatureFromTonicMode(fp.keyTonic, fp.mode) })),
  );
  $("fpRomanInput")?.addEventListener("change", (e) => {
    const chord = fp.chords[fp.selectedChord];
    if (!chord) return;
    chord.roman = e.target.value.trim();
    fp.grade = null;
    renderFpStaff();
    renderFpGrid();
  });
  $("fpFigureInput")?.addEventListener("change", (e) => {
    const chord = fp.chords[fp.selectedChord];
    if (!chord) return;
    chord.figure = e.target.value.trim();
    fp.grade = null;
    renderFpStaff();
    renderFpGrid();
  });

  // Four-part playback & mixer listeners
  $("fpPlayButton")?.addEventListener("click", playFourPart);
  $("fpStopButton")?.addEventListener("click", () => {
    fpController.stop();
    highlightActiveNotes($("fpGrandStaffSvg"), []);
    highlightWorksheetActiveNotes($("fpWorksheetSvg"), []);
    setFpPhaseText("Ready");
  });
  $("fpLoopButton")?.addEventListener("click", () => {
    fp.loop = !fp.loop;
    $("fpLoopButton")?.setAttribute("aria-pressed", String(fp.loop));
  });
  $("fpRollToggle")?.addEventListener("click", () => {
    const next = !fpController.arpeggiate;
    fpController.setArpeggiate(next, 0.14);
    $("fpRollToggle")?.setAttribute("aria-pressed", String(next));
    $("fpRollToggle")?.classList.toggle("active", next);
    refreshFpPlaybackIfPlaying();
  });
  $("fpTempo")?.addEventListener("change", (e) => {
    const bpm = clamp(Math.round(Number(e.target.value) || 78), 40, 160);
    e.target.value = String(bpm);
    fpController.setTempo(bpm);
  });

  function refreshFpPlaybackIfPlaying() {
    if (fpController.state === "playing") {
      startFourPart({ fromBeat: fpController.currentBeat });
    }
  }

  document.querySelectorAll("[data-mixer-solo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      fpController.toggleSolo(btn.dataset.mixerSolo);
      renderFpMixer();
      refreshFpPlaybackIfPlaying();
    });
  });
  document.querySelectorAll("[data-mixer-mute]").forEach((btn) => {
    btn.addEventListener("click", () => {
      fpController.toggleMute(btn.dataset.mixerMute);
      renderFpMixer();
      refreshFpPlaybackIfPlaying();
    });
  });
  $("fpPresetAll")?.addEventListener("click", () => {
    fpController.setSoloVoice(null);
    fpController.setMutedVoices([]);
    renderFpMixer();
    refreshFpPlaybackIfPlaying();
  });
  $("fpPresetOuter")?.addEventListener("click", () => {
    fpController.setSoloVoice(null);
    fpController.setMutedVoices(["A", "T"]);
    renderFpMixer();
    refreshFpPlaybackIfPlaying();
  });
  $("fpPresetInner")?.addEventListener("click", () => {
    fpController.setSoloVoice(null);
    fpController.setMutedVoices(["S", "B"]);
    renderFpMixer();
    refreshFpPlaybackIfPlaying();
  });

  $("fpMidiButton")?.addEventListener("click", () => {
    try {
      const events = buildSatbEvents(chordsForAudio(fp.chords), fpController.voiceOptions);
      if (!events.length) return toast("No active notes to export.");
      downloadBlob(fpController.exportMidi(events), `staff2audio-satb-${fp.exercise?.id || "chorale"}.mid`);
      toast("SATB MIDI downloaded.");
    } catch (err) {
      toast(err.message);
    }
  });
  $("fpWavButton")?.addEventListener("click", async () => {
    if (fp.exporting) return;
    const btn = $("fpWavButton");
    fp.exporting = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Rendering…";
    }
    try {
      stopTheoryPlayback();
      const events = buildSatbEvents(chordsForAudio(fp.chords), fpController.voiceOptions);
      if (!events.length) throw new Error("No active notes to export.");
      const blob = await fpController.exportWav(events);
      downloadBlob(blob, `staff2audio-satb-${fp.exercise?.id || "chorale"}.wav`);
      toast("SATB piano audio downloaded.");
    } catch (err) {
      toast(err.message);
    } finally {
      fp.exporting = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = "WAV ↓";
      }
    }
  });

  // =========================================================================
  // SECTION B: HARMONIZE A MELODY STUDIO (FRQ 7)
  // =========================================================================
  function setMelNotice(message, type = "") {
    const el = $("melNotice");
    if (!el) return;
    el.textContent = message;
    el.className = `notice ${type}`.trim();
    el.hidden = !message;
  }

  function setMelPhaseText(text, tone = "") {
    mel.phaseLabel = text;
    const pill = $("melPlaybackPhase");
    if (!pill) return;
    pill.textContent = text;
    pill.className = `phase-pill${tone ? ` phase-${tone}` : ""}`;
  }

  function updateMelPhase(phase) {
    if (phase === "before") {
      setMelPhaseText(mel.customBeforeLabel || "Comparing: YOUR HARMONIZATION", "before");
    } else if (phase === "after") {
      setMelPhaseText(mel.customAfterLabel || "Comparing: SUGGESTED / FIX", "after");
    } else if (phase === "isolated") {
      setMelPhaseText(mel.customPhaseLabel || "Playing Soprano + Bass", "isolated");
    } else if (phase === "context") {
      setMelPhaseText(mel.customPhaseLabel || "Playing in 4-part SATB context", "context");
    } else if (melController.state === "playing") {
      const modeText =
        mel.playMode === "melody"
          ? "Playing Melody Only"
          : mel.playMode === "satb"
            ? "Playing Full 4-Part SATB"
            : "Playing Soprano + Bass";
      setMelPhaseText(modeText, "playing");
    }
  }

  function updateMelTransportUI(status) {
    const icon = $("melPlayIcon");
    const label = $("melPlayLabel");
    if (icon) icon.textContent = status === "playing" ? "Ⅱ" : "▶";
    if (label) label.textContent = status === "playing" ? "Pause" : status === "paused" ? "Resume" : "Play";
  }

  function populateMelExerciseSelect() {
    const sel = $("melExerciseSelect");
    if (!sel) return;
    sel.replaceChildren();
    for (const ex of exercises.melody) {
      const label = ex.subtitle ? `${ex.title} — ${ex.subtitle}` : ex.title;
      sel.add(new Option(label, ex.id));
    }
    if (mel.importedExercise) {
      sel.add(new Option(`★ ${mel.importedExercise.title} — Imported from Score`, mel.importedExercise.id));
    }
    if (mel.worksheet) {
      sel.add(new Option(`★ ${mel.worksheet.filename} — Uploaded Worksheet`, "__worksheet_mel__"));
    }
    if (mel.exercise) sel.value = mel.exercise.id;
  }

  function normalizeMelodyNotes(rawMelody) {
    let cursor = 0;
    return (Array.isArray(rawMelody) ? rawMelody : []).map((n, idx) => {
      const duration = Number.isFinite(Number(n?.duration)) && Number(n.duration) > 0 ? Number(n.duration) : 1;
      const onset = Number.isFinite(Number(n?.onset)) && Number(n.onset) >= 0 ? Number(n.onset) : cursor;
      cursor = Math.max(cursor, onset + duration);
      const parsed = normalizeAsciiPitch(n?.pitch ?? n?.spell);
      const row = {
        index: Number.isInteger(n?.index) ? n.index : idx,
        onset,
        duration,
        pitch: parsed || n?.pitch || "C5",
      };
      if (Number.isInteger(n?.system_index)) row.system_index = n.system_index;
      if (Number.isFinite(Number(n?.x))) row.x = Number(n.x);
      if (Number.isFinite(Number(n?.y))) row.y = Number(n.y);
      if (n?.staff) row.staff = n.staff;
      if (n?.source) row.source = n.source;
      if (Number.isFinite(Number(n?.confidence))) row.confidence = Number(n.confidence);
      if (Number.isFinite(Number(n?.measure))) row.measure = Number(n.measure);
      if (typeof n?.missing === "boolean") row.missing = n.missing;
      return row;
    });
  }

  function normalizeHarmonizationSlots(rawSlots, { preserveMissing = false } = {}) {
    let cursor = 0;
    return (Array.isArray(rawSlots) ? rawSlots : []).map((s, idx) => {
      const duration = Number.isFinite(Number(s?.duration)) && Number(s.duration) > 0 ? Number(s.duration) : 1;
      const onset = Number.isFinite(Number(s?.onset)) && Number(s.onset) >= 0 ? Number(s.onset) : cursor;
      cursor = Math.max(cursor, onset + duration);
      const parsedBass = normalizeAsciiPitch(s?.bass);
      const isMissing = !parsedBass && (preserveMissing || Boolean(s?.missing));
      const row = {
        index: Number.isInteger(s?.index) ? s.index : idx,
        onset,
        duration,
        bass: parsedBass || (isMissing ? "" : `${mel.keyTonic}3`),
        roman: s?.roman || "",
      };
      if (Number.isInteger(s?.system_index)) row.system_index = s.system_index;
      if (Number.isFinite(Number(s?.x))) row.x = Number(s.x);
      if (Number.isFinite(Number(s?.y))) row.y = Number(s.y);
      if (s?.staff) row.staff = s.staff;
      if (s?.source) row.source = s.source;
      if (Number.isFinite(Number(s?.confidence))) row.confidence = Number(s.confidence);
      if (Number.isFinite(Number(s?.measure))) row.measure = Number(s.measure);
      if (isMissing) row.missing = true;
      else if (typeof s?.missing === "boolean") row.missing = s.missing;
      if (s?.figure !== undefined) row.figure = s.figure;
      if (Number.isFinite(Number(s?.figure_y))) row.figure_y = Number(s.figure_y);
      if (Number.isFinite(Number(s?.roman_y))) row.roman_y = Number(s.roman_y);
      return row;
    });
  }

  function markMelDirty() {
    mel.revision += 1;
    mel.grade = null;
    mel.satbPreview = [];
    mel.focusedIssueId = null;
  }

  function selectMelExercise(exerciseId, variant = "starter") {
    if (exerciseId === "__worksheet_mel__" && mel.worksheet) return;
    const ex =
      (mel.importedExercise && mel.importedExercise.id === exerciseId ? mel.importedExercise : null) ||
      exercises.melody.find((item) => item.id === exerciseId) ||
      exercises.melody[0];
    if (!ex) return;
    stopTheoryPlayback();
    mel.revision += 1;
    const hadWorksheet = Boolean(mel.worksheet);
    mel.worksheet = null;
    mel.viewMode = "engraved";
    mel.editTarget = "bass";
    mel.selectedMelodyNote = null;
    mel.exercise = ex;
    mel.keyTonic = ex.key_tonic || "C";
    mel.mode = ex.mode || "major";
    mel.timeSignature = ex.time_signature || "4/4";
    mel.gradeFromOnset = Number.isFinite(Number(ex.grade_from_onset)) ? Math.max(0, Number(ex.grade_from_onset)) : 0;
    mel.melody = normalizeMelodyNotes(ex.melody || []);
    mel.phrases = structuredClone(ex.phrases || []);
    if (hadWorksheet) populateMelExerciseSelect();

    const source =
      variant === "attempt" && ex.sample_attempt?.harmonization
        ? ex.sample_attempt.harmonization
        : variant === "solution" && ex.model_solution?.harmonization
          ? ex.model_solution.harmonization
          : ex.starter?.harmonization || [];
    mel.harmonization = normalizeHarmonizationSlots(source);
    mel.satbPreview = [];
    mel.suggestedHarmonization = ex.model_solution?.harmonization ? normalizeHarmonizationSlots(ex.model_solution.harmonization) : null;
    mel.suggestedSatbPreview = null;
    mel.selectedSlot = 0;
    mel.grade = null;
    mel.focusedIssueId = null;

    syncMelSetupControls();
    renderMelAll();
    if (variant === "attempt" && ex.sample_attempt?.description) {
      setMelNotice(`Loaded sample student draft: ${ex.sample_attempt.description}. Grade it to inspect cadences, non-chord tones, and bass counterpoint.`);
    } else if (variant === "solution") {
      setMelNotice("Loaded model AP FRQ 7 harmonization. Toggle Full 4-Part SATB or Grade Harmonization to inspect.");
    } else {
      setMelNotice("");
    }
  }

  function syncMelViewMode() {
    const hasWs = Boolean(mel.worksheet);
    const showWorksheet = hasWs && mel.viewMode === "worksheet";
    if ($("melViewToggle")) $("melViewToggle").hidden = !hasWs;
    if ($("melWorksheetWrap")) $("melWorksheetWrap").hidden = !showWorksheet;
    if ($("melGrandStaffWrap")) $("melGrandStaffWrap").hidden = showWorksheet;
    if ($("melEditTargetWrap")) $("melEditTargetWrap").hidden = !showWorksheet;
    if ($("melViewWorksheet")) {
      $("melViewWorksheet").classList.toggle("active", showWorksheet);
      $("melViewWorksheet").setAttribute("aria-pressed", String(showWorksheet));
    }
    if ($("melViewEngraved")) {
      $("melViewEngraved").classList.toggle("active", !showWorksheet);
      $("melViewEngraved").setAttribute("aria-pressed", String(!showWorksheet));
    }
    if ($("melEditBass")) {
      const bassActive = mel.editTarget !== "melody";
      $("melEditBass").classList.toggle("active", bassActive);
      $("melEditBass").setAttribute("aria-pressed", String(bassActive));
    }
    if ($("melEditMelody")) {
      const melActive = mel.editTarget === "melody";
      $("melEditMelody").classList.toggle("active", melActive);
      $("melEditMelody").setAttribute("aria-pressed", String(melActive));
    }
  }

  function syncMelWorksheetUI() {
    const ws = mel.worksheet;
    $("melDropzone")?.classList.toggle("loading", mel.uploading);
    const info = $("melWorksheetInfo");
    if (info) {
      info.hidden = !ws;
      if (ws) {
        const pageTag = ws.pages > 1 ? ` · page ${ws.page}/${ws.pages}` : "";
        info.textContent = `${ws.filename}${pageTag} · ${mel.melody.length} melody · ${mel.harmonization.length} bass`;
      }
    }
    const pageWrap = $("melWorksheetPageWrap");
    if (pageWrap) {
      const multiPage = Boolean(ws && ws.pages > 1);
      pageWrap.hidden = !multiPage;
      if (multiPage) {
        const sel = $("melWorksheetPageSelect");
        if (sel) {
          if (sel.options.length !== ws.pages) {
            sel.replaceChildren();
            for (let p = 1; p <= ws.pages; p++) {
              sel.add(new Option(`Page ${p} of ${ws.pages}`, String(p)));
            }
          }
          sel.value = String(ws.page);
          sel.disabled = mel.uploading;
        }
        if ($("melWorksheetPrevPage")) $("melWorksheetPrevPage").disabled = mel.uploading || ws.page <= 1;
        if ($("melWorksheetNextPage")) $("melWorksheetNextPage").disabled = mel.uploading || ws.page >= ws.pages;
      }
    }
    if ($("melClearWorksheet")) {
      $("melClearWorksheet").hidden = !ws;
      $("melClearWorksheet").disabled = mel.uploading;
    }
    syncMelViewMode();
  }

  function syncMelSetupControls() {
    const ex = mel.exercise;
    ensureSelectOption($("melKeyTonic"), mel.keyTonic);
    ensureSelectOption($("melTimeSig"), mel.timeSignature);
    if ($("melExerciseSelect") && ex) $("melExerciseSelect").value = ex.id;
    if ($("melLoadAttempt")) $("melLoadAttempt").disabled = !ex?.sample_attempt?.harmonization;
    if ($("melLoadSolution")) $("melLoadSolution").disabled = !ex?.model_solution?.harmonization;
    if ($("melTitle")) $("melTitle").textContent = ex?.title || "Harmonize a Melody";
    if ($("melKeyPill")) $("melKeyPill").textContent = `${formatKeyLabel(mel.keyTonic, mel.mode)} · ${mel.timeSignature}`;
    if ($("melMetaKey")) $("melMetaKey").textContent = formatKeyLabel(mel.keyTonic, mel.mode);
    if ($("melMetaMeter")) $("melMetaMeter").textContent = mel.timeSignature;
    const isCustomOrWorksheet = Boolean(mel.worksheet) || ex?.id === "__imported_omr__";
    if ($("melParamsGrid")) $("melParamsGrid").hidden = !isCustomOrWorksheet;
    if ($("melKeyTonic")) $("melKeyTonic").value = mel.keyTonic;
    if ($("melKeyMode")) $("melKeyMode").value = mel.mode;
    if ($("melTimeSig")) $("melTimeSig").value = mel.timeSignature;
    if ($("melGradeFromInput") && document.activeElement !== $("melGradeFromInput")) {
      $("melGradeFromInput").value = String(mel.gradeFromOnset || 0);
    }
    if ($("melInstructions")) {
      $("melInstructions").textContent = ex?.instructions || "Write a functional bass line and Roman numerals to harmonize the given melody.";
    }
    const goals = $("melPhraseGoals");
    if (goals) {
      goals.replaceChildren();
      for (const p of mel.phrases) {
        const name = p.name || "Phrase";
        const cad = p.expected_cadence || p.cadence || "Cadence";
        goals.append(createEl("span", { className: "phrase-goal-pill" }, `${name} → ${cad}`));
      }
    }
    syncMelWorksheetUI();
  }

  function resolveWorksheetNoteIndex(ev) {
    if (Number.isInteger(ev?.noteIndex)) return ev.noteIndex;
    if (typeof ev?.noteId === "string") {
      const m = /^melody-(\d+)$/.exec(ev.noteId);
      if (m) return Number(m[1]);
    }
    return null;
  }

  function auditionMelNote(noteIdx) {
    const note = mel.melody[noteIdx];
    const parsed = note ? parsePitchDisplay(note.pitch) : null;
    if (!parsed) return;
    prepareForMelPlay();
    melController.auditionChord([parsed.midi], { arpeggiate: false }).catch(() => {});
  }

  function renderMelStaff() {
    const svg = $("melGrandStaffSvg");
    const wsSvg = $("melWorksheetSvg");
    if (!svg && !wsSvg) return;
    const keySig = keySignatureFromTonicMode(mel.keyTonic, mel.mode);
    const analysisByIdx = new Map((mel.grade?.melody_analysis || []).map((item) => [item.index, item]));
    const cadencesByPhrase = new Map((mel.grade?.cadences || []).map((c) => [c.phrase, c]));

    const melodyModel = mel.melody.map((note, idx) => {
      const analysis = analysisByIdx.get(idx);
      const parsed = parsePitchDisplay(note.pitch);
      const isNct = analysis && analysis.classification && analysis.classification !== "chord_tone" && analysis.classification !== "CT";
      return {
        id: `melody-${idx}`,
        index: idx,
        system_index: note.system_index,
        onset: note.onset,
        duration: note.duration,
        pitch: note.pitch,
        spell: note.pitch,
        midi: parsed?.midi,
        x: note.x,
        y: note.y,
        staff: note.staff || "treble",
        source: note.source || "printed",
        confidence: note.confidence,
        missing: note.missing,
        nct: isNct ? analysis.label || analysis.classification : null,
      };
    });

    const harmModel = mel.harmonization.map((slot, idx) => ({
      index: idx,
      chordIndex: idx,
      system_index: slot.system_index,
      onset: slot.onset,
      duration: slot.duration,
      bass: slot.bass,
      roman: slot.roman,
      x: slot.x,
      y: slot.y,
      staff: slot.staff || "bass",
      source: slot.source,
      confidence: slot.confidence,
      missing: slot.missing,
      figure: slot.figure,
      figure_y: slot.figure_y,
      roman_y: slot.roman_y,
    }));

    const phrasesModel = mel.phrases.map((p) => {
      const graded = cadencesByPhrase.get(p.name);
      const cadLabel = graded
        ? `${graded.detected || p.expected_cadence} ${graded.passed ? "✓" : "✕"}`
        : p.expected_cadence || "";
      return {
        startBeat: p.start_onset,
        endBeat: p.end_onset,
        label: p.name || "",
        cadence: cadLabel,
      };
    });

    const normalizedIssues = (mel.grade?.issues || []).map((iss, idx) => normalizeIssueForGrandStaff(iss, idx)).filter(Boolean);

    if (svg) {
      renderGrandStaff(
        svg,
        {
          mode: "melody-harmonize",
          title: mel.exercise?.title || "Melody Harmonization Grand Staff",
          keySignature: keySig,
          timeSignature: mel.timeSignature,
          melody: melodyModel,
          harmonization: harmModel,
          satbPreview: mel.satbPreview,
          showSatbPreview: mel.showSatbPreview,
          phrases: phrasesModel,
          issues: normalizedIssues,
          selection: { chordIndex: mel.selectedSlot, voice: "B" },
        },
        {
          editable: true,
          onStaffClick: ({ chordIndex, spell }) => {
            if (chordIndex < 0 || chordIndex >= mel.harmonization.length) return;
            mel.selectedSlot = chordIndex;
            mel.harmonization[chordIndex].bass = spell;
            mel.harmonization[chordIndex].source = "manual";
            mel.harmonization[chordIndex].confidence = 1;
            mel.harmonization[chordIndex].missing = false;
            markMelDirty();
            renderMelAll();
            auditionMelSlot(chordIndex);
          },
          onSelectNote: ({ chordIndex }) => {
            if (chordIndex >= 0 && chordIndex < mel.harmonization.length) {
              mel.selectedSlot = chordIndex;
              renderMelStaff();
              renderMelSlots();
              auditionMelSlot(chordIndex);
            }
          },
        },
      );

      if (mel.focusedIssueId !== null) {
        highlightIssue(svg, mel.focusedIssueId);
      }
    }

    if (wsSvg && mel.worksheet) {
      const wsPhrases = mel.phrases.map((p) => {
        const graded = cadencesByPhrase.get(p.name);
        return {
          name: p.name || "Phrase",
          start_onset: p.start_onset,
          end_onset: p.end_onset,
          expected_cadence: p.expected_cadence || "",
          cadence: graded ? (graded.detected || p.expected_cadence || "") : undefined,
          passed: graded ? Boolean(graded.passed) : undefined,
        };
      });

      const selection =
        mel.editTarget === "melody" && Number.isInteger(mel.selectedMelodyNote)
          ? { noteIndex: mel.selectedMelodyNote, voice: "S" }
          : { chordIndex: mel.selectedSlot, voice: "B" };

      renderWorksheetCanvas(
        wsSvg,
        {
          mode: "melody",
          title: mel.exercise?.title || "Uploaded Melody Harmonization Worksheet",
          width: mel.worksheet.width,
          height: mel.worksheet.height,
          preview: mel.worksheet.preview,
          keySignature: keySig,
          systems: mel.worksheet.systems,
          melody: melodyModel,
          harmonization: harmModel,
          phrases: wsPhrases,
          gradeFromOnset: mel.gradeFromOnset,
          issues: normalizedIssues,
          selection,
        },
        {
          editable: true,
          onSelectNote: (ev) => {
            const noteIdx = resolveWorksheetNoteIndex(ev);
            if (ev.voice === "S" && noteIdx !== null && noteIdx >= 0 && noteIdx < mel.melody.length) {
              mel.selectedMelodyNote = noteIdx;
              if (Number.isInteger(ev.chordIndex) && ev.chordIndex >= 0 && ev.chordIndex < mel.harmonization.length) {
                mel.selectedSlot = ev.chordIndex;
              }
              renderMelStaff();
              renderMelNumeralChips();
              renderMelSlots();
              auditionMelNote(noteIdx);
              return;
            }
            if (Number.isInteger(ev.chordIndex) && ev.chordIndex >= 0 && ev.chordIndex < mel.harmonization.length) {
              mel.selectedSlot = ev.chordIndex;
              mel.selectedMelodyNote = null;
              renderMelStaff();
              renderMelNumeralChips();
              renderMelSlots();
              auditionMelSlot(ev.chordIndex);
            }
          },
          onMoveMarker: (ev) => {
            const noteIdx = resolveWorksheetNoteIndex(ev);
            if (ev.voice === "B" && Number.isInteger(ev.chordIndex) && ev.chordIndex >= 0 && ev.chordIndex < mel.harmonization.length) {
              mel.selectedSlot = ev.chordIndex;
              mel.harmonization[ev.chordIndex].bass = ev.spell;
              mel.harmonization[ev.chordIndex].source = "manual";
              mel.harmonization[ev.chordIndex].confidence = 1;
              mel.harmonization[ev.chordIndex].missing = false;
              markMelDirty();
              renderMelAll();
              auditionMelSlot(ev.chordIndex);
            } else if (ev.voice === "S" && noteIdx !== null && noteIdx >= 0 && noteIdx < mel.melody.length) {
              mel.selectedMelodyNote = noteIdx;
              mel.melody[noteIdx].pitch = ev.spell;
              mel.melody[noteIdx].source = "manual";
              mel.melody[noteIdx].confidence = 1;
              mel.melody[noteIdx].missing = false;
              markMelDirty();
              renderMelAll();
              auditionMelNote(noteIdx);
            }
          },
          onStaffClick: ({ chordIndex, staff, spell, x, rawX, systemIndex }) => {
            const clickX = Number.isFinite(rawX) ? rawX : x;
            if (staff === "bass") {
              let targetIdx = Number.isInteger(chordIndex) && chordIndex >= 0 && chordIndex < mel.harmonization.length
                ? chordIndex
                : -1;
              if (targetIdx < 0 && mel.harmonization.length) {
                const sameSys = mel.harmonization
                  .map((s, idx) => ({ s, idx }))
                  .filter(({ s }) => !Number.isInteger(systemIndex) || s.system_index === systemIndex);
                const pool = sameSys.length ? sameSys : mel.harmonization.map((s, idx) => ({ s, idx }));
                pool.sort((a, b) => Math.abs((a.s.x ?? 0) - clickX) - Math.abs((b.s.x ?? 0) - clickX));
                targetIdx = pool[0].idx;
              }
              if (targetIdx < 0) return;
              mel.selectedSlot = targetIdx;
              mel.harmonization[targetIdx].bass = spell;
              mel.harmonization[targetIdx].source = "manual";
              mel.harmonization[targetIdx].confidence = 1;
              mel.harmonization[targetIdx].missing = false;
              markMelDirty();
              renderMelAll();
              auditionMelSlot(targetIdx);
            } else if (staff === "treble") {
              if (mel.editTarget !== "melody") {
                toast('Switch to "Edit Melody" above the worksheet to place Soprano notes, or drag any Soprano marker directly.');
                return;
              }
              if (!mel.melody.length) return;
              const sameSys = mel.melody
                .map((n, idx) => ({ n, idx }))
                .filter(({ n }) => !Number.isInteger(systemIndex) || n.system_index === systemIndex);
              const pool = sameSys.length ? sameSys : mel.melody.map((n, idx) => ({ n, idx }));
              pool.sort((a, b) => Math.abs((a.n.x ?? 0) - clickX) - Math.abs((b.n.x ?? 0) - clickX));
              const targetIdx = pool[0].idx;
              mel.selectedMelodyNote = targetIdx;
              mel.melody[targetIdx].pitch = spell;
              mel.melody[targetIdx].source = "manual";
              mel.melody[targetIdx].confidence = 1;
              mel.melody[targetIdx].missing = false;
              markMelDirty();
              renderMelAll();
              auditionMelNote(targetIdx);
            }
          },
          onSelectColumnMeta: ({ chordIndex }) => {
            if (!Number.isInteger(chordIndex) || chordIndex < 0 || chordIndex >= mel.harmonization.length) return;
            mel.selectedSlot = chordIndex;
            renderMelStaff();
            renderMelNumeralChips();
            renderMelSlots();
            const slotCards = $("melSlotGrid")?.querySelectorAll(".harm-slot");
            const rnInput = slotCards?.[chordIndex]?.querySelector(".slot-roman-input");
            if (rnInput) {
              rnInput.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "center" });
              rnInput.focus();
              rnInput.select?.();
            }
          },
        },
      );

      if (mel.focusedIssueId !== null) {
        highlightWorksheetIssue(wsSvg, mel.focusedIssueId);
      }
    }
  }

  function auditionMelSlot(slotIdx) {
    const slot = mel.harmonization[slotIdx];
    if (!slot) return;
    const midis = [];
    const bassParsed = parsePitchDisplay(slot.bass);
    if (bassParsed) midis.push(bassParsed.midi);
    // Find melody note sounding at slot onset
    const melNote = mel.melody.find((m) => m.onset <= slot.onset + 1e-4 && m.onset + m.duration > slot.onset + 1e-4);
    const melParsed = melNote ? parsePitchDisplay(melNote.pitch) : null;
    if (melParsed) midis.push(melParsed.midi);
    if (mel.showSatbPreview && mel.satbPreview[slotIdx]?.voices) {
      for (const iv of ["T", "A"]) {
        const p = parsePitchDisplay(mel.satbPreview[slotIdx].voices[iv]);
        if (p) midis.push(p.midi);
      }
    }
    if (!midis.length) return;
    prepareForMelPlay();
    melController.auditionChord(midis, { arpeggiate: melController.arpeggiate }).catch(() => {});
  }

  function renderMelNumeralChips() {
    const container = $("melNumeralChips");
    if (!container) return;
    container.replaceChildren();
    const chips = mel.mode === "minor" ? AP_NUMERAL_CHIPS_MINOR : AP_NUMERAL_CHIPS_MAJOR;
    container.append(createEl("span", { className: "chips-label" }, `Slot #${mel.selectedSlot + 1} quick Roman:`));
    for (const rn of chips) {
      const btn = createEl("button", { type: "button", className: "numeral-chip" }, rn);
      if (mel.harmonization[mel.selectedSlot]?.roman === rn) btn.classList.add("active");
      btn.addEventListener("click", () => {
        const slot = mel.harmonization[mel.selectedSlot];
        if (!slot) return;
        slot.roman = rn;
        markMelDirty();
        renderMelAll();
      });
      container.append(btn);
    }
  }

  function renderMelSlots() {
    const container = $("melSlotGrid");
    if (!container) return;
    container.replaceChildren();
    const keySig = keySignatureFromTonicMode(mel.keyTonic, mel.mode);
    const motionByChord = new Map((mel.grade?.motions || []).map((m) => [m.chord_index, m.motion]));

    mel.harmonization.forEach((slot, idx) => {
      const card = createEl("div", {
        className: `harm-slot${idx === mel.selectedSlot ? " selected" : ""}`,
      });
      card.addEventListener("click", () => {
        if (mel.selectedSlot !== idx) {
          mel.selectedSlot = idx;
          renderMelStaff();
          renderMelNumeralChips();
          renderMelSlots();
        }
      });

      const header = createEl("div", { className: "harm-slot-head" });
      header.append(createEl("strong", {}, `Beat ${slot.onset + 1}`));
      const fnTag = mel.grade?.chords?.[idx]?.function;
      const motionTag = motionByChord.get(idx);
      if (fnTag) {
        header.append(createEl("span", { className: "slot-fn-badge", title: motionTag ? `Function: ${fnTag} · Motion: ${motionTag}` : `Function: ${fnTag}` }, fnTag));
      }
      const audBtn = createEl("button", { type: "button", className: "mini-btn", "aria-label": `Hear slot ${idx + 1}` }, "♪");
      audBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        mel.selectedSlot = idx;
        auditionMelSlot(idx);
      });
      header.append(audBtn);

      const bassRow = createEl("div", { className: "harm-slot-bass" });
      const downBtn = createEl("button", { type: "button", className: "mini-btn", "aria-label": `Lower bass slot ${idx + 1}` }, "−");
      downBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const next = nudgePitch(slot.bass || `${mel.keyTonic}3`, { diatonic: -1, keySignature: keySig });
        if (next) {
          slot.bass = next;
          slot.source = "manual";
          slot.confidence = 1;
          slot.missing = false;
          mel.selectedSlot = idx;
          markMelDirty();
          renderMelAll();
          auditionMelSlot(idx);
        }
      });
      const bassInput = createEl("input", {
        type: "text",
        className: "slot-pitch-input",
        value: slot.bass || "",
        "aria-label": `Bass pitch for slot ${idx + 1}`,
      });
      bassInput.addEventListener("click", (e) => e.stopPropagation());
      bassInput.addEventListener("change", () => {
        const ascii = normalizeAsciiPitch(bassInput.value);
        if (!ascii) {
          bassInput.value = slot.bass || "";
          toast("Enter a bass pitch like C3, G2, or Bb2.");
          return;
        }
        slot.bass = ascii;
        slot.source = "manual";
        slot.confidence = 1;
        slot.missing = false;
        mel.selectedSlot = idx;
        markMelDirty();
        renderMelAll();
        auditionMelSlot(idx);
      });
      const upBtn = createEl("button", { type: "button", className: "mini-btn", "aria-label": `Raise bass slot ${idx + 1}` }, "+");
      upBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const next = nudgePitch(slot.bass || `${mel.keyTonic}3`, { diatonic: 1, keySignature: keySig });
        if (next) {
          slot.bass = next;
          slot.source = "manual";
          slot.confidence = 1;
          slot.missing = false;
          mel.selectedSlot = idx;
          markMelDirty();
          renderMelAll();
          auditionMelSlot(idx);
        }
      });
      bassRow.append(downBtn, bassInput, upBtn);

      const accRow = createEl("div", { className: "harm-slot-acc" });
      for (const [label, alt] of [["♭", -1], ["♮", 0], ["♯", 1]]) {
        const b = createEl("button", { type: "button", className: "mini-btn", "aria-label": `Set bass ${label} for slot ${idx + 1}` }, label);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          const next = setPitchAccidental(slot.bass || `${mel.keyTonic}3`, alt);
          if (next) {
            slot.bass = next;
            slot.source = "manual";
            slot.confidence = 1;
            slot.missing = false;
            mel.selectedSlot = idx;
            markMelDirty();
            renderMelAll();
            auditionMelSlot(idx);
          }
        });
        accRow.append(b);
      }

      const rnInput = createEl("input", {
        type: "text",
        className: "slot-roman-input",
        value: slot.roman,
        placeholder: "Roman (e.g. I, V7)",
        "aria-label": `Roman numeral for slot ${idx + 1}`,
      });
      rnInput.addEventListener("click", (e) => e.stopPropagation());
      rnInput.addEventListener("change", () => {
        slot.roman = rnInput.value.trim();
        mel.selectedSlot = idx;
        markMelDirty();
        renderMelAll();
      });

      card.append(header, bassRow, accRow, rnInput);
      container.append(card);
    });
  }

  function renderMelResults() {
    const container = $("melResults");
    if (!container) return;
    container.replaceChildren();

    if (!mel.grade) {
      const empty = createEl("div", { className: "results-empty" });
      empty.append(
        createEl("p", { className: "eyebrow" }, "AP FRQ 7 HARMONIZATION RUBRIC"),
        createEl("h3", {}, "Ready to grade your melody harmonization."),
        createEl(
          "p",
          { className: "muted" },
          "Click Grade Harmonization to evaluate harmonic progression, soprano-bass counterpoint, non-chord tones (PT, NT, SUS, APP), phrase cadences, and auto-realized inner voices.",
        ),
      );
      container.append(empty);
      return;
    }

    const { summary = {}, cadences = [], issues = [] } = mel.grade;
    container.append(buildScoreSummaryCard(summary, null));

    // Phrase Cadence Cards
    if (Array.isArray(cadences) && cadences.length) {
      const cadSection = createEl("div", { className: "cadence-cards-section" });
      cadSection.append(createEl("div", { className: "section-label" }, "PHRASE CADENCES"));
      const grid = createEl("div", { className: "cadence-cards" });
      for (const c of cadences) {
        const card = createEl("div", { className: `cadence-card ${c.passed ? "passed" : "failed"}` });
        const top = createEl("div", { className: "cadence-card-top" });
        top.append(
          createEl("strong", {}, c.phrase || "Phrase"),
          createEl("span", { className: `cadence-badge ${c.passed ? "valid" : "invalid"}` }, `${c.passed ? "✓" : "✕"} ${c.detected || "None"}`),
        );
        card.append(
          top,
          createEl("small", {}, `Expected: ${c.expected || "—"}`),
          createEl("p", {}, c.message || ""),
        );
        grid.append(card);
      }
      cadSection.append(grid);
      container.append(cadSection);
    }

    container.append(
      buildIssuesList({
        issues,
        svg: $("melGrandStaffSvg"),
        focusedId: mel.focusedIssueId,
        onFocus: (issueId) => {
          mel.focusedIssueId = mel.focusedIssueId === issueId ? null : issueId;
          highlightIssue($("melGrandStaffSvg"), mel.focusedIssueId);
          highlightWorksheetIssue($("melWorksheetSvg"), mel.focusedIssueId);
          updateFocusedIssueCards(container, mel.focusedIssueId);
        },
        onPlayIsolated: async (issue, rawClip) => {
          const clip = extractDemoClip(rawClip, "Soprano + Bass");
          if (!clip.events.length) return toast("No isolated audio clip available for this issue.");
          prepareForMelPlay();
          mel.focusedIssueId = issue.id;
          highlightIssue($("melGrandStaffSvg"), issue.id);
          highlightWorksheetIssue($("melWorksheetSvg"), issue.id);
          updateFocusedIssueCards(container, issue.id);
          mel.customPhaseLabel = clip.label ? `Playing: ${clip.label}` : "Playing Soprano + Bass";
          try {
            await melController.playIsolatedDemo(clip.events, Math.max(54, melController.tempo - 14));
          } catch (err) {
            toast(err.message);
          }
        },
        onPlayContext: async (issue, rawClip) => {
          const clip = extractDemoClip(rawClip, "4-part context");
          if (!clip.events.length) return toast("No 4-part context clip available for this issue.");
          prepareForMelPlay();
          mel.focusedIssueId = issue.id;
          highlightIssue($("melGrandStaffSvg"), issue.id);
          highlightWorksheetIssue($("melWorksheetSvg"), issue.id);
          updateFocusedIssueCards(container, issue.id);
          mel.customPhaseLabel = clip.label ? `Playing: ${clip.label}` : "Playing in 4-part context";
          try {
            await melController.playContextDemo(clip.events, melController.tempo);
          } catch (err) {
            toast(err.message);
          }
        },
        onPlayCompare: async (issue, fc) => {
          const beforeEvents = normalizeAudioEvents(fc?.before_events ?? fc?.beforeEvents ?? []);
          const afterEvents = normalizeAudioEvents(fc?.after_events ?? fc?.afterEvents ?? []);
          if (!beforeEvents.length || !afterEvents.length) return toast("No before/after comparison available.");
          prepareForMelPlay();
          mel.focusedIssueId = issue.id;
          highlightIssue($("melGrandStaffSvg"), issue.id);
          highlightWorksheetIssue($("melWorksheetSvg"), issue.id);
          updateFocusedIssueCards(container, issue.id);
          mel.customBeforeLabel = "Comparing: YOUR VERSION";
          mel.customAfterLabel = "Comparing: CORRECTED FIX";
          try {
            await melController.playBeforeAfterComparison({ beforeEvents, afterEvents, gapBeats: 1.5 }, Math.max(56, melController.tempo - 10));
          } catch (err) {
            toast(err.message);
          }
        },
        onApplyFix: (issue, fc) => applyMelFix(issue, fc),
        isolatedButtonLabel: "▶ Hear Soprano + Bass",
        contextButtonLabel: "▶ Hear in 4-Part Context",
      }),
    );
  }

  function applyMelFix(issue, fc) {
    const fixedBass = fc?.fixed_bass ?? fc?.fixedBass;
    const fixedRoman = fc?.fixed_roman ?? fc?.fixedRoman;
    if (!fixedBass && !fixedRoman) return;
    const targetIdx = Number.isInteger(issue.chord_index)
      ? issue.chord_index
      : Array.isArray(issue.chords) && issue.chords.length
        ? issue.chords[issue.chords.length - 1]
        : mel.selectedSlot;
    const slot = mel.harmonization[targetIdx];
    if (!slot) return;
    if (fixedBass) {
      const ascii = normalizeAsciiPitch(fixedBass);
      if (ascii) {
        slot.bass = ascii;
        slot.source = "manual";
        slot.confidence = 1;
        slot.missing = false;
      }
    }
    if (fixedRoman) slot.roman = String(fixedRoman).trim();
    mel.selectedSlot = targetIdx;
    markMelDirty();
    renderMelAll();
    toast("Applied suggested bass & harmony fix. Re-grading…");
    gradeMelody();
  }

  function renderMelAll() {
    syncMelSetupControls();
    renderMelStaff();
    renderMelNumeralChips();
    renderMelSlots();
    renderMelResults();
  }

  async function requestMelodyGradePayload(harmonizationOverride = null) {
    const payload = {
      key_tonic: mel.keyTonic,
      mode: mel.mode,
      time_signature: mel.timeSignature,
      melody: mel.melody,
      harmonization: harmonizationOverride || mel.harmonization,
      phrases: mel.phrases,
      grade_from_onset: Number(mel.gradeFromOnset) || 0,
    };
    const res = await fetch("/api/theory/grade/melody", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `Melody grading failed (${res.status})`);
    }
    return res.json();
  }

  async function ensureMelSatbPreview(expectedRev = mel.revision) {
    if (mel.satbPreview.length === mel.harmonization.length && mel.satbPreview.length > 0) {
      return mel.satbPreview;
    }
    const data = await requestMelodyGradePayload();
    if (expectedRev !== mel.revision) return null;
    mel.grade = data;
    mel.satbPreview = Array.isArray(data.satb_preview) ? data.satb_preview : [];
    renderMelStaff();
    renderMelSlots();
    renderMelResults();
    return mel.satbPreview;
  }

  async function gradeMelody() {
    if (!mel.melody.length) return;
    const rev = mel.revision;
    mel.busy = true;
    const btn = $("melGradeButton");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Grading…";
    }
    setMelNotice("Grading harmonization, non-chord tones, bass counterpoint, and phrase cadences…", "busy");
    try {
      const data = await requestMelodyGradePayload();
      if (rev !== mel.revision) return;
      mel.grade = data;
      mel.satbPreview = Array.isArray(data.satb_preview) ? data.satb_preview : [];
      mel.focusedIssueId = null;
      const score = mel.grade?.summary?.score;
      const apPts = mel.grade?.summary?.ap_points;
      const apMax = mel.grade?.summary?.ap_max_points;
      setMelNotice(
        `Graded FRQ 7: ${score ?? "—"}/100${apPts !== undefined ? ` (${apPts}/${apMax} AP pts)` : ""}. Toggle "Show auto-realized Alto & Tenor" or switch playback to Full 4-Part SATB to hear your harmonization realized.`,
      );
      renderMelStaff();
      renderMelSlots();
      renderMelResults();
    } catch (err) {
      if (rev !== mel.revision) return;
      setMelNotice(err.message, "error");
      toast(err.message);
    } finally {
      if (rev === mel.revision) {
        mel.busy = false;
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Grade Harmonization";
        }
      }
    }
  }

  async function fetchSuggestedHarmonization({ applyToEditor = true } = {}) {
    if (!mel.melody.length) return null;
    const rev = mel.revision;
    mel.busy = true;
    const btn = $("melSuggestButton");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Harmonizing…";
    }
    setMelNotice("Generating functional AP harmonization & four-part realization…", "busy");
    try {
      const payload = {
        key_tonic: mel.keyTonic,
        mode: mel.mode,
        time_signature: mel.timeSignature,
        melody: mel.melody,
        phrases: mel.phrases,
      };
      const res = await fetch("/api/theory/harmonize/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Auto-harmonize failed (${res.status})`);
      }
      const data = await res.json();
      if (rev !== mel.revision) return null;
      const suggested = normalizeHarmonizationSlots(data.harmonization || []);
      mel.suggestedHarmonization = suggested;
      mel.suggestedSatbPreview = Array.isArray(data.satb_preview) ? data.satb_preview : [];

      if (applyToEditor) {
        mel.revision += 1;
        const prevSlots = mel.harmonization;
        mel.harmonization = structuredClone(suggested).map((slot, idx) => {
          const match = prevSlots.find((p) => Math.abs(p.onset - slot.onset) < 0.05) || prevSlots[idx];
          if (match) {
            if (Number.isInteger(match.system_index)) slot.system_index = match.system_index;
            if (Number.isFinite(match.x)) slot.x = match.x;
            if (Number.isFinite(match.y)) slot.y = match.y;
            if (Number.isFinite(match.figure_y)) slot.figure_y = match.figure_y;
            if (Number.isFinite(match.roman_y)) slot.roman_y = match.roman_y;
            slot.source = "manual";
            slot.confidence = 1;
            slot.missing = false;
          }
          return slot;
        });
        mel.satbPreview = structuredClone(mel.suggestedSatbPreview);
        mel.grade = data.grade || null;
        mel.focusedIssueId = null;
        mel.selectedSlot = 0;
        setMelNotice("Applied suggested AP harmonization and realized inner voices. Press Play or edit any bass note / Roman numeral.");
        renderMelAll();
      }
      return data;
    } catch (err) {
      if (rev !== mel.revision) return null;
      setMelNotice(err.message, "error");
      toast(err.message);
      return null;
    } finally {
      mel.busy = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = "✦ Auto-Harmonize / Suggest";
      }
    }
  }

  function buildCurrentMelEvents(modeOverride = mel.playMode) {
    const { mList, hList, pList } = melodyDataForAudio(mel.melody, mel.harmonization, mel.satbPreview);
    return buildMelodyHarmonizationEvents(mList, hList, pList, {
      mode: modeOverride,
      arpeggiateBeats: melController.arpeggiate ? melController.arpeggiateBeats : 0,
    });
  }

  async function startMelody({ fromBeat = 0 } = {}) {
    if (!mel.melody.length) return;
    const token = ++mel.playToken;
    const rev = mel.revision;
    prepareForMelPlay();
    if (mel.playMode === "satb" && !mel.satbPreview.length) {
      try {
        const preview = await ensureMelSatbPreview(rev);
        if (!preview || token !== mel.playToken || activeTab !== "melody") return;
      } catch (err) {
        if (token === mel.playToken) toast(err.message);
        return;
      }
    }
    if (token !== mel.playToken || activeTab !== "melody") return;
    const events = buildCurrentMelEvents(mel.playMode);
    if (!events.length) return toast("No notes to play.");
    mel.customPhaseLabel = "";
    try {
      await melController.playEvents(events, {
        tempo: melController.tempo,
        transpose: 0,
        mode: "score",
        phase: "score",
        fromBeat,
      });
    } catch (err) {
      if (token === mel.playToken) toast(err.message);
    }
  }

  async function playMelodyHarmonization() {
    if (!mel.melody.length) return;
    if (melController.state === "playing") {
      melController.pause();
      return;
    }
    const resumeBeat = melController.state === "paused" ? melController.currentBeat : 0;
    await startMelody({ fromBeat: resumeBeat });
  }

  async function compareMelodyWithSuggested() {
    if (!mel.melody.length) return;
    const token = ++mel.playToken;
    const rev = mel.revision;
    prepareForMelPlay();
    try {
      if (!mel.suggestedHarmonization) {
        const res = await fetchSuggestedHarmonization({ applyToEditor: false });
        if (!res || token !== mel.playToken || activeTab !== "melody") return;
      }
      if (mel.playMode === "satb") {
        if (!mel.satbPreview.length) {
          const preview = await ensureMelSatbPreview(rev);
          if (!preview || token !== mel.playToken || activeTab !== "melody") return;
        }
        if (!mel.suggestedSatbPreview?.length && mel.suggestedHarmonization) {
          const sugData = await requestMelodyGradePayload(mel.suggestedHarmonization);
          if (rev !== mel.revision || token !== mel.playToken || activeTab !== "melody") return;
          mel.suggestedSatbPreview = Array.isArray(sugData.satb_preview) ? sugData.satb_preview : [];
        }
      }
    } catch (err) {
      if (token === mel.playToken) toast(err.message);
      return;
    }
    if (token !== mel.playToken || activeTab !== "melody") return;
    const compareMode = mel.playMode === "satb" && mel.satbPreview.length && mel.suggestedSatbPreview?.length ? "satb" : "outer";
    const yoursData = melodyDataForAudio(mel.melody, mel.harmonization, mel.satbPreview);
    const sugData = melodyDataForAudio(mel.melody, mel.suggestedHarmonization, mel.suggestedSatbPreview || []);
    const arp = melController.arpeggiate ? melController.arpeggiateBeats : 0;
    const beforeEvents = buildMelodyHarmonizationEvents(yoursData.mList, yoursData.hList, yoursData.pList, {
      mode: compareMode,
      arpeggiateBeats: arp,
    });
    const afterEvents = buildMelodyHarmonizationEvents(sugData.mList, sugData.hList, sugData.pList, {
      mode: compareMode,
      arpeggiateBeats: arp,
    });
    mel.customBeforeLabel = "Comparing: YOUR HARMONIZATION";
    mel.customAfterLabel = "Comparing: SUGGESTED HARMONIZATION";
    try {
      await melController.playBeforeAfterComparison({ beforeEvents, afterEvents, gapBeats: 2 }, melController.tempo);
    } catch (err) {
      if (token === mel.playToken) toast(err.message);
    }
  }

  // Bind Melody Harmonization listeners
  $("melExerciseSelect")?.addEventListener("change", (e) => selectMelExercise(e.target.value, "starter"));
  $("melLoadStarter")?.addEventListener("click", () => selectMelExercise(mel.exercise?.id, "starter"));
  $("melLoadAttempt")?.addEventListener("click", () => selectMelExercise(mel.exercise?.id, "attempt"));
  $("melLoadSolution")?.addEventListener("click", () => selectMelExercise(mel.exercise?.id, "solution"));
  $("melSuggestButton")?.addEventListener("click", () => fetchSuggestedHarmonization({ applyToEditor: true }));
  $("melGradeButton")?.addEventListener("click", gradeMelody);
  $("melShowSatbToggle")?.addEventListener("change", async (e) => {
    mel.showSatbPreview = e.target.checked;
    if (mel.showSatbPreview && !mel.satbPreview.length) {
      await ensureMelSatbPreview(mel.revision).catch((err) => toast(err.message));
    }
    renderMelStaff();
  });

  document.querySelectorAll("#melPlayMode [data-play-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      mel.playMode = btn.dataset.playMode;
      document.querySelectorAll("#melPlayMode [data-play-mode]").forEach((b) => {
        const active = b.dataset.playMode === mel.playMode;
        b.classList.toggle("active", active);
        b.setAttribute("aria-pressed", String(active));
      });
      if (melController.state === "playing") {
        startMelody({ fromBeat: melController.currentBeat });
      }
    });
  });

  $("melPlayButton")?.addEventListener("click", playMelodyHarmonization);
  $("melStopButton")?.addEventListener("click", () => {
    mel.playToken += 1;
    melController.stop();
    highlightActiveNotes($("melGrandStaffSvg"), []);
    highlightWorksheetActiveNotes($("melWorksheetSvg"), []);
    setMelPhaseText("Ready");
  });
  $("melRollToggle")?.addEventListener("click", () => {
    const next = !melController.arpeggiate;
    melController.setArpeggiate(next, 0.14);
    $("melRollToggle")?.setAttribute("aria-pressed", String(next));
    $("melRollToggle")?.classList.toggle("active", next);
    if (melController.state === "playing") startMelody({ fromBeat: melController.currentBeat });
  });
  $("melTempo")?.addEventListener("change", (e) => {
    const bpm = clamp(Math.round(Number(e.target.value) || 82), 40, 160);
    e.target.value = String(bpm);
    melController.setTempo(bpm);
  });
  $("melCompareSuggestedButton")?.addEventListener("click", compareMelodyWithSuggested);

  $("melMidiButton")?.addEventListener("click", async () => {
    try {
      const rev = mel.revision;
      if (mel.playMode === "satb" && !mel.satbPreview.length) {
        const preview = await ensureMelSatbPreview(rev);
        if (!preview) return;
      }
      const events = buildCurrentMelEvents(mel.playMode);
      if (!events.length) return toast("No notes to export.");
      downloadBlob(melController.exportMidi(events), `staff2audio-harmonize-${mel.exercise?.id || "melody"}.mid`);
      toast("Harmonization MIDI downloaded.");
    } catch (err) {
      toast(err.message);
    }
  });
  $("melWavButton")?.addEventListener("click", async () => {
    if (mel.exporting) return;
    const btn = $("melWavButton");
    mel.exporting = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Rendering…";
    }
    try {
      const rev = mel.revision;
      stopTheoryPlayback();
      if (mel.playMode === "satb" && !mel.satbPreview.length) {
        const preview = await ensureMelSatbPreview(rev);
        if (!preview) return;
      }
      const events = buildCurrentMelEvents(mel.playMode);
      if (!events.length) throw new Error("No notes to export.");
      const blob = await melController.exportWav(events);
      downloadBlob(blob, `staff2audio-harmonize-${mel.exercise?.id || "melody"}.wav`);
      toast("Harmonization piano audio downloaded.");
    } catch (err) {
      toast(err.message);
    } finally {
      mel.exporting = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = "WAV ↓";
      }
    }
  });

  // =========================================================================
  // SHARED REPORT BUILDERS (Score Summary, Rubric Bars, Interactive Issues)
  // =========================================================================
  function buildScoreSummaryCard(summary, cadence) {
    const wrap = createEl("div", { className: "grade-summary" });
    const score = summary.score ?? 0;
    const maxScore = summary.max_score ?? 100;
    const apPts = summary.ap_points;
    const apMax = summary.ap_max_points;

    const top = createEl("div", { className: "grade-summary-top" });
    const scoreBox = createEl("div", { className: "grade-score-box" });
    scoreBox.append(
      createEl("span", { className: "grade-score-num" }, `${score}`),
      createEl("span", { className: "grade-score-max" }, `/ ${maxScore}`),
    );
    const meta = createEl("div", { className: "grade-meta" });
    meta.append(
      createEl("strong", { className: "grade-band" }, summary.grade_label || (score >= 90 ? "AP 5 · Exemplary" : score >= 75 ? "AP 4 · Proficient" : "Needs Revision")),
      createEl(
        "span",
        { className: "grade-sub" },
        `${apPts !== undefined && apMax !== undefined ? `AP Rubric: ${apPts} / ${apMax} pts · ` : ""}${summary.error_count ?? 0} errors · ${summary.warning_count ?? 0} warnings`,
      ),
    );
    top.append(scoreBox, meta);

    if (cadence) {
      const badge = createEl(
        "span",
        { className: `cadence-badge ${cadence.valid !== false ? "valid" : "invalid"}` },
        `${cadence.label || cadence.type || "Cadence"} ${cadence.valid !== false ? "✓" : "✕"}`,
      );
      top.append(badge);
    }
    wrap.append(top);

    if (Array.isArray(summary.rubric) && summary.rubric.length) {
      const rubricWrap = createEl("div", { className: "rubric-bars" });
      for (const item of summary.rubric) {
        const possible = Number(item.possible) || 1;
        const earned = clamp(Number(item.earned) || 0, 0, possible);
        const pct = Math.round((earned / possible) * 100);
        const row = createEl("div", { className: "rubric-row" });
        const labelRow = createEl("div", { className: "rubric-row-head" });
        labelRow.append(
          createEl("span", {}, item.name || "Category"),
          createEl("strong", {}, `${earned} / ${possible}`),
        );
        const track = createEl("div", { className: "rubric-track" });
        const fill = createEl("div", {
          className: `rubric-fill${pct >= 85 ? " good" : pct >= 60 ? " mid" : " low"}`,
        });
        fill.style.width = `${pct}%`;
        track.append(fill);
        row.append(labelRow, track);
        if (item.notes) row.append(createEl("small", { className: "rubric-note" }, item.notes));
        rubricWrap.append(row);
      }
      wrap.append(rubricWrap);
    }
    return wrap;
  }

  function updateFocusedIssueCards(container, focusedId) {
    if (!container) return;
    container.querySelectorAll(".issue-card[data-issue-id]").forEach((card) => {
      const isFocused = focusedId !== null && card.dataset.issueId === String(focusedId);
      card.classList.toggle("focused", isFocused);
      const focusBtn = card.querySelector(".issue-focus-btn");
      if (focusBtn) focusBtn.setAttribute("aria-pressed", String(isFocused));
    });
  }

  function buildIssuesList({
    issues,
    focusedId,
    onFocus,
    onPlayIsolated,
    onPlayContext,
    onPlayCompare,
    onApplyFix,
    isolatedButtonLabel,
    contextButtonLabel,
  }) {
    const section = createEl("div", { className: "issues-section" });
    if (!Array.isArray(issues) || !issues.length) {
      const clean = createEl("div", { className: "issues-clean" });
      clean.append(
        createEl("span", { className: "clean-check", "aria-hidden": "true" }, "✓"),
        createEl("div", {}, "No voice-leading or harmonic issues detected. Great AP Music Theory work!"),
      );
      section.append(clean);
      return section;
    }

    section.append(createEl("div", { className: "section-label" }, `ISSUES & AUDIO COMPARISONS (${issues.length})`));
    const list = createEl("div", { className: "issues-list" });

    issues.forEach((issue, idx) => {
      const issueId = issue.id ?? `issue-${idx}`;
      const severity = issue.severity === "warning" ? "warning" : issue.severity === "info" ? "info" : "error";
      const isFocused = focusedId === issueId;
      const card = createEl("article", {
        className: `issue-card severity-${severity}${isFocused ? " focused" : ""}`,
        "data-issue-id": issueId,
      });

      const head = createEl("div", { className: "issue-head" });
      const focusBtn = createEl("button", {
        type: "button",
        className: "issue-focus-btn",
        "aria-pressed": String(isFocused),
      });
      focusBtn.append(
        createEl("span", { className: `severity-badge ${severity}` }, severity === "warning" ? "Warning" : severity === "info" ? "Note" : "Error"),
        createEl("strong", { className: "issue-title" }, issue.title || issue.rule_id || "Voice-leading issue"),
      );
      focusBtn.addEventListener("click", () => onFocus?.(issueId));
      head.append(focusBtn);

      const locationParts = [];
      if (Array.isArray(issue.chords) && issue.chords.length) {
        locationParts.push(
          issue.chords.length === 1
            ? `Chord ${issue.chords[0] + 1}`
            : `Chords ${issue.chords.map((c) => c + 1).join(" → ")}`,
        );
      }
      if (Array.isArray(issue.voices) && issue.voices.length) {
        locationParts.push(issue.voices.join(" & "));
      }
      if (locationParts.length) {
        head.append(createEl("span", { className: "issue-loc" }, locationParts.join(" · ")));
      }
      card.append(head);

      if (issue.message) card.append(createEl("p", { className: "issue-message" }, issue.message));
      if (issue.suggestion) {
        card.append(createEl("p", { className: "issue-suggestion" }, `Fix: ${issue.suggestion}`));
      }

      // Audio Effect Demo buttons (supports both bare event arrays and { label, events } objects)
      const demo = issue.audio_demo || {};
      const isolatedClip = extractDemoClip(demo.isolated_pair);
      const contextClip = extractDemoClip(demo.in_context);
      const actions = createEl("div", { className: "issue-actions" });
      if (isolatedClip.events.length) {
        const b = createEl("button", { type: "button", className: "audio-demo-btn" }, isolatedButtonLabel);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          onPlayIsolated?.(issue, demo.isolated_pair);
        });
        actions.append(b);
      }
      if (contextClip.events.length) {
        const b = createEl("button", { type: "button", className: "audio-demo-btn" }, contextButtonLabel);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          onPlayContext?.(issue, demo.in_context);
        });
        actions.append(b);
      }
      const fc = demo.fixed_comparison;
      if (fc && (fc.before_events?.length || fc.beforeEvents?.length)) {
        const b = createEl("button", { type: "button", className: "audio-demo-btn compare-btn" }, "⇄ Compare: Yours vs. Fix");
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          onPlayCompare?.(issue, fc);
        });
        actions.append(b);
      }
      const hasApplicableFix = Boolean(fc?.fixed_voices || fc?.fixedVoices || fc?.fixed_bass || fc?.fixedBass || fc?.fixed_roman || fc?.fixedRoman);
      if (onApplyFix && hasApplicableFix) {
        const b = createEl("button", { type: "button", className: "audio-demo-btn apply-fix-btn" }, "✓ Apply Fix");
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          onApplyFix(issue, fc);
        });
        actions.append(b);
      }
      if (actions.childElementCount) card.append(actions);
      list.append(card);
    });

    section.append(list);
    return section;
  }

  // =========================================================================
  // WORKSHEET IMAGE / PDF UPLOAD, VIEW TOGGLES & ON-IMAGE EDIT CONTROLS
  // =========================================================================
  function bindWorksheetDropzone(dropzoneEl, fileInputEl, onFile) {
    if (!dropzoneEl || !fileInputEl) return;
    fileInputEl.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) onFile(file);
      e.target.value = "";
    });
    dropzoneEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInputEl.click();
      }
    });
    for (const evt of ["dragenter", "dragover"]) {
      dropzoneEl.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzoneEl.classList.add("dragover");
      });
    }
    for (const evt of ["dragleave", "drop"]) {
      dropzoneEl.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzoneEl.classList.remove("dragover");
      });
    }
    dropzoneEl.addEventListener("drop", (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) onFile(file);
    });
  }

  async function uploadWorksheet(mode = "four_part", file = null, page = 1) {
    const normalizedMode = mode === "melody" ? "melody" : "four_part";
    const isFp = normalizedMode === "four_part";
    const setNoticeFn = isFp ? setFpNotice : setMelNotice;

    if (!file) return null;
    if (file.size > 25 * 1024 * 1024) {
      const msg = "This file exceeds 25 MB. Crop the worksheet screenshot or use a smaller PDF.";
      setNoticeFn(msg, "error");
      toast(msg);
      return null;
    }
    if (!file.size) {
      const msg = "This file is empty. Choose a worksheet image or PDF.";
      setNoticeFn(msg, "error");
      toast(msg);
      return null;
    }

    const targetTab = isFp ? "four-part" : "melody";
    if (activeTab !== targetTab) {
      switchTab(targetTab);
    }

    if (isFp) {
      fp.uploading = true;
      syncFpWorksheetUI();
    } else {
      mel.uploading = true;
      syncMelWorksheetUI();
    }
    setNoticeFn(
      page > 1
        ? `Analyzing worksheet page ${page}…`
        : "Analyzing worksheet image, grand-staff systems, and notes…",
      "busy",
    );

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mode", normalizedMode);
      form.append("page", String(Math.max(1, Math.round(Number(page) || 1))));

      const res = await fetch("/api/theory/analyze-worksheet", {
        method: "POST",
        headers: { Accept: "application/json" },
        body: form,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Worksheet analysis failed (${res.status})`);
      }
      const data = await res.json();
      stopTheoryPlayback();

      const warnings = Array.isArray(data.warnings) ? data.warnings.filter(Boolean) : [];
      const detectedMode = String(data.key_mode || "major").toLowerCase() === "minor" ? "minor" : "major";
      const detectedSig = Number.isInteger(data.key_signature) ? data.key_signature : 0;
      const fallbackKey = tonicModeFromKeySignature(detectedSig, detectedMode);
      const detectedTonic = data.key_tonic || fallbackKey.tonic;
      const detectedMeter = data.time_signature || "4/4";
      const filename = data.filename || file.name || "worksheet.png";

      if (isFp) {
        fp.revision += 1;
        fp.worksheet = {
          filename,
          page: Number(data.page) || 1,
          pages: Number(data.pages) || 1,
          width: Number(data.width) || 800,
          height: Number(data.height) || 320,
          preview: data.preview || null,
          systems: Array.isArray(data.systems) ? data.systems : [],
          file,
          warnings,
        };
        fp.viewMode = "worksheet";
        fp.exercise = {
          id: "__worksheet_fp__",
          title: filename,
          subtitle: "Uploaded Worksheet",
          instructions:
            "Review detected SATB voice markers directly on your worksheet (amber dashed rings need a closer look). Drag any marker vertically or click a staff line to adjust pitches, click RN/fig pills below the bass staff to edit labels, then click Grade Four-Part Writing.",
        };
        fp.keyTonic = detectedTonic;
        fp.mode = detectedMode;
        fp.timeSignature = detectedMeter;
        fp.exerciseType = data.exercise_type || "figured_bass";
        fp.lockedVoices = new Set(Array.isArray(data.locked_voices) ? data.locked_voices : []);
        fp.unlockOverride = false;
        if ($("fpUnlockVoices")) $("fpUnlockVoices").checked = false;
        fp.chords = normalizeChordList(data.chords || [], { preserveMissing: true });
        fp.selectedChord = 0;
        fp.grade = null;
        fp.focusedIssueId = null;
        if (fp.lockedVoices.has(fp.activeVoice)) {
          fp.activeVoice = SATB_VOICES.find((v) => !fp.lockedVoices.has(v)) || "S";
        }
        populateFpExerciseSelect();
        renderFpAll();

        const summaryParts = [
          `Loaded "${filename}" (${fp.chords.length} chords in ${formatKeyLabel(fp.keyTonic, fp.mode)} · ${fp.timeSignature}).`,
          "Drag any marker to correct pitches, then click Grade Four-Part Writing.",
        ];
        if (warnings.length) summaryParts.push(warnings.join(" "));
        setFpNotice(summaryParts.join(" "));
      } else {
        mel.revision += 1;
        mel.worksheet = {
          filename,
          page: Number(data.page) || 1,
          pages: Number(data.pages) || 1,
          width: Number(data.width) || 800,
          height: Number(data.height) || 320,
          preview: data.preview || null,
          systems: Array.isArray(data.systems) ? data.systems : [],
          file,
          warnings,
        };
        mel.viewMode = "worksheet";
        mel.editTarget = "bass";
        mel.selectedMelodyNote = null;
        mel.exercise = {
          id: "__worksheet_mel__",
          title: filename,
          subtitle: "Uploaded FRQ 7 Worksheet",
          instructions:
            "Review detected melody notes and handwritten bass markers on your worksheet. Drag any marker vertically to correct pitches, click Roman numeral pills below the bass staff, verify Start grading from beat if opening measures are printed, then click Grade Harmonization.",
        };
        mel.keyTonic = detectedTonic;
        mel.mode = detectedMode;
        mel.timeSignature = detectedMeter;
        mel.melody = normalizeMelodyNotes(data.melody || []);
        mel.harmonization = normalizeHarmonizationSlots(data.harmonization || [], { preserveMissing: true });
        mel.phrases = Array.isArray(data.phrases) ? structuredClone(data.phrases) : [];
        mel.gradeFromOnset = Number.isFinite(Number(data.grade_from_onset))
          ? Math.max(0, Number(data.grade_from_onset))
          : 0;
        mel.satbPreview = [];
        mel.suggestedHarmonization = null;
        mel.suggestedSatbPreview = null;
        mel.selectedSlot = 0;
        mel.grade = null;
        mel.focusedIssueId = null;
        populateMelExerciseSelect();
        renderMelAll();

        const gradeNote = mel.gradeFromOnset > 0
          ? ` Grading starts at beat ${mel.gradeFromOnset} (opening measures play in full).`
          : "";
        const summaryParts = [
          `Loaded "${filename}" (${mel.melody.length} melody notes, ${mel.harmonization.length} bass slots in ${formatKeyLabel(mel.keyTonic, mel.mode)} · ${mel.timeSignature}).${gradeNote}`,
        ];
        if (warnings.length) summaryParts.push(warnings.join(" "));
        setMelNotice(summaryParts.join(" "));
      }
      return data;
    } catch (err) {
      setNoticeFn(err.message, "error");
      toast(err.message);
      return null;
    } finally {
      if (isFp) {
        fp.uploading = false;
        syncFpWorksheetUI();
      } else {
        mel.uploading = false;
        syncMelWorksheetUI();
      }
    }
  }

  // Bind Tab 2 worksheet controls
  bindWorksheetDropzone($("fpDropzone"), $("fpFileInput"), (file) => uploadWorksheet("four_part", file, 1));
  $("fpWorksheetPageSelect")?.addEventListener("change", (e) => {
    const p = Number(e.target.value);
    if (fp.worksheet?.file && Number.isInteger(p)) uploadWorksheet("four_part", fp.worksheet.file, p);
  });
  $("fpWorksheetPrevPage")?.addEventListener("click", () => {
    if (fp.worksheet?.file && fp.worksheet.page > 1) {
      uploadWorksheet("four_part", fp.worksheet.file, fp.worksheet.page - 1);
    }
  });
  $("fpWorksheetNextPage")?.addEventListener("click", () => {
    if (fp.worksheet?.file && fp.worksheet.page < fp.worksheet.pages) {
      uploadWorksheet("four_part", fp.worksheet.file, fp.worksheet.page + 1);
    }
  });
  $("fpClearWorksheet")?.addEventListener("click", () => {
    const fallbackId = exercises.four_part[0]?.id;
    if (fallbackId) {
      selectFpExercise(fallbackId, "starter");
    } else {
      fp.worksheet = null;
      fp.viewMode = "engraved";
      populateFpExerciseSelect();
      renderFpAll();
    }
  });
  $("fpViewWorksheet")?.addEventListener("click", () => {
    if (!fp.worksheet) return;
    fp.viewMode = "worksheet";
    syncFpViewMode();
    renderFpStaff();
  });
  $("fpViewEngraved")?.addEventListener("click", () => {
    fp.viewMode = "engraved";
    syncFpViewMode();
    renderFpStaff();
  });

  // Bind Tab 3 worksheet & editable parameter controls
  bindWorksheetDropzone($("melDropzone"), $("melFileInput"), (file) => uploadWorksheet("melody", file, 1));
  $("melWorksheetPageSelect")?.addEventListener("change", (e) => {
    const p = Number(e.target.value);
    if (mel.worksheet?.file && Number.isInteger(p)) uploadWorksheet("melody", mel.worksheet.file, p);
  });
  $("melWorksheetPrevPage")?.addEventListener("click", () => {
    if (mel.worksheet?.file && mel.worksheet.page > 1) {
      uploadWorksheet("melody", mel.worksheet.file, mel.worksheet.page - 1);
    }
  });
  $("melWorksheetNextPage")?.addEventListener("click", () => {
    if (mel.worksheet?.file && mel.worksheet.page < mel.worksheet.pages) {
      uploadWorksheet("melody", mel.worksheet.file, mel.worksheet.page + 1);
    }
  });
  $("melClearWorksheet")?.addEventListener("click", () => {
    const fallbackId = exercises.melody[0]?.id;
    if (fallbackId) {
      selectMelExercise(fallbackId, "starter");
    } else {
      mel.worksheet = null;
      mel.viewMode = "engraved";
      mel.gradeFromOnset = 0;
      populateMelExerciseSelect();
      renderMelAll();
    }
  });
  $("melViewWorksheet")?.addEventListener("click", () => {
    if (!mel.worksheet) return;
    mel.viewMode = "worksheet";
    syncMelViewMode();
    renderMelStaff();
  });
  $("melViewEngraved")?.addEventListener("click", () => {
    mel.viewMode = "engraved";
    syncMelViewMode();
    renderMelStaff();
  });
  $("melEditBass")?.addEventListener("click", () => {
    mel.editTarget = "bass";
    mel.selectedMelodyNote = null;
    syncMelViewMode();
    renderMelStaff();
  });
  $("melEditMelody")?.addEventListener("click", () => {
    mel.editTarget = "melody";
    syncMelViewMode();
    renderMelStaff();
  });
  $("melKeyTonic")?.addEventListener("change", (e) => {
    mel.keyTonic = e.target.value;
    markMelDirty();
    renderMelAll();
  });
  $("melKeyMode")?.addEventListener("change", (e) => {
    mel.mode = e.target.value;
    markMelDirty();
    renderMelAll();
  });
  $("melTimeSig")?.addEventListener("change", (e) => {
    mel.timeSignature = e.target.value;
    markMelDirty();
    renderMelAll();
  });
  const handleMelGradeFromChange = (e) => {
    const val = Number(e.target.value);
    const clean = Number.isFinite(val) && val >= 0 ? val : 0;
    if (clean !== mel.gradeFromOnset) {
      mel.gradeFromOnset = clean;
      markMelDirty();
      renderMelStaff();
      renderMelResults();
    }
  };
  $("melGradeFromInput")?.addEventListener("input", handleMelGradeFromChange);
  $("melGradeFromInput")?.addEventListener("change", (e) => {
    handleMelGradeFromChange(e);
    e.target.value = String(mel.gradeFromOnset);
  });

  // =========================================================================
  // OMR BRIDGE: Import Scanned Melody from Tab 1 -> Tab 3
  // =========================================================================
  async function importScannedMelody(staff, title) {
    const payload = staffToMelodyPayload(staff, title);
    if (!payload) {
      toast("Select a staff with recognized notes before sending to Harmonize Melody.");
      return;
    }
    if (!exercisesLoaded && !exercisesLoading) {
      await loadExercises();
    }
    mel.worksheet = null;
    mel.viewMode = "engraved";
    mel.importedExercise = payload;
    populateMelExerciseSelect();
    switchTab("melody");
    selectMelExercise(payload.id, "starter");
    setMelNotice(
      `Imported "${payload.title}" (${payload.melody.length} notes in ${formatKeyLabel(payload.key_tonic, payload.mode)}). Click "✦ Auto-Harmonize / Suggest" for an instant AP harmonization, or click the bass staff to compose your own!`,
    );
  }

  return {
    switchTab,
    getActiveTab: () => activeTab,
    stopPlayback: stopTheoryPlayback,
    importScannedMelody,
    uploadWorksheet,
    loadExercises,
  };
}
