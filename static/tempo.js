// Practice suggestions are product choices, not score markings or pedagogy standards.
const QUARTER_MIN = 30;
const QUARTER_MAX = 240;
const BPM_PRESETS = [
  30, 40, 48, 56, 60, 72, 80, 90, 100, 120, 144, 160, 180, 200, 240, 300, 360, 480,
];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const numeric = (value, fallback) => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return fallback;
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
};

function factorValue(value) {
  const factor = numeric(value, NaN);
  if (!(factor > 0) || !Number.isSafeInteger(Math.floor(QUARTER_MAX / factor)) ||
      Math.floor(QUARTER_MAX / factor) < Math.max(1, Math.ceil(QUARTER_MIN / factor))) {
    throw new RangeError('The beat unit must map to a supported quarter-note tempo.');
  }
  return factor;
}

/** Exact displayed-beat choices, including each unit's supported endpoints.
 * Filter rather than clamp preset values so a selected number is never changed.
 */
export function tempoPresets(quarterNotesPerBeat = 1) {
  const factor = factorValue(quarterNotesPerBeat);
  const min = Math.max(1, Math.ceil(QUARTER_MIN / factor));
  const max = Math.floor(QUARTER_MAX / factor);
  return [...new Set([
    min, ...BPM_PRESETS.filter(bpm => bpm >= min && bpm <= max), max,
  ])].sort((a, b) => a - b);
}

/** Integer display input bounds map to the engine's 30–240 quarter-note BPM. */
export function clampDisplayBpm(bpm, quarterNotesPerBeat = 1) {
  const factor = factorValue(quarterNotesPerBeat);
  return clamp(Math.round(numeric(bpm, 72)), Math.ceil(QUARTER_MIN / factor), Math.floor(QUARTER_MAX / factor));
}

/** Preserve fractional values when converting; clamp only at engine boundaries. */
export function toQuarterBpm(bpm, quarterNotesPerBeat = 1) {
  const factor = factorValue(quarterNotesPerBeat);
  return clamp(numeric(bpm, 72 / factor) * factor, QUARTER_MIN, QUARTER_MAX);
}

export function fromQuarterBpm(quarterBpm, quarterNotesPerBeat = 1) {
  const factor = factorValue(quarterNotesPerBeat);
  return clamp(numeric(quarterBpm, 72), QUARTER_MIN, QUARTER_MAX) / factor;
}

function meterUnit(signature) {
  const text = typeof signature === 'string' ? signature.trim() : '';
  const normalized = text === 'C' ? '4/4' : text === '¢' ? '2/2' : text;
  const match = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(normalized);
  const numerator = match ? Number(match[1]) : 0, denominator = match ? Number(match[2]) : 0;
  if (!(numerator >= 1 && numerator <= 32) || ![1, 2, 4, 8, 16, 32].includes(denominator)) {
    return { factor: 1, compound: false, label: 'quarter note', symbol: '♩', fallback: true };
  }
  // 3/8 has several performance conventions; use explicit eighth-note counting.
  const compound = [6, 9, 12].includes(numerator);
  const names = { 0.5: 'double whole note', 1: 'whole note', 2: 'half note', 4: 'quarter note', 8: 'eighth note', 16: 'sixteenth note', 32: 'thirty-second note' };
  const symbols = { 0.5: '𝅜', 1: '𝅝', 2: '𝅗𝅥', 4: '♩', 8: '♪', 16: '𝅘𝅥𝅯', 32: '𝅘𝅥𝅰' };
  const beatDenominator = compound ? denominator / 2 : denominator;
  const label = compound ? `dotted ${names[beatDenominator]}` : names[beatDenominator];
  return { factor: (compound ? 12 : 4) / denominator, compound, label,
    symbol: `${symbols[beatDenominator]}${compound ? '.' : ''}`, fallback: false };
}

function shortestSoundingDuration(events) {
  if (!Array.isArray(events)) return Infinity;
  return events.reduce((shortest, event) => {
    const valid = event && typeof event.midi === 'number' && Number.isFinite(event.midi) && event.midi >= 0 && event.midi <= 127 &&
      typeof event.duration === 'number' && Number.isFinite(event.duration) && event.duration > 0;
    return valid ? Math.min(shortest, event.duration) : shortest;
  }, Infinity);
}

/** One steady starting tempo/range for the selected staff, never automatic rubato.
 * Any short sounding value slows the suggestion; confidence does not hide a fast note.
 * Staff event durations remain quarter-note counts, independent of the display unit.
 */
export function recommendTempo(staff) {
  const unit = meterUnit(staff?.time_signature);
  const shortestPulse = shortestSoundingDuration(staff?.events) / unit.factor;
  // Compare with the chosen pulse's ordinary division: two in simple, three in compound.
  const dense = shortestPulse < (unit.compound ? 1 / 3 : 1 / 2) - 1e-9;
  const denseReference = unit.compound ? 1 / 6 : 1 / 4;
  const slowFactor = dense ? Math.min(1, shortestPulse / denseReference) : 1;
  const [min, max, preferred] = unit.compound ? (dense ? [36, 44, 40] : [40, 56, 48]) :
    (dense ? [48, 60, 56] : [60, 80, 72]);
  const bpm = clampDisplayBpm(preferred * slowFactor, unit.factor);
  const minBpm = clampDisplayBpm(min * slowFactor, unit.factor), maxBpm = clampDisplayBpm(max * slowFactor, unit.factor);
  const reason = [unit.fallback ? 'Unrecognized or missing meter: using quarter-note counting.' :
    `${unit.compound ? 'Compound' : 'Simple'} meter: count each ${unit.label}.`,
  dense ? 'Short sounding note values suggest a slower practice pulse.' : 'Start with a comfortable, steady practice pulse.',
  ...(slowFactor < 1 ? ['Very short values scale the starting range further, within the supported tempo limits.'] : []),
  'This is a suggested starting range; adjust it to your voice and the phrase.'].join(' ');
  return { bpm, minBpm, maxBpm, quarterBpm: toQuarterBpm(bpm, unit.factor),
    quarterNotesPerBeat: unit.factor, beatLabel: unit.label, beatSymbol: unit.symbol,
    unitLabel: `${unit.label} BPM`, reason };
}
