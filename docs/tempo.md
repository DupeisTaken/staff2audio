# Sight-singing practice tempo

The automatic tempo is a conservative **starting suggestion for practice**, not a transcription of a printed tempo marking, an official sight-singing standard, or a guarantee that a phrase fits someone's voice. A comfortable speed depends on the singer, register, intervals, familiarity, text, and breath. The app keeps the suggestion transparent and lets the user override or reset it.

## Beat units and starting ranges

The displayed BPM counts the chosen musical pulse. It is not always quarter-note BPM.

| Meter/pulse | Ordinary beat divisions: range; default | Smaller beat subdivisions: base range; default |
| --- | --- | --- |
| Simple meter, e.g. 4/4: quarter-note pulse | 60–80; **72** | 48–60; **56** |
| Compound 6/8, 9/8, 12/8: dotted-quarter pulse | 40–56; **48** | 36–44; **40** |

These numerical windows are application design choices, selected as slow practice starting points. They are not taken from a pedagogical publication. Density is measured **relative to the displayed beat**, rather than by an absolute written note value:

```text
shortest pulse fraction = shortest sounding quarter-note duration / beat factor
dense = shortest pulse fraction < 1/2 (simple) or < 1/3 (compound)
```

A tolerance of 1e-9 pulse units prevents floating-point noise at an ordinary division from changing the category. The dense base windows assume a shortest value of 1/4 of a simple beat or 1/6 of a compound beat. Faster values scale the base minimum, maximum, and default by `min(1, shortest pulse fraction / reference fraction)`, then round and clamp to the supported tempo bounds. Thus the common 4/4 sixteenth and 6/8 sixteenth keep their defaults of quarter 56 and dotted-quarter 40; still shorter subdivisions slow further.

Rests and invalid/nonpositive durations do not activate density. Every valid sounding note is considered regardless of confidence: an uncertain false positive may slow practice, while ignoring a genuine fast note could make the default too difficult. The app's recognition warning and manual tempo override address that uncertainty. No confidence threshold, pitch-leap score, or inferred expertise level changes the tempo.

The meter grouping follows the standard compound-beat convention: 6/8 contains two groups of three eighths, so its pulse is a dotted quarter. For a source explanation of compound grouping and beat counts, see Nick Schumacher and James Sullivan, [“Compound Duple Meter as 6/8,” *Ear Training And Sight Singing I and II*](https://openbooks.lib.msu.edu/ear-training/chapter/basic-6-8/). This source supports the beat-unit interpretation, not the app's BPM windows.

Simple meter uses `4 / denominator` quarter notes per displayed beat: 2/2 displays half-note BPM, 3/8 displays eighth-note BPM. The app intentionally does not infer a one-beat-per-bar interpretation for 3/8. Numerators 6, 9, and 12 use compound grouping with `12 / denominator` quarter notes per displayed beat: 6/16 displays a dotted eighth, for example. Valid denominators are 1, 2, 4, 8, 16, and 32; numerators are 1–32. Irregular meters use denominator counting rather than guessing additive groups. `C` means 4/4 and `¢` means 2/2. A missing/unrecognized meter falls back to quarter-note counting and says so in the reason.

The same base pulse windows apply to other simple/compound denominators, while relative subdivision density and the engine bounds below determine the final range. For example, 2/2 eighths are quarters of a half-note pulse, so they select half-note 56 (quarter 112); 2/2 sixteenths halve that to half-note 28 (quarter 56). In 3/8, sixteenths are ordinary halves of the eighth-note pulse, so the default stays eighth-note 72 (quarter 36). A 4/4 thirty-second scales the default to quarter 28 before the engine minimum clips it to quarter 30.

There is one steady recommended tempo per selected staff. Measure numbers, event order, and empty measures do not cause tempo changes during playback. This policy does not implement automatic rubato or different speeds for individual measures.

## Selecting a BPM preset

The player offers exact numeric presets beside the manual tempo input. Numbers count the displayed beat: choosing **60 BPM** in 6/8 means 60 dotted-quarter beats per minute, or 90 quarter BPM for playback and export. The selector's accessible name spells out that beat unit.

Common choices are 30, 40, 48, 56, 60, 72, 80, 90, 100, 120, 144, 160, 180, 200, 240, 300, 360 and 480 BPM. `tempoPresets(factor = 1)` filters those numbers to the engine-compatible integer range and adds the range endpoints, sorted without duplicates. Out-of-range choices are omitted rather than silently changed. This is a convenience list of product choices, not an interpretation of printed tempo markings.

Choosing a preset uses the same tempo path as typing a number, updates clocks and active playback, and is remembered for the selected page/staff within the current document. The selector follows manual edits and staff/page navigation. A value outside the preset list appears as **Custom · N BPM**; arbitrary supported manual input remains available. **Use suggested** clears the saved override and restores the automatic starting pulse. Both tempo controls are disabled when no staff is available or the page is loading. Tempo choices are discarded on a new document or browser reload.

## Quarter-note engine contract

Recognition durations, onsets, seek positions, Web Audio scheduling, and MIDI tempo events retain their existing quarter-note semantics. Convert only the UI tempo:

```text
quarter BPM = displayed BPM × quarter notes per displayed beat
```

Examples: dotted-quarter 48 in 6/8 equals quarter 72; dotted-quarter 40 equals quarter 60; half-note 72 in 2/2 equals quarter 144; eighth-note 72 in 3/8 equals quarter 36. Pass the converted quarter BPM to `PianoPlayer` for playback, clocks, WAV, and MIDI. Do not multiply event durations or change their measure offsets.

The engine supports 30–240 quarter BPM. The **manual input bounds**, distinct from the recommended practice window, are:

```text
minimum displayed integer BPM = ceil(30 / factor)
maximum displayed integer BPM = floor(240 / factor)
```

For quarter/dotted-quarter/half/eighth pulses these are 30–240, 20–160, 15–120, and 60–480 respectively. Recommendation endpoints and default are clipped to those bounds. Consequently, the slower 3/8 recommendation for thirty-second notes collapses to eighth-note 60, equal to the engine minimum of quarter 30. Uncommon small/large denominator meters can similarly narrow the recommended window. Very fast written subdivisions may still be difficult at this minimum: the app cannot guarantee a singable speed beyond its transport bounds. A user may choose a valid manual BPM outside the suggested practice range.

## Pure helper API

`static/tempo.js` has no DOM, audio, network, storage, or mutation side effects:

```js
import {
  recommendTempo, clampDisplayBpm, toQuarterBpm, fromQuarterBpm,
} from './tempo.js';

const policy = recommendTempo(staff);
// { bpm, minBpm, maxBpm, quarterBpm, quarterNotesPerBeat,
//   beatLabel, beatSymbol, unitLabel, reason }
const displayed = clampDisplayBpm(input.value, policy.quarterNotesPerBeat);
const engineTempo = toQuarterBpm(displayed, policy.quarterNotesPerBeat);
const displayedAgain = fromQuarterBpm(engineTempo, policy.quarterNotesPerBeat);
```

`bpm`, `minBpm`, and `maxBpm` describe the suggested default/window in display units. `quarterBpm` is the default converted for the engine. `beatLabel` is plain text such as `dotted quarter note`; `beatSymbol` is notation such as `♩.`; `unitLabel` is `dotted quarter note BPM`. `reason` explains the meter/density choice and that the range is a starting suggestion. Read the complete text when an accessible description is needed; the music glyph alone should not be the label.

`clampDisplayBpm(value, factor = 1)` accepts a number or nonempty numeric string, rounds to an integer, and clamps to the manual engine-compatible display bounds. Invalid/empty input defaults to displayed 72 before clamping. UI code may instead restore the current saved value or automatic default on invalid input.

`toQuarterBpm(value, factor = 1)` scales and clamps the result to 30–240 without rounding intermediate values. `fromQuarterBpm(value, factor = 1)` clamps quarter BPM to 30–240 and divides by the factor, preserving fractional display BPM. Invalid/empty values in either conversion fall back to quarter 72. Preserving fractions permits exact roundtrips; rounding is an explicit UI input decision. Unsupported factors throw `RangeError` rather than returning an infinite tempo or reversed display bounds. Factors from `recommendTempo` always satisfy these requirements.

The root UI owns automatic/reset behavior, the manual choice for each page/staff, and applying the factor to playback/export/time displays. The helper only reads the staff. Changing clef/key and reviewing notes retains the notation editor's semantics; a manual tempo preference should not be overwritten by recomputing a suggestion.

## Verification

Run `node --test tests/tempo.test.mjs`. The independent cases cover simple eighths versus short notes, low-confidence short-note conservatism, compound grouping/conversion, beat-relative density in 2/2 and 3/8, faster-subdivision scaling, floating-point tolerance, invalid meters, empty/rest-only events, input bounds, fractional roundtrips, all supported meter-derived factor bounds, and steady staff-wide suggestions. These tests establish the policy and unit conversions; they do not measure a person's sight-singing ability.

Preset tests cover the quarter/dotted-quarter/half/eighth choice lists, sorted unique integer bounds for every recognized meter, exact engine conversion and invalid factors. `npm run test:browser` exercises the actual local server and sampled audio: disabled state, manual/custom/reset synchronization, keyboard selection, per-staff and two-page PDF persistence, new-document reset, tempo changes during playback, MIDI tempo bytes, WAV duration and layouts from 320 to 1440 px. See [development setup](../README.md#development-and-checks) and the [self-contained report](bpm-presets-report.html).
