# PDF inventory, preview and recognition

The browser imports a document through `POST /api/inspect` before attempting
recognition. Send a multipart form with one `file` field. A successful response
contains `filename`, `pages` and `kind` (`pdf` or `image`). File content determines
the kind, rather than the extension or claimed MIME type. PDF inspection validates
that the document is readable, unlocked and has pages, then reads its page count.
It does not load page geometry, rasterize a page or run optical music recognition.
A blank or text-only cover, or a page with invalid geometry, therefore cannot
hide other music pages. Images are decoded to validate their format and size and
report one page.

`POST /api/preview` accepts the same file and an optional, one-based `page` field
(default `1`). It returns `filename`, `pages`, `page`, `width`, `height` and a PNG
`preview` data URL. It decodes only the selected page and never calls recognition.
This also permits a readable preview for blank pages or pages that OMR rejects.

`POST /api/analyze` continues to recognize one selected page and returns the
existing score/staff/event/preview response. A page with no detectable staff
continues to return HTTP 422 with the recognizer's actionable message. This is a
page result, not a claim that the whole PDF failed. The browser owns sequential
all-pages recognition, per-page statuses and edited state, cancellation and its
bounded preview cache. The server does not retain files, page sessions or jobs.

All three routes share the same upload context and privacy middleware. They
accept only multipart `file` and `page` fields, bound the declared request and
the actual streamed body, enforce the 25 MiB file limit before decoding, and keep
accepted upload buffers in memory. The parser's request-local spool threshold
exceeds the bounded request size; buffers close on both success and error. The
parser's buffer is released before processing; bounded file bytes remain only
for the request. A serial reentrant lock
bounds PDF rasterization and recognition to one active page at a time. Preview
encoding is also performed within that lock. PDFs render at a maximum 2600-pixel
edge; images retain the existing pixel limit, orientation and alpha handling.

The same-origin/host restrictions and no-store response policy apply to inventory
and preview as well as analysis. Encrypted, unreadable, empty and oversized files,
invalid dimensions and invalid page selections produce validation errors. The
optional `page` field on inventory is syntax-validated but does not select or
limit the inventory; callers should omit it.

API tests use original synthetic files. They cover a blank-cover/two-page score
workflow, successful later-page recognition after a cover error, preview without
CV, metadata inspection without rasterization, malformed/encrypted files, page
bounds and isolation of invalid page dimensions. Geometry is validated before
each selected page is rasterized; an invalid page fails preview/analysis while
inventory and other valid pages remain available. Shared upload tests exercise all
three endpoints for stream/file limits, request types, origin/host restrictions,
in-memory spooling and buffer closure.
