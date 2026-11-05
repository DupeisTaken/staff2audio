import test from 'node:test';
import assert from 'node:assert/strict';
import { ScoreDocument } from '../static/document.js';

const png = n => `data:image/png;base64,${Buffer.from(`synthetic-image-${n}`).toString('base64')}`;
const result = (page, pages = 6) => ({ page, pages, width: 600, height: 800, preview: png(page),
  staffs: [{ id: 1, events: [{ midi: 60, onset: 0, duration: 1 }] }, { id: 2, events: [{ midi: 48, onset: 0, duration: 2 }] }] });
const document = options => new ScoreDocument({ filename: 'synthetic-score.pdf', pages: 6, ...options });

test('six-page queue can recognize beyond a failed blank cover with truthful progress', () => {
  const doc = document();
  assert.deepEqual(doc.progress, { done: 0, total: 6, ready: 0, failed: 0, pending: 6 });
  doc.markProcessing(1); doc.fail(1, 'No five-line staff on this cover.');
  doc.setPreview(1, { page: 1, pages: 6, width: 600, height: 800, preview: png(1) });
  assert.equal(doc.page(1).status, 'error'); assert.deepEqual(doc.page(1).result.staffs, []);
  for (let page = 2; page <= 6; page++) {
    assert.equal(doc.nextPending(), page); doc.markProcessing(page); doc.complete(page, result(page));
    assert.equal(doc.progress.done, page);
  }
  assert.deepEqual(doc.progress, { done: 6, total: 6, ready: 5, failed: 1, pending: 0 });
  assert.equal(doc.nextPending(), null);
});

test('preferred queued page is prioritized without marking other pages as done', () => {
  const doc = document();
  assert.equal(doc.nextPending(5), 5); doc.markProcessing(5);
  assert.equal(doc.nextPending(5), 1); assert.equal(doc.progress.pending, 6);
  doc.complete(5, result(5)); assert.equal(doc.nextPending(5), 1);
  doc.activate(4); assert.equal(doc.nextPending(4), 4);
});

test('cancel/retry restores only processing pages and supports resuming remaining work', () => {
  const doc = document(); doc.complete(1, result(1)); doc.fail(2, 'Unreadable page');
  doc.markProcessing(3); doc.markProcessing(4);
  assert.equal(doc.cancelProcessing(), 2);
  assert.deepEqual(doc.records.map(p => p.status), ['ready','error','queued','queued']);
  assert.equal(doc.nextPending(), 3); assert.equal(doc.progress.done, 2);
  doc.markProcessing(2); doc.complete(2, result(2));
  assert.deepEqual(doc.progress, { done: 2, total: 6, ready: 2, failed: 0, pending: 4 });
});

test('originals are isolated while result identity, selection and changed edits persist', () => {
  const doc = document(), original = result(1), page = doc.complete(1, original);
  assert.equal(page.result, original);
  page.result.staffs[0].events[0].midi = 65; page.selectedStaff = 1; page.changed.add(0);
  assert.equal(page.originals[0].events[0].midi, 60);
  page.originals[1].events[0].duration = 9;
  assert.equal(page.result.staffs[1].events[0].duration, 2);
  doc.activate(2); doc.activate(1);
  assert.equal(doc.page(1).selectedStaff, 1); assert.deepEqual([...doc.page(1).changed], [0]);
  assert.equal(doc.complete(1, result(1)), page);
  doc.fail(1, 'Late stale error'); doc.markProcessing(1);
  assert.equal(page.status, 'ready'); assert.equal(page.result.staffs[0].events[0].midi, 65);
  assert.equal(page.originals[1].events[0].duration, 9);
});

test('three-preview LRU protects active page while retaining every page edit', () => {
  const doc = document(); doc.activate(1);
  for (let page = 1; page <= 6; page++) {
    const record = doc.complete(page, result(page));
    record.result.staffs[0].events[0].midi += page; record.changed.add(0); record.selectedStaff = 1;
  }
  assert.deepEqual(doc.records.filter(p => p.result.preview).map(p => p.number), [1,5,6]);
  for (let page = 1; page <= 6; page++) {
    assert.equal(doc.page(page).result.staffs[0].events[0].midi, 60 + page);
    assert.equal(doc.page(page).originals[0].events[0].midi, 60);
    assert.equal(doc.page(page).selectedStaff, 1); assert.ok(doc.page(page).changed.has(0));
  }
  doc.activate(5); doc.setPreview(2, { page: 2, pages: 6, width: 600, height: 800, preview: png('reattached') });
  assert.deepEqual(doc.records.filter(p => p.result.preview).map(p => p.number), [2,5,6]);
  assert.equal(doc.page(2).result.staffs[0].events[0].midi, 62);
  assert.equal(doc.page(2).status, 'ready'); assert.equal(doc.page(2).selectedStaff, 1);
});

test('single-preview budget always retains the active page and counts remain independent of preview bytes', () => {
  const doc = document({ previewLimit: 1 }); doc.activate(1); doc.complete(1, result(1)); doc.complete(2, result(2));
  assert.ok(doc.page(1).result.preview); assert.equal(doc.page(2).result.preview, undefined);
  assert.equal(doc.progress.ready, 2);
  doc.activate(2); doc.setPreview(2, png('two'));
  assert.equal(doc.page(1).result.preview, undefined); assert.ok(doc.page(2).result.preview);
});

test('a no-staff completion stays failed with useful preview and may later be retried', () => {
  const doc = document(), blank = { ...result(1), staffs: [] };
  const record = doc.complete(1, blank);
  assert.equal(record.status, 'error'); assert.match(record.error, /No complete staff/); assert.equal(record.result, blank);
  doc.setPreview(1, png('new-blank')); assert.equal(record.status, 'error');
  doc.retry(1); assert.equal(record.status, 'queued'); assert.equal(record.error, null);
  assert.equal(record.result.preview, png('new-blank')); assert.equal(doc.nextPending(), 1);
  doc.markProcessing(1); doc.complete(1, result(1));
  assert.equal(record.status, 'ready'); assert.equal(record.error, null); assert.equal(record.originals.length, 2);
  record.result.staffs[0].events[0].midi = 72; record.changed.add(0);
  doc.retry(1); assert.equal(record.status, 'ready'); assert.equal(record.result.staffs[0].events[0].midi, 72);
  assert.ok(record.changed.has(0));
});

test('invalid page/result metadata is rejected before state mutation', () => {
  const doc = document();
  for (const number of [0,7,1.5,'1',NaN]) {
    assert.throws(() => doc.page(number), RangeError);
    assert.throws(() => doc.activate(number), RangeError);
    assert.throws(() => doc.complete(number, result(1)), RangeError);
  }
  for (const metadata of [{...result(1),page:2}, {...result(1),pages:7}, {...result(1),width:0}, {...result(1),staffs:null}]) {
    assert.throws(() => doc.complete(1, metadata)); assert.equal(doc.records.length, 0);
  }
  assert.throws(() => doc.setPreview(1, { page: 2, preview: png(1) }), RangeError);
  assert.throws(() => doc.setPreview(1, 'https://external.example/image.png'), TypeError);
  assert.equal(doc.records.length, 0); assert.equal(doc.activePage, null);
  doc.complete(1, result(1)); const previous = doc.page(1).result.preview;
  assert.throws(() => doc.setPreview(1, { preview: png(2), width: 1200, height: 800 }), /dimensions/);
  assert.equal(doc.page(1).result.preview, previous); assert.equal(doc.page(1).result.width, 600);
});

test('lazy sparse state handles large safe page counts without allocating or scanning all pages', () => {
  const doc = document({ pages: 1_000_000_000_000 });
  assert.equal(doc.records.length, 0); assert.equal(doc.nextPending(), 1);
  doc.markProcessing(doc.pages); assert.equal(doc.records.length, 1);
  assert.equal(doc.nextPending(), 1); assert.equal(doc.progress.pending, doc.pages);
  assert.equal(doc.nextPending(doc.pages - 1), doc.pages - 1);
  for (const pages of [0,-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(() => document({ pages }), RangeError);
  assert.throws(() => document({ previewLimit: 0 }), RangeError);
});
