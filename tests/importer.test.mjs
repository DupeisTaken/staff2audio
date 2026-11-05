import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentImporter } from '../static/importer.js';
import { ScoreDocument } from '../static/document.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRdwAAAAASUVORK5CYII=';
const file = name => ({ name });
const score = (page, pages, filename = 'score.pdf') => ({ page, pages, filename, width: 600, height: 800, preview: PNG,
  staffs: [{ id: 0, events: [{ midi: 60, onset: 0, duration: 1 }] }, { id: 1, events: [{ midi: 48, onset: 0, duration: 2 }] }] });
const httpError = message => Object.assign(new Error(message), { status: 422 });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function until(condition, message = 'Expected controller transition did not occur') {
  for (let turn = 0; turn < 50; turn++) { if (condition()) return; await Promise.resolve(); }
  assert.fail(message);
}

function setup(t, { holdPreviews = false } = {}) {
  const calls = [], documents = [], pages = [], progress = [], errors = [];
  let activeAnalyze = 0, maximumAnalyze = 0, importer;
  const request = (path, input, page, signal) => {
    const pending = deferred(), call = { path, file: input, page, signal, ...pending, claimed: false, settled: false };
    calls.push(call);
    if (path === '/api/analyze') { activeAnalyze++; maximumAnalyze = Math.max(maximumAnalyze, activeAnalyze); }
    pending.promise.then(() => { call.settled = true; if (path === '/api/analyze') activeAnalyze--; }, () => { call.settled = true; if (path === '/api/analyze') activeAnalyze--; });
    if (path === '/api/preview' && !holdPreviews) pending.resolve({ page, pages: importer.document.pages, width: 600, height: 800, preview: PNG });
    return pending.promise;
  };
  importer = new DocumentImporter({ request, demo: signal => request('/api/demo', null, undefined, signal),
    onDocument: doc => documents.push(doc),
    onPage: (record, options) => pages.push({ number: record.number, status: record.status, document: importer.document, ...options }),
    onProgress: value => progress.push(value), onError: error => errors.push(error) });
  t.after(() => {
    importer.cancelWork();
    for (const call of calls) if (!call.settled) call.reject(Object.assign(new Error('Test cleanup'), { name: 'AbortError' }));
  });
  return { importer, calls, documents, pages, progress, errors,
    get maximumAnalyze() { return maximumAnalyze; },
    async take(path, page) {
      await until(() => calls.some(call => !call.claimed && call.path === path && (page === undefined || call.page === page)), `No ${path} request for page ${page}`);
      const call = calls.find(call => !call.claimed && call.path === path && (page === undefined || call.page === page)); call.claimed = true; return call;
    },
    async inspected(input, count) {
      const job = importer.importFile(input), inspect = await this.take('/api/inspect');
      inspect.resolve({ filename: input.name, pages: count });
      await until(() => importer.document?.filename === input.name);
      return { job, document: importer.document };
    },
  };
}

test('blank cover failure continues serially and first usable page is automatically selected', async t => {
  const h = setup(t), { job } = await h.inspected(file('six-pages.pdf'), 6);
  assert.ok(h.importer.document instanceof ScoreDocument);
  (await h.take('/api/analyze', 1)).reject(httpError('No staff on cover'));
  (await h.take('/api/analyze', 2)).resolve(score(2,6));
  await until(() => h.importer.currentPage === 2);
  for (let page = 3; page <= 6; page++) (await h.take('/api/analyze', page)).resolve(score(page,6));
  await job;
  assert.equal(h.maximumAnalyze, 1);
  assert.equal(h.importer.currentPage, 2);
  assert.deepEqual(h.importer.document.progress, { done: 6, total: 6, ready: 5, failed: 1, pending: 0 });
  assert.equal(h.importer.scanning, false); assert.equal(h.importer.processingPage, null);
  assert.ok(h.pages.some(p => p.number === 2 && p.status === 'ready'));
  assert.equal(h.errors.length, 0);
});

test('explicit navigation before first success is retained and prioritizes that queued page', async t => {
  const h = setup(t), { job } = await h.inspected(file('chosen.pdf'), 3);
  const first = await h.take('/api/analyze', 1);
  await h.importer.selectPage(3); first.resolve(score(1,3));
  (await h.take('/api/analyze', 3)).resolve(score(3,3));
  (await h.take('/api/analyze', 2)).resolve(score(2,3)); await job;
  assert.equal(h.importer.currentPage, 3); assert.equal(h.importer.document.activePage, 3);
  assert.deepEqual(h.calls.filter(c => c.path === '/api/analyze').map(c => c.page), [1,3,2]);
});

test('stop/resume requeues interrupted work, skips done pages and ignores a late old response', async t => {
  const h = setup(t), { job, document } = await h.inspected(file('resume.pdf'), 3);
  (await h.take('/api/analyze',1)).resolve(score(1,3));
  const interrupted = await h.take('/api/analyze',2);
  h.importer.stopScan(); assert.equal(interrupted.signal.aborted, true);
  assert.equal(document.page(2).status, 'queued'); assert.equal(document.progress.done,1);
  const resumed = h.importer.startScan(), replacement = await h.take('/api/analyze',2);
  interrupted.resolve(score(2,3)); await job;
  assert.equal(document.page(2).status,'processing'); assert.equal(document.progress.done,1);
  replacement.resolve(score(2,3)); (await h.take('/api/analyze',3)).resolve(score(3,3)); await resumed;
  assert.deepEqual(h.calls.filter(c => c.path === '/api/analyze').map(c => c.page),[1,2,2,3]);
  assert.equal(document.progress.ready,3); assert.equal(h.importer.scanning,false);
});

test('replacement during pending inspect cannot publish the abandoned document', async t => {
  const h = setup(t), abandoned = h.importer.importFile(file('abandoned.pdf'));
  const oldInspect = await h.take('/api/inspect');
  const replacement = h.importer.importFile(file('replacement.pdf')), newInspect = await h.take('/api/inspect');
  assert.equal(oldInspect.signal.aborted,true);
  newInspect.resolve({filename:'replacement.pdf',pages:1});
  (await h.take('/api/analyze',1)).resolve(score(1,1)); await replacement;
  oldInspect.resolve({filename:'abandoned.pdf',pages:6}); await abandoned;
  assert.deepEqual(h.documents.map(d => d.filename),['replacement.pdf']); assert.equal(h.importer.document.pages,1);
});

test('replacement during pending analysis neither mutates the old page nor publishes it into the new document', async t => {
  const h = setup(t), oldImport = await h.inspected(file('old.pdf'),2), oldAnalysis = await h.take('/api/analyze',1);
  const replacement = h.importer.importFile(file('new.pdf')), inspect = await h.take('/api/inspect');
  inspect.resolve({filename:'new.pdf',pages:1});
  (await h.take('/api/analyze',1)).resolve(score(1,1)); await replacement;
  const publishedBefore = h.pages.length;
  oldAnalysis.resolve(score(1,2)); await oldImport.job;
  assert.equal(oldImport.document.page(1).status,'queued'); assert.equal(oldImport.document.page(1).result,null);
  assert.equal(h.importer.document.filename,'new.pdf'); assert.equal(h.importer.document.progress.ready,1);
  assert.equal(h.pages.length,publishedBefore);
});

test('evicted page returns through preview only, preserving every correction and staff selection', async t => {
  const h = setup(t), { job, document } = await h.inspected(file('edits.pdf'),6);
  for (let page=1; page<=6; page++) {
    (await h.take('/api/analyze',page)).resolve(score(page,6));
    await until(() => document.page(page).status==='ready');
    const record=document.page(page); record.result.staffs[0].events[0].midi=60+page; record.changed.add(0); record.selectedStaff=1;
  }
  await job;
  assert.equal(document.page(2).result.preview,undefined);
  const analysisCount=h.calls.filter(c=>c.path==='/api/analyze').length;
  await h.importer.selectPage(2);
  assert.equal(h.calls.filter(c=>c.path==='/api/analyze').length,analysisCount);
  assert.equal(h.calls.filter(c=>c.path==='/api/preview' && c.page===2).length,1);
  assert.ok(document.page(2).result.preview);
  for(let page=1;page<=6;page++) {
    const record=document.page(page);
    assert.equal(record.result.staffs[0].events[0].midi,60+page);
    assert.equal(record.originals[0].events[0].midi,60); assert.equal(record.selectedStaff,1); assert.ok(record.changed.has(0));
  }
});

test('replacement during lazy preview ignores late image and callbacks from the old document', async t => {
  const h=setup(t,{holdPreviews:true}), {job,document}=await h.inspected(file('preview-old.pdf'),4);
  for(let page=1;page<=4;page++) (await h.take('/api/analyze',page)).resolve(score(page,4)); await job;
  const selecting=h.importer.selectPage(2), preview=await h.take('/api/preview',2);
  const replacing=h.importer.importFile(file('preview-new.pdf')), inspect=await h.take('/api/inspect');
  inspect.resolve({filename:'preview-new.pdf',pages:1}); (await h.take('/api/analyze',1)).resolve(score(1,1)); await replacing;
  const publishedBefore=h.pages.length; preview.resolve({page:2,pages:4,width:600,height:800,preview:PNG}); await selecting;
  assert.equal(preview.signal.aborted,true); assert.equal(document.page(2).result.preview,undefined);
  assert.equal(h.pages.length,publishedBefore); assert.equal(h.importer.document.filename,'preview-new.pdf');
});

test('failed replacement inspect preserves the previous file, results and edits', async t => {
  const h=setup(t), input=file('retained.pdf'), {job,document}=await h.inspected(input,1);
  (await h.take('/api/analyze',1)).resolve(score(1,1)); await job;
  document.page(1).result.staffs[0].events[0].midi=67; document.page(1).changed.add(0);
  const replacement=h.importer.importFile(file('broken.pdf')); (await h.take('/api/inspect')).reject(httpError('Unreadable PDF')); await replacement;
  assert.equal(h.importer.document,document); assert.equal(h.importer.file,input);
  assert.equal(document.page(1).result.staffs[0].events[0].midi,67); assert.ok(document.page(1).changed.has(0));
  assert.deepEqual(h.errors,['Unreadable PDF']); assert.equal(h.importer.importing,false);
});

test('all blank/failed pages remain truthful and no error page is retried until explicitly requested', async t => {
  const h=setup(t), {job,document}=await h.inspected(file('blank.pdf'),2);
  (await h.take('/api/analyze',1)).reject(httpError('No staff'));
  (await h.take('/api/analyze',2)).resolve({...score(2,2),staffs:[]}); await job;
  assert.deepEqual(document.progress,{done:2,total:2,ready:0,failed:2,pending:0}); assert.equal(h.importer.scanning,false);
  const count=h.calls.length; await h.importer.startScan(); assert.equal(h.calls.length,count);
  const retry=h.importer.retryPage(2); (await h.take('/api/analyze',2)).resolve(score(2,2)); await retry;
  assert.deepEqual(document.progress,{done:2,total:2,ready:1,failed:1,pending:0});
  const afterRetry=h.calls.length; await h.importer.retryPage(2); assert.equal(h.calls.length,afterRetry);
});

test('injected demo is cancellable and a late demo cannot replace a newer import', async t => {
  const h=setup(t), demo=h.importer.loadDemo(), pending=await h.take('/api/demo');
  const replacement=h.importer.importFile(file('real.pdf')); (await h.take('/api/inspect')).resolve({filename:'real.pdf',pages:1});
  (await h.take('/api/analyze',1)).resolve(score(1,1)); await replacement;
  pending.resolve(score(1,1,'Example')); await demo;
  assert.equal(pending.signal.aborted,true); assert.equal(h.importer.file.name,'real.pdf');
  assert.deepEqual(h.documents.map(d=>d.filename),['real.pdf']);
});

test('a failed replacement waiting on old preview cannot publish its error after a newer import succeeds', async t => {
  const h=setup(t,{holdPreviews:true}), {job}=await h.inspected(file('retained-many.pdf'),4);
  for(let page=1;page<=4;page++) (await h.take('/api/analyze',page)).resolve(score(page,4)); await job;
  const selecting=h.importer.selectPage(2), initialPreview=await h.take('/api/preview',2);
  const broken=h.importer.importFile(file('broken-intermediate.pdf'));
  (await h.take('/api/inspect')).reject(httpError('Obsolete intermediate import error'));
  const restorePreview=await h.take('/api/preview',2);
  const newest=h.importer.importFile(file('latest-good.pdf'));
  (await h.take('/api/inspect')).resolve({filename:'latest-good.pdf',pages:1});
  (await h.take('/api/analyze',1)).resolve(score(1,1)); await newest;
  restorePreview.resolve({page:2,pages:4,width:600,height:800,preview:PNG}); await broken;
  initialPreview.resolve({page:2,pages:4,width:600,height:800,preview:PNG}); await selecting;
  assert.equal(h.importer.document.filename,'latest-good.pdf');
  assert.deepEqual(h.errors,[],'An abandoned import must not show stale errors over the current document');
});

test('a late preview from earlier navigation cannot replace the newly selected page', async t => {
  const h=setup(t,{holdPreviews:true}), {job,document}=await h.inspected(file('navigate.pdf'),4);
  for(let page=1;page<=4;page++) (await h.take('/api/analyze',page)).resolve(score(page,4)); await job;
  const earlier=h.importer.selectPage(2), pending=await h.take('/api/preview',2);
  await h.importer.selectPage(3); const publishedBefore=h.pages.length;
  pending.resolve({page:2,pages:4,width:600,height:800,preview:PNG}); await earlier;
  assert.equal(h.importer.currentPage,3); assert.equal(pending.signal.aborted,true);
  assert.equal(document.page(2).result.preview,undefined); assert.equal(h.pages.length,publishedBefore);
});

test('local connection interruption pauses the queue and resume processes remaining queued pages only', async t => {
  const h=setup(t), {job,document}=await h.inspected(file('connection.pdf'),3);
  (await h.take('/api/analyze',1)).resolve(score(1,3));
  (await h.take('/api/analyze',2)).reject(new TypeError('Failed to fetch')); await job;
  assert.equal(h.importer.scanning,false); assert.equal(document.page(2).status,'error'); assert.equal(document.page(3).status,'queued');
  assert.match(h.errors[0],/connection was interrupted/);
  const resumed=h.importer.startScan(); (await h.take('/api/analyze',3)).resolve(score(3,3)); await resumed;
  assert.deepEqual(h.calls.filter(c=>c.path==='/api/analyze').map(c=>c.page),[1,2,3]);
  assert.deepEqual(document.progress,{done:3,total:3,ready:2,failed:1,pending:0});
});

test('cancelImport during pending inspect keeps the ready document usable and rejects late metadata', async t => {
  const h=setup(t), input=file('keep-ready.pdf'), {job,document}=await h.inspected(input,1);
  (await h.take('/api/analyze',1)).resolve(score(1,1)); await job;
  document.page(1).result.staffs[0].events[0].midi=69; document.page(1).selectedStaff=1; document.page(1).changed.add(0);
  const replacing=h.importer.importFile(file('cancelled.pdf')), inspect=await h.take('/api/inspect');
  assert.equal(h.importer.importing,true);
  await h.importer.cancelImport();
  assert.equal(h.importer.importing,false); assert.equal(inspect.signal.aborted,true);
  assert.equal(h.importer.document,document); assert.equal(h.importer.file,input);
  assert.equal(document.page(1).status,'ready'); assert.equal(document.page(1).selectedStaff,1);
  const publishedDocuments=h.documents.length;
  inspect.resolve({filename:'cancelled.pdf',pages:6}); await replacing;
  assert.equal(h.documents.length,publishedDocuments); assert.equal(h.importer.document,document);
  assert.equal(document.page(1).result.staffs[0].events[0].midi,69); assert.ok(document.page(1).changed.has(0));
  assert.equal(h.importer.importing,false); assert.equal(h.importer.scanning,false); assert.deepEqual(h.errors,[]);
});

for (const action of ['replacement', 'stop']) {
  test(`connection error waiting on page preview cannot leak after ${action}`, async t => {
    const h=setup(t,{holdPreviews:true}), {job,document}=await h.inspected(file('connection-old.pdf'),2);
    (await h.take('/api/analyze',1)).reject(new TypeError('Failed to fetch'));
    const preview=await h.take('/api/preview',1);
    assert.equal(document.page(1).status,'error'); assert.deepEqual(h.errors,[]);
    if (action==='replacement') {
      const replacing=h.importer.importFile(file('connection-new.pdf'));
      (await h.take('/api/inspect')).resolve({filename:'connection-new.pdf',pages:1});
      (await h.take('/api/analyze',1)).resolve(score(1,1)); await replacing;
    } else h.importer.stopScan();
    preview.resolve({page:1,pages:2,width:600,height:800,preview:PNG}); await job;
    assert.deepEqual(h.errors,[],'Obsolete connection failure must not publish after the await');
    assert.equal(h.importer.scanning,false);
    if (action==='replacement') {
      assert.equal(h.importer.document.filename,'connection-new.pdf');
      assert.equal(document.page(1).result,null);
      assert.equal(h.importer.document.page(1).status,'ready');
    } else assert.equal(h.importer.document,document);
  });
}

test('empty printed staffs and rest-only pages remain ready without latching automatic music selection', async t => {
  const h=setup(t), {job,document}=await h.inspected(file('empty-staffs.pdf'),3);
  const empty={...score(1,3),staffs:[{id:0,events:[]},{id:1,events:[]}]};
  (await h.take('/api/analyze',1)).resolve(empty);
  const second=await h.take('/api/analyze',2);
  assert.equal(document.page(1).status,'ready'); assert.equal(document.page(1).result,empty);
  assert.equal(h.importer.autoSelected,false); assert.equal(h.importer.currentPage,1);
  const rests={...score(2,3),staffs:[{id:0,events:[{midi:null,onset:0,duration:4}]}]};
  second.resolve(rests); const third=await h.take('/api/analyze',3);
  assert.equal(document.page(2).status,'ready'); assert.equal(h.importer.autoSelected,false);
  third.resolve(score(3,3)); await job;
  assert.equal(h.importer.currentPage,3); assert.equal(h.importer.autoSelected,true);
  assert.deepEqual(document.page(1).result.staffs,[{id:0,events:[]},{id:1,events:[]}]);
  assert.equal(document.page(2).result,rests); assert.equal(document.page(2).originals[0].events[0].midi,null);
  assert.deepEqual(document.progress,{done:3,total:3,ready:3,failed:0,pending:0});
});

test('retaining selection for an empty-staff editor prevents a later sounding page from stealing focus', async t => {
  const h=setup(t), {job,document}=await h.inspected(file('editing-empty.pdf'),2);
  const empty={...score(1,2),staffs:[{id:0,events:[]},{id:1,events:[]}]};
  (await h.take('/api/analyze',1)).resolve(empty); const later=await h.take('/api/analyze',2);
  const record=document.page(1); record.selectedStaff=1; record.changed.add(1);
  h.importer.retainSelection(); later.resolve(score(2,2)); await job;
  assert.equal(h.importer.currentPage,1); assert.equal(document.activePage,1);
  assert.equal(record.status,'ready'); assert.equal(record.result,empty); assert.equal(record.selectedStaff,1);
  assert.ok(record.changed.has(1)); assert.deepEqual(record.originals,[{id:0,events:[]},{id:1,events:[]}]);
  assert.equal(document.page(2).status,'ready'); assert.equal(h.importer.autoSelected,false);
});
