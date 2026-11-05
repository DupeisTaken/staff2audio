# Independent refinement review: practice tempo and note names

Status: **accepted for the documented refinement scope; all eight dimensions exceed 9.5/10, minimum 9.6. Final artifact closure is complete.** The earlier final review remains preserved as evidence for the preceding application revision. This review initially inspected the tempo-default and contextual note-name changes based on `c8aa50f3558786f039d4d2e72e800518da1bcacc` and confirms feature commit `dea0f2a277b0900239bc7873bb544127825f214e` on 5 November 2026. The completed report and updated PR metadata are included in closure.

The recommendation is a product heuristic for a starting practice speed, not a printed score marking, an official exam standard, or a measured guarantee of sight-singability. One tempo is maintained throughout the selected staff. The shortest valid sounding subdivision influences the starting range relative to the displayed count unit; rests and invalid timings do not create false density.

## Source and pure-test observations

- Displayed pulse BPM is converted once through `options()` to quarter-note BPM. Playback, clocks, WAV and MIDI share that value; event durations and seek positions remain quarter-note counts.
- Compound 6/8 counts dotted quarters, 2/2 counts halves, and 3/8 explicitly counts eighths. Manual input bounds map to the engine's 30–240 quarter-note BPM rather than silently clamping a different audible tempo.
- Automatic recommendations refresh after rhythm edits. Manual choices are keyed by page/staff, retained across navigation within the same file, and cleared only after a new score succeeds. Use suggested removes the manual choice.
- Note names preserve validated written spelling, use key-aware names for manual/contextual MIDI, and handle C-flat/B-sharp octave crossings. Transposed labels follow the actual clamped MIDI pitch and transposed signature; names never mutate sound.
- The reviewer independently inspected test expectations and ran the final `node --test tests/tempo.test.mjs tests/note-names.test.mjs`: **41 passed, zero failed** (17 tempo + 24 naming), approximately 269 ms. The two additional naming cases preserve validated written enharmonics through octave shifts while respecting clamping/manual edits. This lightweight run is distinct from lead browser/audio verification.

## Findings reported to the lead

| Finding | Final disposition |
| --- | --- |
| Transpose change could leave an old pending/active audition sounding while its later highlight used the new transpose. | Source now invalidates the audition token/timer and cancels voices while preserving paused state or the stopped seek target. Lead first-load audition/transposition check finished with zero active highlights and a neutral note label; ready status still updates. Live loop/transposition and paused Resume were also exercised. |
| Changing tempo while stopped after seeking used the player's zero beat for the time label, although the slider and next playback retained the seek target. | Tempo and transpose handlers read the slider while stopped. Lead browser check retained beat7.95 through tempo and transpose changes and displayed0:07 at quarter60. Unfinished invalid tempo drafts do not drive playback clocks or export options. |

## Final dimension scores

| Dimension | Score | Refinement evidence |
| --- | ---: | --- |
| Input and local operation | 9.7/10 | Decoder unchanged; page/staff tempo memory and failed-upload preservation verified by source and browser evidence. |
| Staff, clef and key recognition | 9.6/10 | Prior recognition assessment retained; meter/key metadata is consumed without changing recognition or pitch. |
| Pitch, accidentals and timing | 9.6/10 | All15-key expectations, written accidentals/octaves, stale/manual cases and actual key-specific labels verified. |
| Grand piano and transport | 9.7/10 | One quarter-BPM boundary; independently inspected actual compound MIDI and WAV; audition/live transport fixes verified. |
| Integrated practice experience | 9.7/10 | Defaults, Auto, manual memory, rhythm refresh, page navigation and stopped-seek consistency verified. |
| Responsive UI and accessibility | 9.6/10 | Updated desktop/mobile screenshots inspected; pulse/range text and spoken accidental labels; no measured overflow. |
| Robustness, contracts and regression protection | 9.7/10 | Independent41-test pass and lead95-test JavaScript pass; pure helpers and explicit bounds preserve the engine contract. |
| Delivery, privacy and maintainability | 9.6/10 | Focused helpers, explanatory documentation, preserved prior review and clear heuristic provenance; refreshed public examples and final standalone report complete. |

## Export and browser evidence

The reviewer directly read the actual downloaded MIDI/WAV files, independently of the saved summary. Both MIDI files are format0 at480 ticks per quarter. Displayed dotted-quarter40 encodes **1,000,000 microseconds per quarter** (quarter60); displayed dotted-quarter45 encodes **888,889** (quarter67.5 within MIDI rounding). The six-quarter-beat default WAV is **6.16 seconds**, stereo **44.1 kHz /16-bit**, including the expected0.16-second release. No extra duration multiplier is applied.

Lead browser checks established ordinary default72quarter, dense default40dotted, manual65 surviving a rhythm edit while its recommendation changes to48–60, Use suggested applying56, note reset restoring Auto72, and manual42dotted retained across PDF page2/page1 navigation. Key-specific examples displayed G-sharp4 in A major, E-flat4 in B-flat major and written E-sharp3 in the real PDF. Desktop/mobile widths matched scroll widths at1425/375 pixels. Updated screenshots were independently inspected; they show coherent recommendation placement and no material layout defect.

The lead reports **95 JavaScript tests passed** (54 prior + 17 tempo + 24 naming). Python and recognition implementation remain unchanged. During final closure, the reviewer independently queried GitHub and confirmed that both full CI checks on feature commit `dea0f2a` succeeded, covering **39 Python and 95 JavaScript tests**. The reviewer did not run browsers or heavy recognition work concurrently; browser behavior is identified as lead-produced evidence, while source, helper tests, exported bytes and screenshots were independently inspected.

## Final artifact closure

The reviewer independently parsed the completed approximately 1.80 MB HTML report and inspected its full final screenshot. It contains all eight refinement ratings, four embedded synthetic screenshots, one embedded baseline PCM preview, the practice pulse/range table, beat-conversion and note-spelling explanations, and links to issues 4 and 5 and the ready-for-review PR. Every media source is embedded, and no assessment placeholder remains. The table and evidence text are readable without a material layout defect; the lead's browser measurements confirm no horizontal overflow at desktop and mobile widths.

The report, verification data and ratings agree: **39 Python tests, 95 JavaScript tests, minimum independent score 9.6/10**. The original review artifacts remain preserved. Documentation-only publication commits do not alter reviewed application behavior. No material blocker remains, and all eight dimension scores continue to exceed 9.5/10.

## Limits and conclusion

No material refinement blocker remains. All eight scores remain strictly above 9.5. The recommendation windows are transparent application starting points, not personalized vocal assessment or published tempo standards. Intervals, register, breath and familiarity are not modeled. One demanding sounding subdivision can slow the entire staff; it does not introduce per-measure tempo changes. Very small subdivisions can remain challenging at the engine minimum of 30 quarter-note BPM; ranges can collapse at a unit-compatible boundary.

Chromatic spelling uses a documented key-context policy when written metadata is absent or a non-octave transposition changes harmonic context. That policy cannot recover every intended harmonic function from MIDI alone. Naming never changes the audible pitch. Manual choices last for the current score session; reloading the app discards them. Original recognition and deployment limitations remain in force.
