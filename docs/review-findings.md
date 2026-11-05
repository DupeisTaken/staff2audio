# Independent final review

**Accepted within the documented clean printed monophonic scope. Every dimension exceeds 9.5/10; the minimum is 9.6.**

Reviewed application commit: `50e896c6ea7835715ded58ff9e644b0865d670e3`, 5 November 2026. Machine-readable rows are in `docs/final-review.json`. **Final artifact closure is complete:** the standalone report contains all eight ratings, its obsolete assessment placeholder is removed, and its final render has been inspected. Subsequent behavioral changes require reassessment.

Scores describe implementation quality within the stated scope and the evidence inspected. They are not transcription accuracy percentages, a benchmark for arbitrary music, a guarantee that every clean score is correct, or a claim that every browser/device was tested.

## Scores

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Input and local operation | 9.7/10 | Real image/PDF decode; 26 API/boundary tests; bounded in-memory uploads; page selection; actual decoder images match the evaluated rasters; local assets. |
| Staff, clef and key recognition | 9.6/10 | Six pages and 36 staves processed; independent visual sampling on every page, both clefs and multiple signatures; repaired two-sharp key verified. |
| Pitch, accidentals and timing | 9.6/10 | Thirteen complete staff sequences / 258 pitch-duration pairs independently compared, plus targeted passages; all match final arrays, including all 97 final-page events. |
| Grand piano and transport | 9.7/10 | Actual 88-sample decode; 15 audio tests; browser transport evidence; independently measured non-silent PCM with expected format, duration and D4-frequency content. |
| Integrated practice experience | 9.7/10 | Real upload/paste, page/staff selection, corrections, overrides and downloads; seek/audition regressions verified fixed; export concurrency guarded. |
| Responsive UI and accessibility | 9.6/10 | Final desktop/mobile/dialog screenshots; no measured horizontal overflow; keyboard upload and shortcut handling; corrected meaningful secondary-text contrast. |
| Robustness, contracts and regression protection | 9.7/10 | 39 Python + 54 JavaScript tests pass; independent notation-test run; both CI checks independently confirmed successful; source/lifecycle review and PDF integration regression. |
| Delivery, privacy and maintainability | 9.6/10 | Setup/design/scope/license docs; tracked private-data exclusions; issues and ready PR; standalone HTML media inspected. |

## Independence and evidence provenance

The reviewer defined `docs/review-rubric.md` before final assessment, inspected implementation and test expectations, and reported concrete failures for repair. Owning agents implemented fixes. The reviewer did not edit application code or tests and made no commits.

To keep the desktop responsive, heavy recognition and browser work was serialized by the lead. This reviewer independently inspected real screenshots, local result artifacts, implementation source, exported PCM and report structure. Browser actions and final combined-suite execution are lead-produced evidence in `docs/verification.json`; they are not represented as personally executed by this reviewer.

Independent execution: `node --test tests/score.test.mjs` — **39 passed, zero failed**, approximately 198 ms. Independent expectations cover all 15 key signatures in both clefs, round trips, explicit/inherited accidentals, manual/rest preservation, clamping and atomic invalid-input handling. Final combined evidence records **39 Python tests** (13 OMR + 26 decoder/API) and **54 JavaScript tests** (15 audio + 39 notation). GitHub CLI independently confirmed both checks for the reviewed commit completed successfully. An upstream Starlette/httpx deprecation warning is disclosed and does not fail the tests.

## Repaired findings

| Finding | Final disposition |
| --- | --- |
| Cross-staff seek reused the preceding duration | UI seeks the player only during active/paused performance. Browser regression switched from a short bass staff to a longer treble staff and retained the new eight-beat end. |
| Audition timer/pending completion overwrote later highlighting | Tokens and shared timer cleanup added. Browser audition-then-play regression retained a sustained-note highlight after approximately 15 seconds. |
| Upload was inaccessible from keyboard; Space could also start playback | Focusable upload control, Enter/Space handling and global `defaultPrevented` guard added. Keyboard PDF upload succeeded. |
| Pitch/rest editing left stale Hear/Read controls | Review rows update after pitch changes; integrated note/rest correction checks passed. |
| Small meaningful text lacked contrast | Shared accessible secondary color added; source contrast calculations and final screenshots reviewed. |
| Missing credits file and discarded seek-error promise | Notice file is present; seek rejection is caught and surfaced. |
| Navigation re-enabled concurrent heavy WAV export and changed its filename | `state.exporting` guards handler/control state; output staff index is captured before rendering. Source verified. |
| Isolated eighths near slurs were read as quarters | Flag/beam logic repaired; originally failing treble/bass cases and later-page final eighth independently rechecked. |
| Written sharps were missed, including one high-confidence note | Accidental logic repaired; all three final-page failures and surrounding natural cancellation independently rechecked. |
| Accidental produced a false rest; two-sharp key was counted as one | False event removed and key count corrected; affected final sequences independently compared with the source. |
| Actual API PDF scaling differed from standalone evaluation and lost a note | Same bounded 2,600-pixel target now used, with a regression test. Actual decoder images match all six evaluated rasters and browser first-staff count is 19. |

## Recognition verification and exact limits

The private PDF was processed locally: six pages, 36 staves, 717 note events, approximately 16.6 seconds recorded total. The reviewer independently compared **13 complete staves / 258 note pitches and durations across all six pages**, plus targeted passages. These cover both clefs, sharp/flat keys, ledger notes, written/inherited accidentals, natural cancellation, dots, beams and flags. All matched the final arrays. All 97 events on the last page matched.

The 717-event integration comparison establishes agreement between actual decoder inputs and evaluated rasters. **Not all 717 events were manually transcribed.** Measure totals alone were not accepted as correctness evidence: missed sharps were found despite valid totals. Low-confidence indications remain visible. Private renders, event excerpts and evaluation JSON remain ignored local files; public screenshots/report contain original synthetic notation.

## Audio, interface and report checks

The browser decoded all 88 local grand-piano recordings and exercised playback controls and downloads. Independent PCM inspection found stereo **44.1 kHz**, **16-bit**, **5.8266667 seconds**, RMS **0.0094568**, strongest first-second FFT component approximately **294 Hz**, consistent with D4. Duration agrees with 8.5 quarter-note beats at 90 BPM plus release. Physical device-speaker output was not instrumented. Fake-clock tests alone would not establish real sample decoding or non-silent output.

Final desktop, narrow mobile and review-dialog screenshots were inspected. Lead measurements found matching scroll/client widths. Browser verification covered file upload, paste, fractional edits, clef/key overrides, manual pitches, note/rest controls, staff switching and persistent highlights. English is the only implemented language. This is not formal screen-reader or assistive-technology certification.

The reviewer independently parsed the completed approximately **1.78 MB** standalone report: **all eight rating rows, four embedded synthetic screenshots, one embedded PCM item, zero external media dependencies**, and repository/two issue/PR links. No obsolete assessment placeholder remains. The reviewer inspected the final full-report render and found no material layout issue. Lead browser QA confirmed all images loaded, the inline audio played, and desktop/mobile document widths matched their scroll widths. Artifact closure is complete; the minimum score remains **9.6/10**.

## Remaining product boundaries

- Recognition is an editable heuristic draft for complete, level, sufficiently resolved printed monophonic treble/bass staves. High confidence does not guarantee correctness on another score or engraving style.
- Handwriting, perspective images, dense/chordal notation, multiple voices, ties, tuplets, repeats, ornaments and expressive performance are outside reliable scope. Phrase slurs are ignored; ties need manual consolidation.
- Staves play independently; systems and instrument relationships are not joined. A signature does not resolve major versus relative minor.
- Limits are 25 MiB uploads, 30-megapixel raster inputs, 2,600-pixel processed long edge, ten-minute WAV exports, and thirty-minute / 20,000-event transport.
- Browser gesture/background policies and physical speaker behavior are external constraints. Initial dependency installation uses internet; normal processing/audio are local.
- Loopback is the deployment target. Public hosting/authentication and operating-system/browser memory or swap controls were outside this review.

Links: [implementation issue #1](https://github.com/DupeisTaken/staff2audio/issues/1), [regression issue #2](https://github.com/DupeisTaken/staff2audio/issues/2), [ready-for-review PR #3](https://github.com/DupeisTaken/staff2audio/pull/3).
