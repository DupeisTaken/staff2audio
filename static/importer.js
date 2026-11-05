import { ScoreDocument } from "./document.js";

async function localRequest(path, file, page, signal) {
  const form = new FormData();
  form.append("file", file);
  if (page !== undefined) form.append("page", page);
  const response = await fetch(path, { method: "POST", body: form, signal });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(
      typeof data.detail === "string"
        ? data.detail
        : "This page could not be read.",
    );
    error.status = response.status;
    throw error;
  }
  return data;
}

/** Owns asynchronous document work. Every response belongs to an import/scan
 * generation; changing a file or stopping cannot publish a stale result.
 */
export class DocumentImporter {
  constructor({
    onDocument = () => {},
    onPage = () => {},
    onProgress = () => {},
    onError = () => {},
    request = localRequest,
    demo = null,
  } = {}) {
    Object.assign(this, { onDocument, onPage, onProgress, onError, request });
    this.demoRequest =
      demo ||
      (async (signal) => {
        const response = await fetch("/api/demo", { signal });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.detail || "The example could not be loaded.");
        return data;
      });
    this.document = null;
    this.file = null;
    this.currentPage = 1;
    this.scanning = false;
    this.importing = false;
    this.processingPage = null;
    this.generation = 0;
    this.scanRun = 0;
    this.pageRun = 0;
    this.userChosePage = false;
    this.autoSelected = false;
    this.importController = null;
    this.scanController = null;
    this.previewController = null;
  }

  notify() {
    this.onProgress({
      document: this.document,
      currentPage: this.currentPage,
      importing: this.importing,
      scanning: this.scanning,
      processingPage: this.processingPage,
      progress: this.document?.progress || null,
    });
  }

  cancelWork() {
    ++this.generation;
    ++this.pageRun;
    this.importController?.abort();
    this.previewController?.abort();
    this.importing = false;
    this.stopScan();
    return this.generation;
  }

  async importFile(file) {
    const generation = this.cancelWork();
    const controller = new AbortController();
    this.importController = controller;
    this.importing = true;
    this.notify();
    try {
      const metadata = await this.request(
        "/api/inspect",
        file,
        undefined,
        controller.signal,
      );
      if (generation !== this.generation) return;
      this.document = new ScoreDocument({ ...metadata, previewLimit: 3 });
      this.file = file;
      this.currentPage = 1;
      this.userChosePage = false;
      this.autoSelected = false;
      this.document.activate(1);
      this.importing = false;
      this.onDocument(this.document);
      this.onPage(this.document.page(1), { previewLoading: false });
      this.notify();
      await this.startScan();
    } catch (error) {
      if (generation !== this.generation || error.name === "AbortError") return;
      this.importing = false;
      if (this.document) await this.showSelected();
      if (generation !== this.generation) return;
      this.onError(error.message);
    } finally {
      if (generation === this.generation) {
        this.importing = false;
        this.notify();
      }
    }
  }

  async loadDemo() {
    const generation = this.cancelWork();
    const controller = new AbortController();
    this.importController = controller;
    this.importing = true;
    this.notify();
    try {
      const result = await this.demoRequest(controller.signal);
      if (generation !== this.generation) return;
      this.document = new ScoreDocument({
        filename: result.filename,
        pages: 1,
        previewLimit: 3,
      });
      this.file = null;
      this.currentPage = 1;
      this.userChosePage = false;
      this.autoSelected = true;
      this.document.activate(1);
      this.document.complete(1, result);
      this.importing = false;
      this.onDocument(this.document);
      await this.showSelected();
    } catch (error) {
      if (generation === this.generation && error.name !== "AbortError")
        this.onError(error.message);
    } finally {
      if (generation === this.generation) {
        this.importing = false;
        this.notify();
      }
    }
  }

  async selectPage(number, { user = true } = {}) {
    if (!this.document) return;
    this.document.activate(number);
    this.currentPage = number;
    if (user) this.userChosePage = true;
    this.notify();
    await this.showSelected();
  }

  async showSelected() {
    const document = this.document,
      number = this.currentPage,
      generation = this.generation;
    const pageRun = ++this.pageRun;
    this.previewController?.abort();
    if (!document) return;
    const record = document.activate(number);
    const needsPreview =
      !record.result?.preview &&
      ["ready", "error"].includes(record.status) &&
      this.file;
    this.onPage(record, { previewLoading: Boolean(needsPreview) });
    if (!needsPreview) return;
    const controller = new AbortController();
    this.previewController = controller;
    try {
      const preview = await this.request(
        "/api/preview",
        this.file,
        number,
        controller.signal,
      );
      if (
        generation !== this.generation ||
        document !== this.document ||
        pageRun !== this.pageRun
      )
        return;
      document.setPreview(number, preview);
      this.onPage(document.page(number), { previewLoading: false });
    } catch (error) {
      if (
        generation !== this.generation ||
        pageRun !== this.pageRun ||
        error.name === "AbortError"
      )
        return;
      this.onPage(record, {
        previewLoading: false,
        previewError: error.message,
      });
    }
  }

  async startScan() {
    if (this.scanning || this.importing || !this.document || !this.file) return;
    const document = this.document,
      generation = this.generation,
      run = ++this.scanRun;
    this.scanning = true;
    this.notify();
    try {
      while (generation === this.generation && run === this.scanRun) {
        const number = document.nextPending(this.currentPage);
        if (number === null) break;
        document.markProcessing(number);
        this.processingPage = number;
        this.notify();
        if (this.currentPage === number)
          this.onPage(document.page(number), { previewLoading: false });
        const controller = new AbortController();
        this.scanController = controller;
        let connectionLost = false;
        try {
          const result = await this.request(
            "/api/analyze",
            this.file,
            number,
            controller.signal,
          );
          if (generation !== this.generation || run !== this.scanRun) return;
          if (!result.staffs?.length) {
            document.fail(
              number,
              "No complete musical staff was found on this page.",
            );
            document.setPreview(number, result);
          } else {
            document.complete(number, result);
            const playable = result.staffs.some((staff) =>
              staff.events?.some(
                (event) =>
                  typeof event.midi === "number" &&
                  Number.isFinite(event.midi) &&
                  event.midi >= 0 &&
                  event.midi <= 127 &&
                  event.duration > 0,
              ),
            );
            if (playable && !this.userChosePage && !this.autoSelected) {
              this.autoSelected = true;
              this.currentPage = number;
              document.activate(number);
            }
          }
        } catch (error) {
          if (
            generation !== this.generation ||
            run !== this.scanRun ||
            error.name === "AbortError"
          )
            return;
          document.fail(number, error.message);
          // A lost local server is a document-level interruption; page-specific
          // HTTP errors remain visible while later pages continue to scan.
          if (!error.status) {
            connectionLost = true;
          }
        }
        this.processingPage = null;
        this.notify();
        if (this.currentPage === number) await this.showSelected();
        if (connectionLost) {
          if (generation !== this.generation || run !== this.scanRun) return;
          this.onError(
            "The local server connection was interrupted. Resume the remaining pages when it is available.",
          );
          break;
        }
      }
    } finally {
      if (generation === this.generation && run === this.scanRun) {
        document.cancelProcessing();
        this.scanning = false;
        this.processingPage = null;
        this.notify();
        // Refresh a queued-page message after the user stops or a connection fails.
        if (document.page(this.currentPage).status === "queued")
          this.onPage(document.page(this.currentPage), {
            previewLoading: false,
          });
      }
    }
  }

  stopScan() {
    ++this.scanRun;
    this.scanController?.abort();
    this.document?.cancelProcessing();
    this.scanning = false;
    this.processingPage = null;
    this.notify();
    if (this.document?.page(this.currentPage).status === "queued")
      this.onPage(this.document.page(this.currentPage), {
        previewLoading: false,
      });
  }

  async retryPage(number = this.currentPage) {
    if (!this.document || this.document.page(number).status !== "error") return;
    this.document.retry(number);
    this.notify();
    await this.startScan();
  }

  async cancelImport() {
    this.cancelWork();
    if (this.document) await this.showSelected();
    else this.onError("Import stopped. Choose a score when ready.");
  }

  retainSelection() {
    this.userChosePage = true;
  }
}
