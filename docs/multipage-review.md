# Independent multipage review

Status: **multipage implementation accepted within the documented scope; all eight dimensions exceed 9.5/10, minimum 9.6.** Source feature commit: `cbbfa856e32c15ff8a8d0dc6f97ef18193a6a955`, reviewed on 5 November 2026. The final documentation/report head must still pass the immutable merge gate below. The preceding reviews describe historical revisions; this assessment independently covers automatic PDF recognition, per-page state/edit retention, preview caching and cancellation/resumption.

## Required behavior

1. Metadata inspection must establish page count without requiring successful music recognition. A blank, malformed-for-OMR, or music-free cover must not prevent subsequent pages from being attempted. Every page has a visible status, and one page's failure does not stop the serial queue.
2. Each page is recognized at most once in an ordinary complete run. Stop prevents further client queue work; resume continues interrupted/pending pages without duplicating completed work. A failed page remains visibly failed and can be explicitly retried rather than silently retried forever. An already executing server recognition may finish after client cancellation; the UI must not imply that Python work was forcibly interrupted.
3. New imports invalidate all prior metadata, recognition and preview requests. Old successes, errors and finally handlers must not mutate the new document, enable its wrong controls, replace its visible page or schedule more old work. Failed new imports should have a clearly defined recoverable state.
4. First usable music may be selected automatically only before the user explicitly navigates. A user-selected cover, pending page or completed music page must stay selected as background recognition advances. Completed results must be stored for their actual requested page regardless of what is currently visible.
5. Per-page edits, original detections for reset, selected staff, and manual tempos must survive page navigation and background queue completion. Returning to a page must not replace corrected events with original server output. Document identity must prevent equal page/staff numbers in different files from sharing preferences.
6. Preview eviction is separate from score data. A three-page LRU may evict raster previews, never edits, timing, original detections or statuses. Returning to an evicted page fetches a raster-only preview without rerunning CV. A late preview cannot display under another page's title or overwrite a newer import.
7. Queue work is serial and bounded. Existing request-size, pixel, PDF-dimension, in-memory upload and loopback restrictions remain. Large page counts, repeated navigation and rapid stop/import cycles must not create parallel recognition, uncontrolled preview accumulation, stale queue loops or unbounded retained raster data.
8. Empty/all-failed documents finish honestly with actionable page statuses. The UI must distinguish pending, actively processing, completed-with-music and failed/no-music states. Playback, correction and exports refer only to the selected page/staff and stop when navigation makes the old selection inactive.

## Minimum evidence matrix

- Blank or no-staff cover followed by usable music: page count survives the cover error, later music is recognized, and the first usable page is selected if the user has not navigated.
- Explicitly select a different page while an earlier request is pending: the eventual response is stored without changing the user's page. Repeat for a late preview response.
- Stop before metadata returns, during recognition, and between pages; resume. Confirm no extra client work after stop and no duplicate successful-page recognition.
- Start a new file during metadata, recognition and raster-preview requests. Resolve old promises afterward and inspect visible state, statuses and network requests.
- Edit pitch, rest, fractional duration, clef/key, selected staff and manual tempo; visit enough other pages to evict the preview; return and verify all corrections. Reset should still restore that page's original detection.
- Verify preview cache capacity/order and a cache-miss raster request with an OMR call counter. Preview failure must remain recoverable without corrupting score data.
- Exercise all-blank, mixed-failure, and failure/retry cases. Inspect serial request order and per-page progress. Include real desktop/mobile screenshots for the page-status and stop/resume controls.
- Recheck tempo-unit conversion and actual MIDI/WAV identity for a selected cached page so automatic background results cannot change its export or sound.

Light pure-model/state tests should complement, not replace, real browser file/queue checks. Test expectations must independently specify transitions and count actual recognition versus preview calls.

## Immutable-head merge gate

Record the exact final PR head SHA and review its diff against the intended base. Confirm all required CI checks succeeded for that SHA, no conflict/draft/blocking status remains, the PR links relevant issues, and the local source matches the reviewed head. Confirm private PDF files, page rasters, extracted private event sequences, credentials, environments and caches are absent from tracked changes and public report media. Review the completed standalone report and current screenshots. A later behavioral commit requires reassessment of affected evidence; documentation-only closure should be identified as such.

The final dimension assessment is recorded below and in `docs/multipage-review.json`. It is distinct from the final-head merge authorization: a later code change or failing check must be assessed before merge. A requested threshold does not replace evidence or justify increasing a score.

## Initial source review findings

The reviewer independently inspected `ScoreDocument`, `DocumentImporter`, the UI callbacks and shared upload/metadata/preview endpoints. Per-page result identity, originals, changed sets and selected staff are retained correctly; preview eviction removes image bytes rather than edits. Manual tempo memory is reset on new-document acceptance rather than page selection. Metadata and raster requests do not invoke OMR.

Initial independent lightweight run: `node --test tests/document.test.mjs tests/importer.test.mjs` — 23 passed. After repairs on feature commit `cbbfa85`, the reviewer inspected the additional expectations and independently reran the same command: **27 passed, zero failed**, approximately 295 ms. The four added cases cover stale connection errors after replacement/stop, empty/rest-only page selection and retained editor intent. Pure tests complement actual browser verification.

| Finding reported to the lead | Source reinspection on `cbbfa85` |
| --- | --- |
| A lost-connection branch awaits `showSelected()` then publishes `onError` without rechecking the import/scan generation. A new import during the awaited preview can receive the old connection error. | Fixed: generation/run rechecked after the preview await; replacement and stop regression tests pass. |
| First automatic selection accepts any nonempty staff array, including empty printed staves with no reliable sounding events. | Fixed: automatic selection requires a positive-duration sounding MIDI event. Empty/rest-only pages remain available without latching the music selection. |
| An open review dialog retains old row closures when a new import changes the selected page. Global screenshot paste can start that import while the dialog is open. | Fixed: import and page-display transitions close the stale dialog. Editor/staff intent invokes `retainSelection()` so later background music cannot steal the selection. |
| Metadata inspection rejects the complete PDF when any page has invalid geometry, preventing good pages from being listed. | Fixed: PDF inventory reads metadata only; selected-page geometry remains bounded and fails locally in analysis/preview. |

Lead browser evidence on an original synthetic six-page PDF records a blank first/last page, four ready pages, two no-staff pages and automatic selection of page 2. Pitch/duration edits, staff selection and manual tempos survived navigation and preview eviction; original detection still reset correctly. Pasting a new image inside the editor closed it without JavaScript errors.

## Final assessment

| Dimension | Score | Basis |
| --- | ---: | --- |
| Input and local operation | 9.7/10 | Independent inventory, page-local decode failures, shared upload/privacy bounds and 46 API/decoder tests; real all-page PDF completion. |
| Staff, clef and key recognition | 9.6/10 | Prior recognition semantics retained; actual six-page browser inventory/scan reports 36 staves; failed covers remain visible without blocking music. |
| Pitch, accidentals and timing | 9.6/10 | Corrected events, originals, selected staff and manual tempos survive navigation and preview eviction; reset remains exact. |
| Grand piano and transport | 9.7/10 | Selected-page ownership and inactive-page stop behavior; background work does not steal an explicit selection; previous audio/export contracts retained. |
| Integrated practice experience | 9.7/10 | Automatic queue, truthful statuses, Stop/Resume/retry and persistent corrections demonstrated on synthetic and actual PDFs. |
| Responsive UI and accessibility | 9.6/10 | Updated desktop/mobile/blank-cover screenshots inspected; usable page/status controls; disabled playback on a no-staff page; bounded large-page selector. |
| Robustness, contracts and regression protection | 9.7/10 | Independent 27-test controller/model pass; full 59 Python + 122 JavaScript pass; both source-head CI checks independently confirmed successful. |
| Delivery, privacy and maintainability | 9.6/10 | Document/API ownership explained; original review history retained; synthetic public evidence and no tracked private source artifacts; explicit final merge gate. |

## Actual PDF and browser evidence

The lead's real browser run discovered all six pages of the user's PDF. Stop was pressed after two pages; after the current response settled, progress stayed at **Scan paused · 2 of 6**, with page 1 still playable. Resume began at page 3 and completed **6 of 6 scanned · 6 ready**. Page staff counts were **6, 6, 7, 6, 6, 5**, totaling 36. Page 1 remained selected at automatic quarter-note 72 with playback enabled. Console error/warning logs were empty, and the user's PDF was left loaded in the application. These are lead-produced browser observations; private screenshots/pages are not public artifacts.

Synthetic browser verification established a blank first and last page, four usable pages, automatic selection of page 2, and later explicit blank-cover navigation with truthful error status and disabled playback. On page 3, pitch 67, duration 1.5, manual staff-1 tempo 65, staff-2 selection and tempo 42 survived navigation through pages 4, 5 and 2, including PNG eviction. Original reset restored pitch 61 and duration 1. A pasted replacement inside the open editor closed stale controls without JavaScript errors.

The reviewer independently inspected updated desktop, mobile and blank-cover public screenshots. They show original synthetic notation, readable page selection/progress, access to failed pages and no material layout issue. No public image contains the user's PDF. Pure-model tests separately demonstrate that preview restoration calls the raster endpoint without another analysis request, and that stale inspect, analysis, preview and error responses cannot overwrite a newer document.

## Verification provenance and limits

The reviewer inspected source and independent test expectations and personally ran the lightweight 27-test document/controller suite. The lead executed the full local suite: **59 Python tests passed** (13 OMR + 46 API/decoder) and **122 JavaScript tests passed**, with one documented upstream Starlette/httpx deprecation warning. The reviewer independently queried GitHub: both checks on `cbbfa85` concluded **SUCCESS**, and PR 3 was ready, `MERGEABLE`, and `CLEAN`. This confirms the source feature head, not an as-yet-uncreated documentation head.

Recognition remains a heuristic editable draft for clean printed monophonic staves; automatic scanning does not expand the notation scope or verify every recognized note. The earlier 258-event independent visual sample and 717-event decoder comparison retain their stated limits. Stop cancels/invalidates the client queue; an already executing server page may finish. A lost local server pauses remaining queued work; failed pages require explicit retry. A three-preview limit is not a total browser/process memory guarantee. Page results and edits remain in the current tab only and are discarded on reload/new-document replacement.

## Remaining immutable-head merge gate

No material application blocker remains. Before the user's authorized merge, the lead must commit the final report/review data and public screenshots, then supply its immutable head for confirmation. Required closure is: final report contains current scores/evidence and synthetic embedded media; local worktree matches the head; CI checks succeed for that exact SHA; PR is not draft/conflicted/blocked; private PDF/raster/event data, secrets and disposable environments/caches are absent from the tracked diff. Merge must use that reviewed SHA as its guard. A documentation-only closure does not require another application test run beyond the configured final-head checks.

## Report and pending-diff closure

The reviewer independently inspected the completed desktop and mobile report renders and parsed the approximately 1.90 MB standalone HTML. It contains **five embedded synthetic screenshots, one embedded PCM preview and all eight current ratings**. Ratings match the machine-readable multipage assessment; verification data reports **59 Python and 122 JavaScript tests**. Issue 6 and the current PDF/state documentation are linked. Every media item is embedded, no assessment placeholder remains, and the private source filename is absent.

The pending diff contains only README, report/builder/verification updates, this assessment and synthetic screenshots. `git diff --check` found no whitespace errors; Git's informational LF/CRLF notice is not a failure. Tracked/untracked file inventory and private source-name/path searches found no private PDF, extracted page/event artifacts, credentials, virtual environments or disposable caches in the proposed changes. Public screenshot content was visually checked against the original synthetic fixture. No application source changed after the reviewed feature commit.

**Artifact closure is complete and all eight scores remain unchanged, with a minimum of 9.6/10.** The sole remaining authorization gate is a read-only CI/merge/privacy confirmation at the exact pushed documentation head, followed by the user's authorized SHA-guarded merge. No server, process or browser state was changed by this reviewer.
