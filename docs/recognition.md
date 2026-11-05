# Local recognition

`staff2audio.omr.recognize(rgb_array)` processes a color image without sending it
to a service. The API returns independent five-line staves, clef, key signature,
meter, ordered note/rest events and image coordinates. Durations and onsets use
quarter-note beats, so an eighth note is `0.5` in either 4/4 or 6/8. The app can
keep every staff separately playable.

The engine finds long horizontal lines, groups equally spaced sets of five and
normalizes each crop to a 20-pixel staff space. It removes staff-line pixels while
preserving vertical intersections. Glyph templates locate solid/hollow heads,
clefs, accidentals, meter, flags and rests. Stem ownership rejects beam ends that
resemble a second head, and component isolation rejects beam rectangles that
resemble whole/half rests. Stem and beam geometry supplies duration and isolated
dot components supply dotted rhythms. A separate local threshold retains faint
scan barlines for accidental scope. The bottom staff line anchors diatonic pitch:
E4 in treble and G2 in bass.
Key alterations apply by letter; explicit accidentals persist for the same
letter and octave until a detected barline.

Every event includes `staff_step`, `letter`, `octave`, `natural_midi`, `alteration`,
`explicit_accidental` and `alteration_source`. The source is `key`, `explicit` or
`measure`. A key override should change events whose source is `key`, retaining
written and inherited accidentals. A clef override can derive new letter/octave
from `staff_step` using `staff2audio.music.staff_pitch`, then apply alterations.
Rest pitch fields are null. All `x`, `y`, staff-line and box coordinates refer to
the input image; normalization does not alter the image returned by the caller.

## Supported input and review requirements

Use complete, level, high-contrast printed staves. A staff space of roughly 10
pixels or more is recommended. Separate, monophonic treble/bass practice lines
are the intended use. The engine reads common major/minor key signatures, common
meters, ledger notes, quarter/half/whole notes, beamed/flagged subdivisions, dots,
ordinary accidentals and ordinary rests. Tonal mode is ambiguous from the key
signature alone, so the UI displays the corresponding major/minor pair.

Recognition produces an editable draft. Confidence is a local heuristic rather
than a calibrated probability. The engine does not interpret chords or voices,
ties, tuplets, repeats, grace notes, transposing instruments or expressive marks.
Tied notes therefore need manual consolidation. It does not join systems or infer
which independent staves belong to the same instrument. Handwriting, severe
rotation, perspective distortion and damaged or low-resolution scans can fail.
Review accidentals, rhythm, clef and key against the source before relying on
playback. A missing staff or failed note detection is surfaced as an error or
warning; a result is never a claim of verified transcription.

## Reproducible fixtures and provenance

`tools/generate_fixtures.py` draws original practice melodies with declarative
musical expectations. `make_demo_image()` supplies the public in-app example.
`python -m tools.generate_fixtures` writes the example to the ignored `tmp/`
directory. Tests check clefs, keys, ledger pitches, accidentals and their barline
scope, beams, dots, rests, multiple independent staves and image scaling.
The demo also has an independently specified pitch/duration transcription in
the tests. Additional checks cover isolated flags in both directions under slurs
and a faded JPEG image.

The supplied private six-page practice PDF was additionally rendered at a
2600-pixel maximum edge and processed locally. It contains 36 independent
staves. This is an integration evaluation, not a public benchmark or a guarantee
of accuracy on other engraving styles. Per-note source review remains necessary;
matching measure totals alone cannot verify pitch or rhythmic transcription.

The unmodified Bravura font is bundled under the SIL Open Font License; see
[`Bravura-LICENSE.txt`](../staff2audio/assets/Bravura-LICENSE.txt). Official source:
[Steinberg Bravura](https://github.com/steinbergmedia/bravura). It supplies local
glyph templates and synthetic notation. It is not installed into Windows.

Private evaluation scores and their rendered pages belong in ignored `tmp/`
only. They must not be committed or included in the public demo/report.
