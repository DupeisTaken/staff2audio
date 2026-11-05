const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** In-memory page recognition/edit state. Large PNGs have a separate bounded LRU. */
export class ScoreDocument {
  constructor({ filename, pages, previewLimit = 3 } = {}) {
    if (typeof filename !== 'string' || !filename.trim()) throw new TypeError('A document needs a filename.');
    if (!Number.isSafeInteger(pages) || pages < 1) throw new RangeError('Page count must be a positive safe integer.');
    if (!Number.isSafeInteger(previewLimit) || previewLimit < 1) throw new RangeError('Preview limit must be a positive safe integer.');
    this._filename = filename; this._pages = pages; this._previewLimit = previewLimit;
    this._records = new Map(); this._previews = new Map(); this._activePage = null;
  }

  get filename() { return this._filename; }
  get pages() { return this._pages; }
  get activePage() { return this._activePage; }
  // Records are lazy: merely constructing a document never allocates one per page.
  get records() { return [...this._records.values()].sort((a, b) => a.number - b.number); }
  get progress() {
    let ready = 0, failed = 0;
    for (const record of this._records.values()) {
      if (record.status === 'ready') ready++;
      else if (record.status === 'error') failed++;
    }
    return { done: ready + failed, total: this.pages, ready, failed, pending: this.pages - ready - failed };
  }

  _number(number) {
    if (!Number.isSafeInteger(number) || number < 1 || number > this.pages) {
      throw new RangeError(`Choose a page between 1 and ${this.pages}.`);
    }
    return number;
  }

  page(number) {
    this._number(number);
    if (!this._records.has(number)) this._records.set(number, {
      number, status: 'queued', result: null, error: null,
      originals: [], selectedStaff: 0, changed: new Set(),
    });
    return this._records.get(number);
  }

  _metadata(number, result) {
    this._number(number);
    if (!isObject(result)) throw new TypeError('A page result must be an object.');
    if (result.page !== undefined && result.page !== number) throw new RangeError('Result page does not match the requested page.');
    if (result.pages !== undefined && result.pages !== this.pages) throw new RangeError('Result page count does not match this document.');
    for (const key of ['width', 'height']) if (result[key] !== undefined && (!Number.isSafeInteger(result[key]) || result[key] < 1)) {
      throw new RangeError('Page dimensions must be positive integers.');
    }
    if (result.preview !== undefined) this._preview(result.preview);
  }

  _preview(value) {
    if (typeof value !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      throw new TypeError('A preview must be an inline PNG data URL.');
    }
  }

  markProcessing(number) {
    const record = this.page(number);
    if (record.status !== 'ready') { record.status = 'processing'; record.error = null; }
    return record;
  }

  complete(number, result) {
    this._metadata(number, result);
    if (!Array.isArray(result.staffs)) throw new TypeError('A recognition result must contain a staffs array.');
    const existing = this._records.get(number);
    // Recognition is terminal once ready: late/duplicate responses cannot erase edits.
    if (existing?.status === 'ready') return existing;
    const originals = structuredClone(result.staffs);
    const record = this.page(number), previous = record.result;
    if (result.preview === undefined && previous?.preview &&
        (previous.width === undefined || previous.width === result.width) &&
        (previous.height === undefined || previous.height === result.height)) {
      result.preview = previous.preview;
    }
    this._previews.delete(number);
    record.result = result; record.originals = originals;
    record.selectedStaff = 0; record.changed.clear();
    record.status = result.staffs.length ? 'ready' : 'error';
    record.error = result.staffs.length ? null : 'No complete staff was found on this page.';
    this._touchPreview(number);
    return record;
  }

  fail(number, message) {
    this._number(number);
    if (typeof message !== 'string' || !message.trim()) throw new TypeError('A failed page needs an error message.');
    const record = this.page(number);
    if (record.status !== 'ready') { record.status = 'error'; record.error = message; }
    return record;
  }

  retry(number) {
    const record = this.page(number);
    if (record.status === 'error') { record.status = 'queued'; record.error = null; }
    return record;
  }

  setPreview(number, previewResult) {
    const metadata = typeof previewResult === 'string' ? { preview: previewResult } : previewResult;
    this._metadata(number, metadata);
    this._preview(metadata.preview);
    const existing = this._records.get(number)?.result;
    for (const key of ['width', 'height']) if (existing?.[key] !== undefined && metadata[key] !== undefined && existing[key] !== metadata[key]) {
      throw new RangeError('Preview dimensions do not match the recognized page.');
    }
    const record = this.page(number);
    if (!record.result) record.result = { page: number, pages: this.pages, filename: this.filename, staffs: [] };
    for (const key of ['width', 'height', 'preview']) if (metadata[key] !== undefined) record.result[key] = metadata[key];
    this._touchPreview(number);
    return record;
  }

  activate(number) {
    const record = this.page(number);
    this._activePage = number; this._touchPreview(number);
    return record;
  }

  _touchPreview(number) {
    this._previews.delete(number);
    if (this._records.get(number)?.result?.preview) this._previews.set(number, true);
    while (this._previews.size > this._previewLimit) {
      const victim = [...this._previews.keys()].find(page => page !== this._activePage);
      if (victim === undefined) break;
      // Only evict image bytes; recognition, originals and browser edits survive.
      delete this._records.get(victim).result.preview;
      this._previews.delete(victim);
    }
  }

  nextPending(preferred) {
    if (preferred !== undefined && preferred !== null) {
      this._number(preferred);
      if (!this._records.has(preferred) || this._records.get(preferred).status === 'queued') return preferred;
    }
    let candidate = 1;
    for (const record of this.records) {
      if (record.number > candidate || record.status === 'queued') return candidate;
      if (candidate === this.pages) return null;
      candidate++;
    }
    return candidate <= this.pages ? candidate : null;
  }

  cancelProcessing() {
    let count = 0;
    for (const record of this._records.values()) if (record.status === 'processing') {
      record.status = 'queued'; record.error = null; count++;
    }
    return count;
  }
}
