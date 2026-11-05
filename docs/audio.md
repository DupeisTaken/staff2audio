# Local sampled piano

`static/piano.js` exports `PianoPlayer`. The browser fetches only `./audio/grand-piano.json` relative to that module and decodes 88 local MP3 samples. No CDN, external request, executable soundfont script, oscillator substitute, API key, or audio device permission is required. Run the application over HTTP rather than opening HTML with `file://`.

The recordings are FluidR3 GM Acoustic Grand Piano, A0–C8; see [attribution and license details](../static/audio/ATTRIBUTION.md). Out-of-range pitches use the closest sampled key at the correct playback rate. MIDI pitches are clamped to 0–127. A piano sample naturally decays; sustaining a key beyond its recorded decay does not create an artificial oscillator loop.

## API

```js
const piano = new PianoPlayer({
  onNote: event => {},         // Original event + playedMidi, or null for a rest/end.
  onProgress: (beat, total) => {},
  onState: state => {},        // 'playing', 'paused', or 'stopped'.
});
await piano.load();
await piano.play(events, { tempo: 90, transpose: 0, fromBeat: 0, loop: false });
piano.pause();
await piano.play();            // Resume saved score, position, and settings.
await piano.seek(2);           // Quarter-note beats; preserves current state/settings.
piano.stop();                  // Cancels scheduled/preview voices, resets to beat zero.
piano.setVolume(0.75);         // 0–1, smooth gain change; zero is respected.
await piano.preview(60);       // Absolute MIDI pitch; caller applies transpose if desired.
const wav = await piano.exportWav(events, { tempo: 90, transpose: 0 });
const midi = piano.exportMidi(events, { tempo: 90, transpose: 0 });
```

`events` are `{midi: number|null, onset: number, duration: number, ...metadata}`. Onsets/durations are quarter-note beats, independent of tempo and time signature. Rests use `midi: null`. Invalid timing/pitch is rejected rather than silently changing the score. The read-only `currentBeat` and `duration` properties and `.state` support UI controls. `load`, `play`, `preview`, `seek`, and WAV export return promises; callers should display failures. Call playback or preview from a user gesture to satisfy browser autoplay rules. `load` is idempotent and retries a failed sample request.

`play` replaces a running performance and invalidates any older pending load/start. `pause` retains the audio-clock position; `stop` also cancels a pending start. `seek` returns a promise and restarts scheduling at the new beat when playing. Seeking into a sustained note starts at the corresponding sample offset, so it does not repeat its attack. Natural completion leaves progress at the final beat and reports `stopped`; `play()` then starts from zero. An explicit `fromBeat: duration` on a non-looping score stops/resets; UI play buttons can use `fromBeat: piano.currentBeat >= piano.duration ? 0 : piano.currentBeat`.

## Timing and exports

Notes are scheduled against `AudioContext.currentTime` with a 35 ms initial lead, a two-second lookahead, and a 40 ms scheduling/UI interval. Timers update progress and keep the scheduling window populated; they do not time individual audible notes. Loop cycles share exact audio-clock boundaries. If a tab is suspended longer than the scheduling window, elapsed notes are skipped and phase is recovered; browsers can suspend audio on locked/mobile devices. Overlapping notes are supported, while `onNote` reports the first currently active note for the monophonic score UI.

WAV exports use `OfflineAudioContext`, the same sampled instrument, tempo, transposition, gain, and release envelope as playback: stereo, 44.1 kHz, 16-bit PCM. MIDI exports are type 0, 480 ticks per quarter note, grand-piano program 0, with a tempo event and explicit note-offs; trailing rests are preserved. Volume applies to WAV and live audio; standard MIDI uses fixed note velocity and is rendered by the receiving player's piano. MIDI contains no audio samples. Export ignores the transport position/loop and renders the complete selected staff once.

Limits keep local memory use predictable: 20,000 events, 30 minutes of playback at the selected tempo, and 10 minutes per WAV export. MIDI supports longer scores up to the standard delta-time bound. WAV rendering at its limit can use several hundred MB; MIDI is a lightweight alternative.

Run `node --test tests/audio.test.mjs`. Tests cover format bytes and timing/lifecycle decisions with a fake audio clock. Browser verification must additionally decode the real MP3s and render a short WAV to establish actual audio output; Node tests do not establish audible device output.
