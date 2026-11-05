# Independent review findings

Review status: **in progress, no final acceptance decision**. Reviewed the integrated working tree by source inspection and the real dev-server desktop screenshot at `docs/screenshots/desktop.jpg`. No browser automation or heavy recognition tests were run by this reviewer during concurrent lead-agent browser QA and recognition tuning.

## Findings and follow-up

| Finding | Evidence and consequence | Status |
| --- | --- | --- |
| Cross-staff seek reused the preceding performance | `selectStaff()` stopped the player without changing its stored events/duration. The original slider handler called `player.seek()` whenever stored events existed, causing a newly selected longer staff to be clamped to the preceding duration. | Lead changed the handler to seek the player only while paused/playing. Source reinspection supports the fix; integrated regression check pending. |
| Audition highlight could interrupt a later performance | The 650 ms preview timer survived Play, and the asynchronous preview wrapper could highlight an old note after a stop or staff switch. | Lead added a sound-action token, timer cancellation and shared `stopPlayback()`. Source reinspection supports the fix; browser transition check pending. |
| Upload entry was unreachable from keyboard | The file input was hidden and the associated label was not focusable. | Lead added a focusable upload label with Enter/Space handling and reports adding a global `defaultPrevented` guard. Browser keyboard regression check pending. |
| Note/rest editing retained stale row controls | Pitch changes updated the event but did not rebuild the row's Read badge or Hear disabled state. | Lead now rerenders the review list after pitch changes. Source reinspection supports the fix. |
| Meaningful small text had insufficient contrast | Computed normal-text contrast against `#fffefa` was approximately 2.92:1 for `#929987`, 3.85:1 for `#7c8474`, 3.33:1 for `#849078` and 4.42:1 for `#747970`. Many of these colors styled functional labels, times and help text. | Source now overrides meaningful secondary text with `#626d5b`, above 4.5:1 against the relevant cream/white backgrounds. Final screenshot audit pending. |
| Credits link initially returned no file | `static/THIRD_PARTY_NOTICES.txt` was absent when linked by the guide. | File now exists. Source reinspection confirms the link target; HTTP check pending. |
| Seek error promise was not handled | Playing-state `player.seek()` can reject if audio resume/load fails. The slider listener originally discarded the promise. | Lead reports adding rejection handling; error-recovery check pending. |
| Staff navigation could re-enable an in-progress WAV export | The export click handler disabled its button, but `enableControls()` did not track export state. Selecting another staff could enable a second large offline render, and the eventual filename used the newly selected staff number. | Reported to lead. A separate export-in-progress flag and captured output filename are needed to bound concurrent audio work and preserve staff identity. |

## Recognition evidence

The reviewer independently read an existing local render of one supplied-PDF page and compared it with the existing event JSON. The early snapshot correctly found all six staves, their treble/bass clefs, key signatures and meters. On the first treble staff, all 19 pitch values matched visual ground truth. Three spot-checked isolated flagged eighth notes across treble and bass were incorrectly assigned a quarter-note duration. The engine's measure warnings identified the resulting rhythm mismatches.

The updated first-page event JSON independently passes the three previously failing duration spot-checks. Its entire first staff matches the reviewer's independent 19-event pitch/duration reading; sampled accidental and rhythm passages on two bass staves also match. On a later page, another complete 21-event treble staff matched pitch and duration ground truth.

The subsequent final-page snapshot corrects all three missed sharps. The reviewer visually compared all five staves and all 97 note pitches/durations on that page against the regenerated event arrays; the clefs, keys, meters, natural cancellation, dotted rhythms, ledger notes and subdivisions matched. A later-page spurious rest was also removed and the previously failed bass eighth note corrected. One later-page isolated eighth note still required correction in the 15:50 local snapshot; the recognition agent is also checking key-count and barline-grouping issues elsewhere.

Measure totals alone cannot establish correctness because pitch errors and compensating duration errors can remain undetected. Private renders and event-level score excerpts remain in ignored local storage and are excluded from public review artifacts.

## Positive observations

- The desktop screenshot shows a coherent hierarchy, readable score display, clear transport grouping, and no visible overlap.
- The mobile screenshot shows coherent stacked panels and accessible placement of the staff-focus control; final updated contrast and overflow/keyboard behavior still require integrated checks.
- Upload processing is content based, decoded in memory, bounded by request/image limits, and offloaded from the async HTTP path. Recognition work is serialized.
- Piano scheduling uses the Web Audio clock and invalidates pending starts. The existing tests exercise meaningful transport and export timing behavior using a fake audio clock; those tests alone do not prove actual device output.
- The product calls recognition an editable draft and discloses the clean monophonic scope and major/relative-minor ambiguity.
- Clef/key override source inspection supports use of diatonic staff positions and explicit/measure accidental sources while preserving manually edited pitches. Corrected metadata consistency and round-trip behavior remain review checks.
- The extracted `static/score.js` helper updates pitch metadata atomically and includes independently specified tests for all 15 key signatures in both clefs, repeated changes, explicit/inherited accidentals, manual/rest preservation, clamping and malformed events. Source review found no new semantic blocker in this helper.

Final dimension scores will be recorded after the final implementation, affected automated checks, real desktop/mobile flows, real sample playback/export, private score spot-checks, issue/PR, and self-contained HTML report are available.
