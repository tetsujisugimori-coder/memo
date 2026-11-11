"use strict";
// Actual application/IndexedDB/BroadcastChannel and natural 280ms autosave.
// Only fictional data in a fresh context. No writer, timer or channel replacement.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const playwright = require('playwright');
const { createHash } = require('node:crypto');
const { createServer, observe, snapshot, openApp, appReady, saved } = require('./note-conflict-test-support.cjs');
const output = path.resolve(process.env.MEMO_DELETE_ARTIFACTS || path.join(process.env.MEMO_SAVE_ARTIFACTS || path.join(os.tmpdir(), 'memo-issue429/browser'), 'deletion'));
const manuscript = '架空の削除競合原稿\n  最終行\tUTF-8 📝\n';
async function run(browser, name, origin) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  let timedOut = false;
  const watchdog = setTimeout(() => { timedOut = true; void context.close(); }, 90000);
  const result = { browser: name, browserVersion: browser.version(), status: 'FAIL', checks: [], logs: [], external: [] };
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    result.external.push(route.request().url());
    return route.fulfill({ status: 200, contentType: route.request().resourceType() === 'stylesheet' ? 'text/css' : 'application/javascript', body: '' });
  });
  const pages = [];
  const newPage = async url => { const page = await context.newPage(); pages.push(page); page.setDefaultTimeout(10000); result.logs.push(observe(page)); page.on('dialog', dialog => dialog.accept()); await openApp(page, url); return page; };
  async function inspectExport(page, id, label) {
    const buttons = page.locator('[data-conflict-open]');
    const matching = await page.evaluate(async ({ id, body }) => (await noteConflictStore.readDrafts(db, id)).find(row => row.body === body)?.requestId, { id, body: manuscript });
    assert.ok(matching, `${label}: durable exact manuscript exists`);
    if (await buttons.count()) {
      const details = page.locator('#noteConflictHost details');
      if (!await details.evaluate(element => element.open)) await details.locator('summary').click();
      await page.locator(`[data-conflict-open="${matching}"]`).click();
    }
    await page.locator('[data-conflict-draft-body]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-conflict-draft-body]').textContent(), manuscript);
    assert.equal(await page.locator('[data-memo-conflict-resume]').isDisabled(), true);
    const download = page.waitForEvent('download');
    await page.locator('[data-memo-conflict-export]').click();
    const artifact = await download;
    const file = path.join(output, `${name}-${label}-export.txt`);
    await artifact.saveAs(file);
    assert.equal(await fs.readFile(file, 'utf8'), manuscript);
    const state = await snapshot(page);
    assert.ok(!state.stores.notes.some(row => row.id === id), `${label}: deleted note never resurrects`);
    assert.ok(state.stores['note-tombstones'].some(row => row.noteId === id), `${label}: tombstone retained`);
    await page.screenshot({ path: path.join(output, `${name}-${label}.png`), fullPage: true });
    result.checks.push({ name: label, status: 'PASS', snapshot: state });
  }
  try {
    const a = await newPage(`${origin}/index.html`);
    const id = await a.evaluate(() => currentId);
    await a.locator('#editor').fill('fictional baseline'); await saved(a, id, 'fictional baseline');
    const b = await newPage(`${origin}/index.html`);
    assert.equal(await b.evaluate(() => currentId), id);
    await b.locator('#editor').fill(manuscript);
    result.before = await b.evaluate(id => ({ dirty: noteSaveFoundation.isDirty(id), body: editor.value }), id);
    assert.equal(result.before.dirty, true); assert.equal(result.before.body, manuscript);
    result.deletion = await a.evaluate(async ({ id }) => {
      const stored = (await getStoredNoteSnapshots([id])).get(id);
      if (stored.body !== 'fictional baseline') throw Error('UNMET_PRECONDITION: natural autosave completed before deletion started');
      const started = performance.now();
      await moveMemosToTrash([id]);
      await permanentlyDeleteMemos([id]);
      return { elapsedMs: performance.now() - started };
    }, { id });
    await b.waitForFunction(async ({ id, body }) => (await noteConflictStore.readDrafts(db, id)).some(row => row.body === body), { id, body: manuscript });
    await inspectExport(b, id, 'live-deletion');
    await b.reload({ waitUntil: 'commit' }); await appReady(b);
    await inspectExport(b, id, 'same-tab-reload');
    const popout = await newPage(`${origin}/index.html?popout=${encodeURIComponent(id)}`);
    await inspectExport(popout, id, 'popout-open');
    await popout.reload({ waitUntil: 'commit' }); await appReady(popout);
    await inspectExport(popout, id, 'popout-reload');
    for (const log of result.logs) assert.deepEqual(log.exceptions, [], 'no uncaught page exception');
    result.status = 'PASS';
  } catch (error) {
    result.error = (timedOut ? 'Case watchdog timed out (90s); unreached conditions are NOT_TESTED.\n' : '') + error.stack;
    for (const [index, page] of pages.entries()) {
      try { await page.screenshot({ path: path.join(output, `${name}-failure-${index}.png`), fullPage: true }); } catch {}
    }
  } finally { clearTimeout(watchdog); await context.close(); }
  return result;
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  const root = path.resolve(process.env.MEMO_SAVE_APP_ROOT || __dirname);
  const engines = (process.env.MEMO_SAVE_BROWSERS || 'chromium,webkit').split(',').map(name => name.trim()).filter(Boolean);
  const sha256 = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const report = { platform: process.platform, startedAt: new Date().toISOString(),
    playwrightVersion: require('playwright/package.json').version, expectedCases: engines.length,
    runnerSha256: await sha256(__filename), sourceSha256: Object.fromEntries(await Promise.all(
      ['app.js', 'note-conflict-store.js', 'note-conflict-ui.js', 'note-save-foundation.js'].map(async file => [file, await sha256(path.join(root, file))]))),
    testedHead: process.env.MEMO_SAVE_SOURCE_HEAD || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTreeDiff: process.env.MEMO_SAVE_SOURCE_HEAD ? 'Archived baseline source' : execFileSync('git', ['diff', '--stat'], { cwd: root, encoding: 'utf8' }),
    cases: [], limitations: ['Same browser context only; persistent profile restart, Safari/PWA and Windows require separate evidence.'] };
  const server = createServer(root);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    for (const name of engines) {
      let browser;
      try { browser = await playwright[name].launch(); report.cases.push(await run(browser, name, `http://127.0.0.1:${server.address().port}`)); }
      catch (error) { report.cases.push({ browser: name, status: 'NOT_TESTED', error: error.stack }); }
      finally { await browser?.close(); }
    }
  } finally {
    server.close(); report.finishedAt = new Date().toISOString();
    report.actualCases = report.cases.length;
    report.status = report.expectedCases > 0 && report.actualCases === report.expectedCases
      && report.cases.every(row => row.status === 'PASS') ? 'PASS' : 'FAIL';
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'PASS') process.exitCode = 1;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
