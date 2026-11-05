# Written and sounding note names

`static/note-names.js` keeps note naming separate from sound. MIDI numbers remain
unchanged. `pitchName(midi, keySignature)` (also exported as `nameForMidi`) spells
all seven scale members using their key-signature letters. This includes E-sharp
and B-sharp in sharp keys, and C-flat and F-flat in flat keys. Chromatic pitches
use sharps in sharp/C keys and flats in flat keys. `null` is `Rest`; other pitches
must be integer MIDI values from 0 through 127. Invalid signatures fall back to C.

`eventName(event, staff, { transpose: 0 })` preserves recognized `letter`, `octave`
and `alteration` whenever their computed MIDI matches the event and `manualPitch`
is false. This preserves written chromatic accidentals even when a different
enharmonic is a scale member: D-sharp remains D-sharp in E-flat major. It also
retains double alterations and written octave boundaries (C-flat4 sounds B3;
B-sharp3 sounds C4). Explicit natural cancellations display the usual unaltered
pitch name, such as F4. Manual pitches and inconsistent/stale metadata use the
actual MIDI and selected key. `event.name` is deliberately not trusted.

Whole-octave transposition preserves valid recognized spelling and moves its
written octave, including explicit chromatic and double accidentals. It does so
only when the sounding pitch remains in MIDI range. Other transpositions and
clamped pitches use contextual spelling of the actual 0–127 piano pitch.
`transposedKeySignature(signature, semitones)` moves the key's tonic and selects
among the conventional fifteen signatures. It preserves the original sharp/flat
orientation where that gives an enharmonic choice, then minimizes accidentals.
A neutral key uses the least accidental spelling. This is a display policy;
relative major/minor signatures share the same alterations, and chromatic
harmonic function cannot be recovered from MIDI alone.

Use `eventName` for existing-note markers, tooltips, review rows and active-note
labels. Use `pitchName` for general keyboard labels. Pitch-select option names
can use `eventName({ ...event, midi: candidate }, staff)`: only a candidate whose
MIDI still validates the written metadata retains the recognized spelling.
`spokenPitchName(name)` expands musical symbols into plain words for accessible
labels, including natural, sharp, flat, double sharp and double flat.

The tests specify independent expected names and MIDI values for all fifteen key
signatures, plus chromatic spelling, explicit naturals, octave boundaries,
double alterations, stale/manual edits, rests, transposition and MIDI bounds.
