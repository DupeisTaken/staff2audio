// Polyphonic AP Music Theory playback engine and A/B effect demonstrator.
// Shares PianoPlayer and its 88 bundled local grand piano samples with zero extra fetches.
import { PianoPlayer, prepareEvents, scoreDuration, tempoValue } from './piano.js';

export const SATB_VOICES = Object.freeze(['S', 'A', 'T', 'B']);
export const ARPEGGIO_ORDER = Object.freeze(['B', 'T', 'A', 'S']);

const BASE_POLY_GAINS = Object.freeze({ 1: 0.78, 2: 0.56, 3: 0.46, 4: 0.38 });
const EPSILON = 1e-6;

const isValidGain = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1;

function normalizeMutedSet(mutedVoices) {
  if (mutedVoices instanceof Set) return mutedVoices;
  if (Array.isArray(mutedVoices)) return new Set(mutedVoices);
  return new Set();
}

function isVoiceEnabled(voice, mutedSet, soloVoice) {
  if (soloVoice) return voice === soloVoice;
  return !mutedSet.has(voice);
}

function extractPitchEntry(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { midi: Math.round(raw) } : null;
  }
  if (typeof raw === 'object') {
    if (raw.midi !== null && raw.midi !== undefined && Number.isFinite(Number(raw.midi))) {
      return { ...raw, midi: Math.round(Number(raw.midi)) };
    }
    if (raw.pitch && typeof raw.pitch === 'object' && Number.isFinite(Number(raw.pitch.midi))) {
      return { ...raw, ...raw.pitch, midi: Math.round(Number(raw.pitch.midi)) };
    }
  }
  return null;
}

function resolveVoiceGain(voiceGain, voice, activeCount, chordIndex) {
  if (typeof voiceGain === 'function') {
    const computed = voiceGain(voice, activeCount, chordIndex);
    if (isValidGain(computed)) return computed;
  } else if (isValidGain(voiceGain)) {
    return voiceGain;
  } else if (voiceGain && typeof voiceGain === 'object' && isValidGain(voiceGain[voice])) {
    return voiceGain[voice];
  }
  return balancedVoiceGain(activeCount, voice);
}

function arpeggioStep(requestedStep, voiceCount, chordDuration) {
  if (!Number.isFinite(requestedStep) || requestedStep <= 0 || voiceCount <= 1) return 0;
  const minTail = Math.min(0.1, chordDuration * 0.25);
  const maxStep = Math.max(0, (chordDuration - minTail) / (voiceCount - 1));
  return Math.min(requestedStep, maxStep);
}

/** Balance polyphonic peak gains by active voice count, subtly highlighting outer voices. */
export function balancedVoiceGain(activeCount, voice = null) {
  const count = Math.max(1, Math.round(Number(activeCount) || 1));
  const base = BASE_POLY_GAINS[count] ?? Math.max(0.24, 0.78 / Math.sqrt(count));
  const outerBoost = count > 1 && (voice === 'S' || voice === 'B') ? 1.06 : 1;
  return Number(Math.min(1, base * outerBoost).toFixed(4));
}

/**
 * Build polyphonic PianoPlayer events from SATB chords.
 * Each chord is `{ onset, duration, voices: { S, A, T, B } }`.
 */
export function buildSatbEvents(chords, {
  mutedVoices = new Set(),
  soloVoice = null,
  arpeggiateBeats = 0,
  voiceGain = null,
} = {}) {
  if (!Array.isArray(chords)) throw new TypeError('SATB chords must be provided as an array.');
  const mutedSet = normalizeMutedSet(mutedVoices);
  const solo = typeof soloVoice === 'string' && SATB_VOICES.includes(soloVoice) ? soloVoice : null;
  const events = [];
  let cursor = 0;

  chords.forEach((chord, chordIndex) => {
    if (!chord || typeof chord !== 'object') return;
    const duration = Number.isFinite(Number(chord.duration)) && Number(chord.duration) > 0 ? Number(chord.duration) : 1;
    const onset = Number.isFinite(Number(chord.onset)) && Number(chord.onset) >= 0 ? Number(chord.onset) : cursor;
    cursor = Math.max(cursor, onset + duration);

    const voiceMap = chord.voices && typeof chord.voices === 'object' ? chord.voices : chord;
    const activeEntries = [];
    for (const voice of ARPEGGIO_ORDER) {
      if (!isVoiceEnabled(voice, mutedSet, solo)) continue;
      const entry = extractPitchEntry(voiceMap[voice]);
      if (entry) activeEntries.push({ voice, entry });
    }
    if (!activeEntries.length) return;

    const step = arpeggioStep(arpeggiateBeats, activeEntries.length, duration);
    activeEntries.forEach(({ voice, entry }, index) => {
      const offset = index * step;
      const noteDuration = Math.max(0.05, duration - offset);
      const gain = resolveVoiceGain(voiceGain, voice, activeEntries.length, chordIndex);
      const event = {
        id: entry.id ?? `satb-${chordIndex}-${voice}`,
        midi: entry.midi,
        onset: onset + offset,
        duration: noteDuration,
        gain,
        voice,
        chordIndex,
      };
      if (entry.spell !== undefined) event.spell = entry.spell;
      if (entry.display !== undefined) event.display = entry.display;
      events.push(event);
    });
  });

  return events.sort((a, b) => a.onset - b.onset || ARPEGGIO_ORDER.indexOf(a.voice) - ARPEGGIO_ORDER.indexOf(b.voice));
}

function extractBassFromSlot(slot, previewSlot) {
  if (slot && typeof slot === 'object') {
    const direct = extractPitchEntry(slot.bass ?? slot.voices?.B ?? (slot.midi !== undefined ? slot : null));
    if (direct) return direct;
  }
  if (previewSlot && typeof previewSlot === 'object') {
    const previewVoices = previewSlot.voices && typeof previewSlot.voices === 'object' ? previewSlot.voices : previewSlot;
    return extractPitchEntry(previewVoices.B ?? previewSlot.bass);
  }
  return null;
}

function extractInnerVoice(previewSlot, voice) {
  if (!previewSlot || typeof previewSlot !== 'object') return null;
  const voices = previewSlot.voices && typeof previewSlot.voices === 'object' ? previewSlot.voices : previewSlot;
  return extractPitchEntry(voices[voice]);
}

/**
 * Build playback events for melody harmonization (AP FRQ 7).
 * Modes:
 * - "melody": given Soprano melody only (preserving exact rhythm & NCTs).
 * - "outer": given Soprano melody + student's composed Bass line.
 * - "satb": given Soprano melody + student's Bass + auto-realized Alto & Tenor from satbPreview.
 */
export function buildMelodyHarmonizationEvents(melody, harmonization = [], satbPreview = [], {
  mode = 'outer',
  mutedVoices = new Set(),
  soloVoice = null,
  arpeggiateBeats = 0,
  voiceGain = null,
} = {}) {
  const melodyList = Array.isArray(melody) ? melody : [];
  const harmList = Array.isArray(harmonization) ? harmonization : [];
  const previewList = Array.isArray(satbPreview) ? satbPreview : [];
  const mutedSet = normalizeMutedSet(mutedVoices);
  const solo = typeof soloVoice === 'string' && SATB_VOICES.includes(soloVoice) ? soloVoice : null;

  const allowedVoices = mode === 'melody'
    ? new Set(['S'])
    : mode === 'satb'
      ? new Set(['S', 'A', 'T', 'B'])
      : new Set(['S', 'B']);

  const isAllowed = voice => allowedVoices.has(voice) && isVoiceEnabled(voice, mutedSet, solo);

  // Normalize melody notes while preserving exact rhythmic onsets and durations.
  const melodyNotes = [];
  let melodyCursor = 0;
  melodyList.forEach((note, index) => {
    if (!note || typeof note !== 'object') return;
    const duration = Number.isFinite(Number(note.duration)) && Number(note.duration) > 0 ? Number(note.duration) : 1;
    const onset = Number.isFinite(Number(note.onset)) && Number(note.onset) >= 0 ? Number(note.onset) : melodyCursor;
    melodyCursor = Math.max(melodyCursor, onset + duration);
    const entry = extractPitchEntry(note);
    if (!entry) return;
    melodyNotes.push({
      index,
      onset,
      duration,
      entry,
      chordIndex: Number.isInteger(note.chordIndex) ? note.chordIndex : null,
    });
  });

  // Normalize harmonic slots (from harmonization and/or satbPreview).
  const slotCount = Math.max(harmList.length, mode === 'satb' ? previewList.length : 0);
  const slots = [];
  let slotCursor = 0;
  for (let i = 0; i < slotCount; i++) {
    const harm = harmList[i] || null;
    const prev = previewList[i] || null;
    const rawDuration = harm?.duration ?? prev?.duration;
    const duration = Number.isFinite(Number(rawDuration)) && Number(rawDuration) > 0 ? Number(rawDuration) : 1;
    const rawOnset = harm?.onset ?? prev?.onset;
    const onset = Number.isFinite(Number(rawOnset)) && Number(rawOnset) >= 0 ? Number(rawOnset) : slotCursor;
    slotCursor = Math.max(slotCursor, onset + duration);
    slots.push({
      chordIndex: Number.isInteger(harm?.chordIndex) ? harm.chordIndex : i,
      onset,
      duration,
      B: isAllowed('B') ? extractBassFromSlot(harm, mode === 'satb' ? prev : null) : null,
      T: isAllowed('T') ? extractInnerVoice(prev, 'T') : null,
      A: isAllowed('A') ? extractInnerVoice(prev, 'A') : null,
    });
  }

  const findSlotIndex = onset => {
    for (let i = 0; i < slots.length; i++) {
      if (onset >= slots[i].onset - EPSILON && onset < slots[i].onset + slots[i].duration - EPSILON) return i;
    }
    return -1;
  };

  const events = [];
  const emittedMelodyIndices = new Set();

  // Emit harmonic slots (and roll any melody note attacking synchronously with the slot).
  if (mode !== 'melody') {
    for (const slot of slots) {
      const coincidingMelody = isAllowed('S')
        ? melodyNotes.find(m => !emittedMelodyIndices.has(m.index) && Math.abs(m.onset - slot.onset) <= EPSILON)
        : null;

      const simultaneous = [];
      if (slot.B) simultaneous.push({ voice: 'B', entry: slot.B, onset: slot.onset, duration: slot.duration, chordIndex: slot.chordIndex });
      if (slot.T) simultaneous.push({ voice: 'T', entry: slot.T, onset: slot.onset, duration: slot.duration, chordIndex: slot.chordIndex });
      if (slot.A) simultaneous.push({ voice: 'A', entry: slot.A, onset: slot.onset, duration: slot.duration, chordIndex: slot.chordIndex });
      if (coincidingMelody) {
        emittedMelodyIndices.add(coincidingMelody.index);
        simultaneous.push({
          voice: 'S',
          entry: coincidingMelody.entry,
          onset: coincidingMelody.onset,
          duration: coincidingMelody.duration,
          chordIndex: coincidingMelody.chordIndex ?? slot.chordIndex,
          melodyIndex: coincidingMelody.index,
        });
      }
      if (!simultaneous.length) continue;

      const minDur = Math.min(...simultaneous.map(item => item.duration));
      const step = arpeggioStep(arpeggiateBeats, simultaneous.length, minDur);
      simultaneous.forEach((item, idx) => {
        const offset = idx * step;
        const duration = Math.max(0.05, item.duration - offset);
        const gain = resolveVoiceGain(voiceGain, item.voice, simultaneous.length, item.chordIndex);
        const event = {
          id: item.entry.id ?? (item.voice === 'S' ? `melody-${item.melodyIndex}` : `harm-${item.chordIndex}-${item.voice}`),
          midi: item.entry.midi,
          onset: item.onset + offset,
          duration,
          gain,
          voice: item.voice,
          chordIndex: item.chordIndex,
        };
        if (item.entry.spell !== undefined) event.spell = item.entry.spell;
        if (item.entry.display !== undefined) event.display = item.entry.display;
        if (item.entry.nct !== undefined) event.nct = item.entry.nct;
        events.push(event);
      });
    }
  }

  // Emit remaining melody notes (all notes in melody mode, and passing/neighbor notes between chords in outer/satb modes).
  if (isAllowed('S')) {
    for (const m of melodyNotes) {
      if (emittedMelodyIndices.has(m.index)) continue;
      const slotIdx = mode === 'melody' ? -1 : findSlotIndex(m.onset);
      const activeSlot = slotIdx >= 0 ? slots[slotIdx] : null;
      const concurrentCount = 1 + (activeSlot ? Number(Boolean(activeSlot.B)) + Number(Boolean(activeSlot.T)) + Number(Boolean(activeSlot.A)) : 0);
      const chordIndex = m.chordIndex ?? activeSlot?.chordIndex ?? m.index;
      const gain = resolveVoiceGain(voiceGain, 'S', concurrentCount, chordIndex);
      const event = {
        id: m.entry.id ?? `melody-${m.index}`,
        midi: m.entry.midi,
        onset: m.onset,
        duration: m.duration,
        gain,
        voice: 'S',
        chordIndex,
      };
      if (m.entry.spell !== undefined) event.spell = m.entry.spell;
      if (m.entry.display !== undefined) event.display = m.entry.display;
      if (m.entry.nct !== undefined) event.nct = m.entry.nct;
      events.push(event);
    }
  }

  return events.sort((a, b) => a.onset - b.onset || ARPEGGIO_ORDER.indexOf(a.voice) - ARPEGGIO_ORDER.indexOf(b.voice));
}

/**
 * Concatenate before and after event lists with a silent gap for seamless single-transport A/B comparison.
 */
export function buildComparisonEvents(beforeEvents = [], afterEvents = [], { gapBeats = 1.5, tempoScale = 1 } = {}) {
  const scale = Number.isFinite(Number(tempoScale)) && Number(tempoScale) > 0 ? 1 / Number(tempoScale) : 1;
  const gap = Number.isFinite(Number(gapBeats)) && Number(gapBeats) >= 0 ? Number(gapBeats) : 1.5;

  const before = (Array.isArray(beforeEvents) ? beforeEvents : []).map((event, index) => ({
    ...event,
    id: event.id ?? `before-${index}`,
    onset: Number(event.onset) * scale,
    duration: Number(event.duration) * scale,
    phase: 'before',
  }));

  const beforeEndBeat = scoreDuration(before);
  const afterStartBeat = beforeEndBeat + gap;

  const after = (Array.isArray(afterEvents) ? afterEvents : []).map((event, index) => ({
    ...event,
    id: event.id ?? `after-${index}`,
    onset: afterStartBeat + Number(event.onset) * scale,
    duration: Number(event.duration) * scale,
    phase: 'after',
  }));

  const events = [...before, ...after].sort((a, b) => a.onset - b.onset);
  const totalDuration = after.length ? Math.max(afterStartBeat, scoreDuration(events)) : afterStartBeat;

  return { events, beforeEndBeat, afterStartBeat, totalDuration };
}

function normalizeExcerptEvents(source, options = {}) {
  if (!Array.isArray(source) || !source.length) return [];
  const looksLikeChords = source.some(item => item && typeof item === 'object' && item.voices && typeof item.voices === 'object');
  const rawEvents = looksLikeChords ? buildSatbEvents(source, options) : source.map(e => ({ ...e }));
  if (!rawEvents.length) return [];
  const minOnset = rawEvents.reduce((min, event) => Math.min(min, Number(event.onset) || 0), Infinity);
  const shifted = (!Number.isFinite(minOnset) || minOnset <= 0)
    ? rawEvents
    : rawEvents.map(event => ({ ...event, onset: Math.max(0, Number(event.onset) - minOnset) }));

  // Apply arpeggiation rolling and balanced gain to simultaneous raw clip events too.
  if (!looksLikeChords) {
    const groups = new Map();
    for (const ev of shifted) {
      const key = Number((Number(ev.onset) || 0).toFixed(4));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ev);
    }
    const requestedStep = Number(options.arpeggiateBeats) || 0;
    for (const group of groups.values()) {
      group.sort((a, b) => {
        const ai = ARPEGGIO_ORDER.indexOf(a.voice);
        const bi = ARPEGGIO_ORDER.indexOf(b.voice);
        if (ai >= 0 && bi >= 0 && ai !== bi) return ai - bi;
        return (Number(a.midi) || 0) - (Number(b.midi) || 0);
      });
      const minDur = group.reduce((m, e) => Math.min(m, Number(e.duration) || 1), Infinity);
      const step = arpeggioStep(requestedStep, group.length, minDur);
      group.forEach((ev, idx) => {
        if (!isValidGain(ev.gain)) ev.gain = balancedVoiceGain(group.length, ev.voice);
        if (step > 0 && idx > 0) {
          const offset = idx * step;
          ev.onset = (Number(ev.onset) || 0) + offset;
          ev.duration = Math.max(0.05, (Number(ev.duration) || 1) - offset);
        }
      });
    }
    shifted.sort((a, b) => a.onset - b.onset || ARPEGGIO_ORDER.indexOf(a.voice) - ARPEGGIO_ORDER.indexOf(b.voice));
  }
  return shifted;
}

function extractAuditionMidis(input) {
  if (Array.isArray(input)) {
    return input
      .map(item => (typeof item === 'number' ? item : item && typeof item === 'object' ? Number(item.midi) : NaN))
      .filter(midi => Number.isFinite(midi))
      .map(midi => Math.round(midi));
  }
  if (input && typeof input === 'object') {
    const voiceMap = input.voices && typeof input.voices === 'object' ? input.voices : input;
    return ARPEGGIO_ORDER
      .map(voice => extractPitchEntry(voiceMap[voice])?.midi)
      .filter(midi => Number.isFinite(midi));
  }
  return [];
}

/**
 * Stateful polyphonic playback controller for AP Music Theory exercises and audio demos.
 */
export class TheoryAudioController {
  constructor({
    player = null,
    tempo = 84,
    arpeggiate = false,
    arpeggiateBeats = 0.12,
    mutedVoices = [],
    soloVoice = null,
    onActiveEvents = () => {},
    onPhaseChange = () => {},
    onProgress = () => {},
    onState = () => {},
  } = {}) {
    this.onActiveEvents = onActiveEvents;
    this.onPhaseChange = onPhaseChange;
    this.onProgress = onProgress;
    this.onState = onState;

    this.state = 'stopped';
    this.mode = 'score';
    this.phase = 'score';
    this.tempo = tempoValue(tempo);
    this.arpeggiate = Boolean(arpeggiate);
    this.arpeggiateBeats = Number.isFinite(Number(arpeggiateBeats)) && Number(arpeggiateBeats) > 0 ? Number(arpeggiateBeats) : 0.12;
    this.mutedVoices = normalizeMutedSet(mutedVoices);
    this.soloVoice = typeof soloVoice === 'string' && SATB_VOICES.includes(soloVoice) ? soloVoice : null;

    this._comparison = null;
    this._ownsPlayback = false;
    this._ownedEvents = null;

    if (player) {
      this.player = player;
      const prevActive = player.onActiveEvents;
      const prevProgress = player.onProgress;
      const prevState = player.onState;
      const isOwned = () => this._ownsPlayback && (!this._ownedEvents || player.events === this._ownedEvents);
      player.onActiveEvents = events => {
        if (isOwned()) this._handleActiveEvents(events);
        else prevActive?.(events);
      };
      player.onProgress = (beat, duration) => {
        if (isOwned()) this._handleProgress(beat, duration);
        else prevProgress?.(beat, duration);
      };
      player.onState = state => {
        if (isOwned()) this._handleState(state);
        else prevState?.(state);
      };
    } else {
      this.player = new PianoPlayer({
        onActiveEvents: events => this._handleActiveEvents(events),
        onProgress: (beat, duration) => this._handleProgress(beat, duration),
        onState: state => this._handleState(state),
      });
    }
  }

  _setPhase(nextPhase, detail = {}) {
    if (this.phase !== nextPhase) {
      this.phase = nextPhase;
      this.onPhaseChange(nextPhase, detail);
    }
  }

  _handleActiveEvents(events) {
    if (this._comparison && events.length) {
      const eventPhase = events.find(e => e.phase === 'after' || e.phase === 'before')?.phase;
      if (eventPhase) this._setPhase(eventPhase, { ...this._comparison });
    }
    this.onActiveEvents(events);
  }

  _handleProgress(beat, duration) {
    if (this._comparison && this.state === 'playing') {
      const nextPhase = beat >= this._comparison.afterStartBeat - EPSILON ? 'after' : 'before';
      this._setPhase(nextPhase, { ...this._comparison, beat, duration });
    }
    this.onProgress(beat, duration);
  }

  _handleState(nextState) {
    this.state = nextState;
    this.onState(nextState);
    if (nextState === 'stopped') {
      this._comparison = null;
      this._ownsPlayback = false;
      this._ownedEvents = null;
    }
  }

  setTempo(bpm) {
    this.tempo = tempoValue(bpm);
    return this.tempo;
  }

  setArpeggiate(enabled, beats = this.arpeggiateBeats) {
    this.arpeggiate = Boolean(enabled);
    if (Number.isFinite(Number(beats)) && Number(beats) > 0) this.arpeggiateBeats = Number(beats);
  }

  setMutedVoices(voices) {
    this.mutedVoices = normalizeMutedSet(voices);
  }

  toggleMute(voice) {
    if (!SATB_VOICES.includes(voice)) return false;
    if (this.mutedVoices.has(voice)) {
      this.mutedVoices.delete(voice);
      return false;
    }
    this.mutedVoices.add(voice);
    if (this.soloVoice === voice) this.soloVoice = null;
    return true;
  }

  setSoloVoice(voice) {
    this.soloVoice = typeof voice === 'string' && SATB_VOICES.includes(voice) ? voice : null;
    return this.soloVoice;
  }

  toggleSolo(voice) {
    if (!SATB_VOICES.includes(voice)) return null;
    this.soloVoice = this.soloVoice === voice ? null : voice;
    return this.soloVoice;
  }

  get currentBeat() {
    return this._ownsPlayback ? this.player.currentBeat : 0;
  }

  get voiceOptions() {
    return {
      mutedVoices: new Set(this.mutedVoices),
      soloVoice: this.soloVoice,
      arpeggiateBeats: this.arpeggiate ? this.arpeggiateBeats : 0,
    };
  }

  async playEvents(events, {
    tempo = this.tempo,
    transpose = 0,
    mode = 'score',
    phase = mode,
    fromBeat = 0,
    loop = false,
    comparison = null,
  } = {}) {
    const resolvedTempo = tempoValue(tempo);
    this.tempo = resolvedTempo;
    this.mode = mode;
    this._comparison = comparison;
    const prevPhase = this.phase;
    this.phase = phase;
    if (prevPhase !== phase || comparison) this.onPhaseChange(phase, comparison ? { ...comparison } : { mode });

    const prepared = prepareEvents(events);
    if (!prepared.length) {
      this.stop();
      return;
    }

    this._ownsPlayback = true;
    this._ownedEvents = null;
    const playPromise = this.player.play(prepared, { tempo: resolvedTempo, transpose, fromBeat, loop });
    this._ownedEvents = this.player.events;
    await playPromise;
  }

  async playIsolatedDemo(audioDemo, tempo = this.tempo) {
    const source = Array.isArray(audioDemo)
      ? audioDemo
      : audioDemo?.isolatedEvents ?? audioDemo?.isolated ?? audioDemo?.events ?? [];
    const events = normalizeExcerptEvents(source, { arpeggiateBeats: this.arpeggiate ? this.arpeggiateBeats : 0 });
    await this.playEvents(events, { tempo, mode: 'isolated', phase: 'isolated' });
    return events;
  }

  async playContextDemo(audioDemo, tempo = this.tempo) {
    const source = Array.isArray(audioDemo)
      ? audioDemo
      : audioDemo?.contextEvents ?? audioDemo?.context ?? audioDemo?.isolatedEvents ?? audioDemo?.isolated ?? [];
    const events = normalizeExcerptEvents(source, { arpeggiateBeats: this.arpeggiate ? this.arpeggiateBeats : 0 });
    await this.playEvents(events, { tempo, mode: 'context', phase: 'context' });
    return events;
  }

  async playBeforeAfterComparison(audioDemo, tempo = this.tempo) {
    const arp = this.arpeggiate ? this.arpeggiateBeats : 0;
    const beforeSource = audioDemo?.beforeEvents ?? audioDemo?.before ?? audioDemo?.isolatedEvents ?? audioDemo?.isolated ?? [];
    const afterSource = audioDemo?.afterEvents ?? audioDemo?.after ?? audioDemo?.fixedEvents ?? audioDemo?.fixed ?? audioDemo?.suggestedEvents ?? audioDemo?.suggested ?? [];
    const before = normalizeExcerptEvents(beforeSource, { arpeggiateBeats: arp });
    const after = normalizeExcerptEvents(afterSource, { arpeggiateBeats: arp });
    const comparison = buildComparisonEvents(before, after, {
      gapBeats: audioDemo?.gapBeats ?? 1.5,
      tempoScale: audioDemo?.tempoScale ?? 1,
    });
    await this.playEvents(comparison.events, {
      tempo,
      mode: 'before',
      phase: 'before',
      comparison: {
        beforeEndBeat: comparison.beforeEndBeat,
        afterStartBeat: comparison.afterStartBeat,
        totalDuration: comparison.totalDuration,
      },
    });
    return comparison;
  }

  async auditionChord(midis, { arpeggiate = this.arpeggiate, arpeggiateSec, duration = 0.85, gain } = {}) {
    let pitches = extractAuditionMidis(midis);
    if (!pitches.length) return;
    if (arpeggiate) pitches = [...pitches].sort((a, b) => a - b);
    const stepSec = Number.isFinite(Number(arpeggiateSec))
      ? Math.max(0, Number(arpeggiateSec))
      : (arpeggiate ? this.arpeggiateBeats * 60 / this.tempo : 0);
    const resolvedGain = isValidGain(gain) ? gain : balancedVoiceGain(pitches.length);
    await this.player.previewChord(pitches, { arpeggiateSec: stepSec, duration, gain: resolvedGain });
  }

  pause() {
    this._ownsPlayback = true;
    this.player.pause();
    this.state = 'paused';
  }

  stop() {
    this._ownsPlayback = true;
    this.player.stop();
    this._comparison = null;
    this.state = 'stopped';
  }

  exportMidi(events, opts = {}) {
    return this.player.exportMidi(events, { tempo: this.tempo, transpose: 0, ...opts });
  }

  exportWav(events, opts = {}) {
    return this.player.exportWav(events, { tempo: this.tempo, transpose: 0, ...opts });
  }
}
