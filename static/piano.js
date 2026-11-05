// Local sampled piano. AudioContext time, rather than DOM timers, owns note timing.
const RELEASE = 0.14;
const LOOKAHEAD = 2;
const LEAD = 0.035;
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const tempoValue = value => clamp(finite(value, 90), 30, 240);
export const transposeMidi = (midi, transpose = 0) => clamp(Math.round(midi + finite(transpose, 0)), 0, 127);

export function prepareEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('A score must contain an array of notes.');
  if (events.length > 20000) throw new RangeError('This score exceeds the 20,000 event limit.');
  return events.map((e, index) => {
    const onset = Number(e.onset), duration = Number(e.duration);
    if (!Number.isFinite(onset) || onset < 0 || !Number.isFinite(duration) || duration <= 0 ||
        (e.midi !== null && (!Number.isFinite(e.midi) || e.midi < 0 || e.midi > 127))) {
      throw new RangeError(`Invalid note timing or pitch at event ${index + 1}.`);
    }
    return { ...e, onset, duration, midi: e.midi === null ? null : Math.round(e.midi) };
  }).sort((a, b) => a.onset - b.onset);
}

export function scoreDuration(events) {
  return events.reduce((end, event) => Math.max(end, event.onset + event.duration), 0);
}

export function noteNumber(name) {
  const match = /^([A-G])(b|#)?(-?\d+)$/.exec(name);
  if (!match) throw new Error(`Invalid sample note ${name}`);
  return (Number(match[3]) + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]] +
    (match[2] === 'b' ? -1 : match[2] === '#' ? 1 : 0);
}

export function nearestSample(midi, buffers) {
  if (buffers.has(midi)) return { buffer: buffers.get(midi), rate: 1 };
  let nearest = null;
  for (const pitch of buffers.keys()) if (nearest === null || Math.abs(pitch - midi) < Math.abs(nearest - midi)) nearest = pitch;
  if (nearest === null) throw new Error('The piano samples have not loaded.');
  return { buffer: buffers.get(nearest), rate: 2 ** ((midi - nearest) / 12) };
}

function voice(context, destination, buffers, midi, when, duration, elapsed = 0) {
  const { buffer, rate } = nearestSample(midi, buffers);
  const offset = elapsed * rate;
  if (offset >= buffer.duration) return null; // A naturally decayed note stays silent after seeking.
  const source = context.createBufferSource(), envelope = context.createGain();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  source.connect(envelope);
  envelope.connect(destination);
  const end = when + duration;
  envelope.gain.setValueAtTime(0, when);
  envelope.gain.linearRampToValueAtTime(0.8, when + Math.min(0.004, duration / 2));
  envelope.gain.setValueAtTime(0.8, end);
  envelope.gain.linearRampToValueAtTime(0, end + RELEASE);
  source.start(when, offset);
  source.stop(end + RELEASE + 0.005);
  const item = { source, envelope };
  source.onended = () => { source.disconnect(); envelope.disconnect(); item.onended?.(); };
  return item;
}

export class PianoPlayer {
  constructor({ onNote = () => {}, onProgress = () => {}, onState = () => {} } = {}) {
    this.onNote = onNote; this.onProgress = onProgress; this.onState = onState;
    this.context = null; this.master = null; this.buffers = new Map();
    this.events = []; this.state = 'stopped'; this.tempo = 90; this.transpose = 0; this.loop = false;
    this._duration = 0; this._beat = 0; this._generation = 0; this._voices = new Set();
    this._volume = 0.75; this._loading = null; this._timer = null; this._lastNote = undefined;
  }

  async load() {
    if (!this.context) {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) throw new Error('This browser does not support Web Audio. Please use a current Chrome, Edge, Firefox or Safari.');
      this.context = new Audio();
      this.master = this.context.createGain();
      this.master.gain.value = this._volume;
      this.master.connect(this.context.destination);
    }
    if (!this._loading) {
      this._loading = (async () => {
        const response = await fetch(new URL('./audio/grand-piano.json', import.meta.url));
        if (!response.ok) throw new Error('The local piano samples could not be loaded. Reload the page and try again.');
        const { samples } = await response.json();
        const entries = Object.entries(samples);
        // Decode four at a time to keep mobile devices responsive.
        const decoded = new Map();
        for (let i = 0; i < entries.length; i += 4) {
          await Promise.all(entries.slice(i, i + 4).map(async ([name, data]) => {
            const raw = atob(data.slice(data.indexOf(',') + 1));
            const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
            decoded.set(noteNumber(name), await this.context.decodeAudioData(bytes.buffer));
          }));
        }
        if (decoded.size !== 88) throw new Error('The local piano sample collection is incomplete.');
        this.buffers = decoded;
        return this;
      })().catch(error => { this._loading = null; throw error; });
    }
    return this._loading;
  }

  get duration() { return this._duration; }
  get currentBeat() {
    if (this.state !== 'playing') return this._beat;
    const beat = this._anchorBeat + Math.max(0, this.context.currentTime - this._anchorTime) * this.tempo / 60;
    return this.loop && this._duration > 0 ? beat % this._duration : Math.min(beat, this._duration);
  }

  async play(events = this.events, { tempo = this.tempo, transpose = this.transpose, fromBeat = this.state === 'stopped' && this._beat >= this._duration ? 0 : this._beat, loop = this.loop } = {}) {
    const prepared = prepareEvents(events), duration = scoreDuration(prepared);
    if (duration * 60 / tempoValue(tempo) > 1800) throw new RangeError('Playback is limited to 30 minutes per score.');
    this._halt();
    const generation = ++this._generation;
    this.events = prepared; this._duration = duration; this._beat = clamp(finite(fromBeat, 0), 0, duration);
    this.tempo = tempoValue(tempo); this.transpose = Math.round(finite(transpose, 0)); this.loop = Boolean(loop);
    this.state = 'paused';
    try {
      // Resume immediately in the user gesture before waiting for sample decoding.
      const loading = this.load();
      await Promise.all([loading, this.context ? this.context.resume() : Promise.resolve()]);
    } catch (error) {
      if (generation === this._generation) { this.state = 'stopped'; this.onState('stopped'); }
      throw error;
    }
    if (generation !== this._generation) return;
    if (!duration || (!this.loop && this._beat >= duration)) { this.stop(); return; }
    if (this._beat >= duration) this._beat = 0;
    this._anchorBeat = this._beat; this._anchorTime = this.context.currentTime + LEAD;
    this._cycleTime = this._anchorTime; this._cycleFrom = this._beat; this._nextIndex = 0;
    this.state = 'playing'; this._lastNote = undefined; this.onState('playing');
    this._tick();
    this._timer = setInterval(() => this._tick(), 40);
  }

  _tick() {
    if (this.state !== 'playing') return;
    const now = this.context.currentTime, secondsPerBeat = 60 / this.tempo;
    const horizon = now + LOOKAHEAD;
    // Schedule in advance; the UI interval never determines audible note timing.
    // A suspended/background tab can wake late: skip expired voices, retain phase.
    const cycleLength = this._duration * secondsPerBeat;
    if (this.loop && now - this._cycleTime > cycleLength + LOOKAHEAD) {
      const cycle = Math.floor((now - this._anchorTime + this._anchorBeat * secondsPerBeat) / cycleLength);
      this._cycleTime = this._anchorTime - this._anchorBeat * secondsPerBeat + cycle * cycleLength;
      this._cycleFrom = 0; this._nextIndex = 0;
    }
    let guard = 0;
    while (guard++ < 50000) {
      if (this._nextIndex >= this.events.length) {
        if (!this.loop) break;
        const nextCycle = this._cycleTime + (this._duration - this._cycleFrom) * secondsPerBeat;
        if (nextCycle >= horizon) break;
        this._cycleTime = nextCycle; this._cycleFrom = 0; this._nextIndex = 0;
      }
      const event = this.events[this._nextIndex];
      if (event.onset + event.duration <= this._cycleFrom) { this._nextIndex++; continue; }
      const onset = Math.max(event.onset, this._cycleFrom);
      const when = this._cycleTime + (onset - this._cycleFrom) * secondsPerBeat;
      if (when > horizon) break;
      this._nextIndex++;
      const end = this._cycleTime + (event.onset + event.duration - this._cycleFrom) * secondsPerBeat;
      if (event.midi === null || end <= now) continue;
      const start = Math.max(when, now);
      const elapsed = Math.max(0, this._cycleFrom - event.onset) * secondsPerBeat + Math.max(0, now - when);
      const item = voice(this.context, this.master, this.buffers, transposeMidi(event.midi, this.transpose), start, end - start, elapsed);
      if (item) { this._voices.add(item); item.onended = () => this._voices.delete(item); }
    }
    const beat = this.currentBeat;
    const active = this.events.find(e => e.midi !== null && e.onset <= beat && e.onset + e.duration > beat) || null;
    if (active !== this._lastNote) {
      this._lastNote = active;
      this.onNote(active ? { ...active, playedMidi: transposeMidi(active.midi, this.transpose) } : null);
    }
    this.onProgress(beat, this._duration);
    if (!this.loop && now >= this._anchorTime + (this._duration - this._anchorBeat) * secondsPerBeat) {
      // Allow the final acoustic release to finish; stop/pause still cancel every voice.
      clearInterval(this._timer); this._timer = null; this._beat = this._duration;
      this.state = 'stopped'; this.onNote(null); this.onState('stopped');
    }
  }

  _halt() {
    clearInterval(this._timer); this._timer = null;
    for (const item of this._voices) {
      try {
        const now = this.context.currentTime;
        // Short cancellation fades avoid clicks, and cancel future envelope ramps.
        if (item.envelope.gain.cancelAndHoldAtTime) item.envelope.gain.cancelAndHoldAtTime(now);
        else item.envelope.gain.cancelScheduledValues(now);
        item.envelope.gain.setTargetAtTime(0, now, 0.003);
        item.source.stop(now + 0.02);
      } catch { /* Already ended. */ }
    }
    this._voices.clear();
    this._lastNote = undefined;
  }

  pause() {
    this._beat = this.currentBeat;
    ++this._generation; this._halt(); this.state = 'paused';
    this.onNote(null); this.onState('paused'); this.onProgress(this._beat, this._duration);
  }

  stop() {
    ++this._generation; this._halt(); this._beat = 0; this.state = 'stopped';
    this.onNote(null); this.onState('stopped'); this.onProgress(0, this._duration);
  }

  seek(beat) {
    const target = clamp(finite(beat, 0), 0, this._duration);
    if (this.state === 'playing') return this.play(this.events, { fromBeat: target });
    ++this._generation; this._beat = target;
    this.onNote(null); this.onProgress(target, this._duration);
    return Promise.resolve();
  }

  setVolume(value) {
    this._volume = clamp(finite(value, 0.75), 0, 1);
    if (this.master) this.master.gain.setTargetAtTime(this._volume, this.context.currentTime, 0.015);
  }

  async preview(midi) {
    if (!Number.isFinite(midi)) return;
    const generation = this._generation;
    const loading = this.load();
    await Promise.all([loading, this.context ? this.context.resume() : Promise.resolve()]);
    if (generation !== this._generation) return;
    const item = voice(this.context, this.master, this.buffers, transposeMidi(midi), this.context.currentTime + 0.005, 0.65);
    if (item) { this._voices.add(item); item.onended = () => this._voices.delete(item); }
  }

  async exportWav(events, { tempo = this.tempo, transpose = this.transpose } = {}) {
    const prepared = prepareEvents(events), secondsPerBeat = 60 / tempoValue(tempo);
    const duration = scoreDuration(prepared) * secondsPerBeat + RELEASE + 0.02;
    if (duration > 600) throw new RangeError('WAV export is limited to 10 minutes. Use MIDI for longer scores.');
    await this.load();
    const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (!Offline) throw new Error('WAV export is not supported by this browser. Please download MIDI instead.');
    const context = new Offline(2, Math.max(1, Math.ceil(duration * 44100)), 44100);
    const gain = context.createGain(); gain.gain.value = this._volume; gain.connect(context.destination);
    for (const event of prepared) if (event.midi !== null) voice(context, gain, this.buffers,
      transposeMidi(event.midi, transpose), event.onset * secondsPerBeat, event.duration * secondsPerBeat);
    return new Blob([encodeWav(await context.startRendering())], { type: 'audio/wav' });
  }

  exportMidi(events, options = {}) {
    return new Blob([encodeMidi(events, { tempo: this.tempo, transpose: this.transpose, ...options })], { type: 'audio/midi' });
  }
}

export function encodeWav(buffer) {
  const channels = buffer.numberOfChannels, length = buffer.length;
  const array = new ArrayBuffer(44 + length * channels * 2), view = new DataView(array);
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, array.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data');
  view.setUint32(40, length * channels * 2, true);
  const data = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
  for (let frame = 0; frame < length; frame++) for (let channel = 0; channel < channels; channel++) {
    const sample = clamp(data[channel][frame], -1, 1);
    view.setInt16(44 + (frame * channels + channel) * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return array;
}

function variableLength(value) {
  const bytes = [value & 127];
  while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128);
  return bytes;
}

export function encodeMidi(events, { tempo = 90, transpose = 0 } = {}) {
  const prepared = prepareEvents(events), ticks = 480;
  if (scoreDuration(prepared) * ticks > 0x0fffffff) throw new RangeError('The score is too long for a MIDI file.');
  const micros = Math.round(60000000 / tempoValue(tempo));
  const changes = [];
  for (const event of prepared) if (event.midi !== null) {
    const pitch = transposeMidi(event.midi, transpose), start = Math.round(event.onset * ticks);
    changes.push({ time: start, order: 1, data: [0x90, pitch, 90] });
    changes.push({ time: Math.max(start + 1, Math.round((event.onset + event.duration) * ticks)), order: 0, data: [0x80, pitch, 0] });
  }
  changes.sort((a, b) => a.time - b.time || a.order - b.order);
  const track = [0, 0xff, 0x51, 3, (micros >> 16) & 255, (micros >> 8) & 255, micros & 255, 0, 0xc0, 0];
  let previous = 0;
  for (const event of changes) { track.push(...variableLength(event.time - previous), ...event.data); previous = event.time; }
  track.push(...variableLength(Math.max(0, Math.round(scoreDuration(prepared) * ticks) - previous)), 0xff, 0x2f, 0);
  const size = track.length;
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0,
    0x4d, 0x54, 0x72, 0x6b, (size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, ...track]);
}
