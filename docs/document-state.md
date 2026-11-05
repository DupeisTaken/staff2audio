# Multi-page document state

`static/document.js` exports the pure `ScoreDocument` class. It holds one imported document's page queue, recognition results, editable staff state, and a bounded preview cache in browser memory. It does not read files, request pages, use DOM APIs, store anything persistently, or own audio. The UI owns `/api/inspect`, per-page `/api/analyze`, lazy `/api/preview`, cancellation tokens, first-success selection, and stopping/resuming the network queue.

```js
const doc = new ScoreDocument({ filename: file.name, pages: inspected.pages, previewLimit: 3 });
doc.activate(1);
const number = doc.nextPending(doc.activePage);
doc.markProcessing(number);
const record = doc.complete(number, recognitionResult);
record.result.staffs[0].events[0].midi = 62;
record.changed.add(0);
record.selectedStaff = 0;
```

The filename must be a nonempty string. Page counts and indices are positive safe integers; indices are one-based and bounded by the document count. Records are allocated lazily, so even a very large declared safe page count does not cause an eager allocation or full-page scan. The UI should independently avoid rendering huge page-option lists. Preview capacity is a positive safe integer, default three.

## Records and queue

`page(number)` returns a stable mutable record:

```js
{ number, status: 'queued', result: null, error: null,
  originals: [], selectedStaff: 0, changed: new Set() }
```

The UI may edit `result.staffs`, `selectedStaff`, and `changed` directly. Change lifecycle state through the class methods. `records` returns materialized records sorted by page number, not an eager array of every possible page. `pages`, `filename`, and `activePage` are getters. `activePage` starts as `null`.

- `markProcessing(number)` changes a queued/error page to processing and clears its error. A ready page remains ready. Explicitly marking an error page permits a user-triggered retry.
- `complete(number, result)` retains the supplied result object's identity and deep-clones its staff array into `originals`. Successful completion reports ready. An empty staff array instead reports error with a no-staff message, preserving the preview and permitting later retry.
- A duplicate completion of an already-ready page returns the existing record unchanged. It never overwrites corrections, originals, selection, or changed markers. A late `fail` or `markProcessing` also cannot downgrade a ready page. Re-import/create a new document if recognition should intentionally replace a ready page.
- `fail(number, message)` marks a non-ready page error and keeps any existing preview. A decode-only preview does not make recognition succeed.
- `retry(number)` changes an error page to queued and clears its error text, preserving any raster preview. Other statuses are unchanged, particularly ready pages with edits. The normal queue skips error pages until this explicit retry action.
- `nextPending(preferred)` returns the preferred page if queued, otherwise the first queued page in document order, including unmaterialized pages. Processing, ready, and error pages are skipped; no remaining queued page returns `null`. An invalid preferred index throws.
- `cancelProcessing()` returns every processing page to queued and returns the number changed. It leaves ready/error pages and edits intact. This only changes local state: the UI still aborts/invalidates network requests so an old response cannot complete a newly resumed task.
- `progress` returns `{done,total,ready,failed,pending}`. Done means ready plus failed; pending includes queued and processing. Thus `done + pending === total`, and a blank cover counts as a finished failed attempt without preventing recognition of later pages. Explicit retry temporarily moves that page from done to pending.

Metadata is validated before mutation. If present, result `page` and `pages` must match the requested page/document; dimensions must be positive integers. Recognition results require a staff array. The helper does not validate every musical event; recognition/editor/audio validation owns those contracts.

## Preview memory

`activate(number)` selects the protected page and touches its preview as most recently used. `setPreview(number, dataUrl)` or `setPreview(number, {preview,width,height,page,pages})` attaches an inline PNG and merges only dimensions/preview. It never replaces staffs, original detections, edits, warnings, selection, or recognition status. A previously failed page can therefore show a useful decoded source page while still reporting error.

Preview URL strings must be inline PNG data URLs; remote URLs are rejected. The helper bounds the number of retained full previews rather than their compressed byte size. Adding/touching a preview evicts the least recently used preview from another page until the configured capacity is met. The active page is always protected. With capacity one, a background result may have its newly supplied preview immediately evicted while its recognition metadata/events are retained.

Eviction deletes only `record.result.preview`. All page results, event corrections, originals, selected staff, and changed sets survive. After activating an evicted page, request a decode-only preview and call `setPreview`; do not analyze it again merely to restore its image. Full recognition on a non-ready page can reuse an existing preview if dimensions agree. A reattached preview with conflicting dimensions throws before mutation, since overwriting recognized dimensions could misalign note coordinates. The backend must return the same coordinate basis for analysis and preview.

Callers should not hold redundant full result/PNG caches outside the model if they want this memory bound to apply. The browser, image decoding, pending fetch response, and temporary rendering allocations have their own lifetimes; this cache limit is not a total-process memory cap.

## Tests

Run `node --test tests/document.test.mjs`. Synthetic six-page tests cover blank-cover failure followed by later success, progress, preferred-page ordering, cancellation/resume, result/original isolation, duplicate-response edit protection, selected staff/changed markers, active-page LRU protection, lazy preview reattachment, metadata rejection, and sparse large-document behavior. They do not run recognition or a browser.
