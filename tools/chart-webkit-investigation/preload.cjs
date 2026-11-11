'use strict';
// Diagnostic only: no product, assertion, timer, rAF or storage-writer patches.
const fs = require('node:fs');
const path = require('node:path');
const { performance: nodePerformance } = require('node:perf_hooks');
const { createRequire } = require('node:module');
const requireSource = createRequire(path.join(process.cwd(), 'package.json'));
const playwrightModule = process.env.CHART_DIAG_PW_MODULE || 'playwright';
const playwright = requireSource(playwrightModule);
const mode = process.env.CHART_DIAG_MODE || 'none';
if (!['none', 'light', 'detailed'].includes(mode)) throw new Error(`Invalid CHART_DIAG_MODE: ${mode}`);
const output = path.resolve(process.env.CHART_DIAG_OUTPUT || 'chart-diag-output');
fs.mkdirSync(output, { recursive: true });
const metadata = { mode, playwright: requireSource(path.join(playwrightModule, 'package.json')).version, pid: process.pid, launch: 'pending' };
const writeMeta = () => fs.writeFileSync(path.join(output, 'browser.json'), JSON.stringify(metadata, null, 2));
writeMeta();
function installRecorder({ mode }) {
  const selector = '.chart-block-editor';
  const ids = new WeakMap(); let seq = 0; let dropped = 0;
  const events = []; const limit = 6000;
  function node(n) {
    if (!(n instanceof Element)) return null;
    if (!ids.has(n)) ids.set(n, ++seq);
    return { nodeId: ids.get(n), tag: n.tagName, id: n.id, class: n.className,
      value: 'value' in n ? n.value : null, ariaLabel: n.getAttribute('aria-label'),
      connected: n.isConnected, data: { ...n.dataset } };
  }
  function record(kind, target, extra = {}) {
    // Bounded ring, no bindings/Node roundtrips, clock or timer modifications.
    if (events.length === limit) { events.shift(); dropped++; }
    events.push({ t: performance.now(), kind, target: node(target), activeElement: node(document.activeElement), ...extra });
  }
  Object.defineProperty(window, '__chartDiagnostic', { value: { events, node, get dropped() { return dropped; }, timeOrigin: performance.timeOrigin } });
  for (const kind of ['beforeinput', 'input', 'focusin', 'focusout', 'pointerdown', 'click']) {
    document.addEventListener(kind, e => {
      if (e.target instanceof Element && (e.target.closest(selector) || e.target.id === 'editor'))
        record(kind, e.target, { inputType: e.inputType, data: e.data, isTrusted: e.isTrusted });
    }, { capture: true, passive: true });
  }
  if (mode === 'detailed') {
    const originalFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (...args) {
      try { record('focus-call', this, { stack: new Error().stack }); } catch (_) { /* preserve native result */ }
      return Reflect.apply(originalFocus, this, args);
    };
    new MutationObserver(records => {
      for (const r of records) {
        const relevant = n => n instanceof Element && (n.matches(selector) || n.closest(selector) || n.querySelector(selector));
        if (relevant(r.target) || [...r.addedNodes, ...r.removedNodes].some(relevant)) {
          record('childList', r.target, {
            added: [...r.addedNodes].slice(0, 30).map(node), removed: [...r.removedNodes].slice(0, 30).map(node)
          });
        }
      }
    }).observe(document, { childList: true, subtree: true });
  }
}
function snapshot() {
  const safe = f => { try { return f(); } catch (e) { return { unavailable: String(e) }; } };
  const diag = window.__chartDiagnostic;
  const describe = n => n ? { tag: n.tagName, id: n.id, ariaLabel: n.getAttribute('aria-label'), value: n.value, connected: n.isConnected, data: { ...n.dataset } } : null;
  const readScheduler = (name, methods) => safe(() => Object.fromEntries(methods.map(key => [key, typeof window[name]?.[key] === 'function' ? window[name][key]() : null])));
  return {
    url: location.href, timestamp: performance.now(), timeOrigin: performance.timeOrigin,
    events: diag?.events || [], dropped: diag?.dropped || 0,
    activeElement: diag ? diag.node(document.activeElement) : describe(document.activeElement),
    editors: [...document.querySelectorAll('.chart-block-editor')].map(e => ({ html: e.outerHTML, fields: [...e.querySelectorAll('input,select,textarea')].map(describe) })),
    editorText: document.querySelector('#editor')?.value,
    charts: safe(() => window.MemoNexusChartBlockUtils?.splitChartBlocks(document.querySelector('#editor')?.value || '').filter(x => x.type === 'chart')),
    statuses: [...document.querySelectorAll('[role="status"],#saveStatus,#contentSourceStatus,.chart-block-editor-status,.chart-block-status')].map(e => ({ id: e.id, class: e.className, text: e.textContent })),
    draftMirror: readScheduler('MemoNexusDraftMirrorScheduler', ['pendingNoteId', 'pendingRevision']),
    derivedUi: readScheduler('MemoNexusTypingDerivedUiScheduler', ['pendingNoteId', 'pendingRequestType']),
    save: safe(() => ({ currentId: typeof currentId !== 'undefined' ? currentId : null,
      status: typeof saveStatusState !== 'undefined' ? saveStatusState : null,
      foundation: typeof noteSaveFoundation !== 'undefined' && typeof currentId !== 'undefined' ? noteSaveFoundation.getState(currentId) : null }))
  };
}
const pages = new WeakSet(); let pageCounter = 0;
async function instrumentPage(page) {
  if (pages.has(page)) return page;
  pages.add(page); const id = ++pageCounter;
  const waits = [];
  if (mode === 'detailed') {
    const waitForFunction = page.waitForFunction;
    page.waitForFunction = async function (...args) {
      const source = String(args[0]);
      if (!source.includes('2件目の売上の数値')) return Reflect.apply(waitForFunction, this, args);
      const entry = { source, nodeTimeOrigin: nodePerformance.timeOrigin, start: nodePerformance.now() };
      waits.push(entry);
      try { const result = await Reflect.apply(waitForFunction, this, args); entry.outcome = 'resolved'; return result; }
      catch (e) { entry.outcome = 'rejected'; entry.error = String(e); throw e; }
      finally { entry.end = nodePerformance.now(); }
    };
  }
  if (mode !== 'none') await page.addInitScript(installRecorder, { mode });
  if (mode !== 'none') {
    const reload = page.reload; let reloadCounter = 0;
    page.reload = async function (...args) {
      const target = path.join(output, `page-${id}-before-reload-${++reloadCounter}.json`);
      try { fs.writeFileSync(target, JSON.stringify(await page.evaluate(snapshot), null, 2)); }
      catch (e) { fs.writeFileSync(target, JSON.stringify({ captureError: String(e) }, null, 2)); }
      return Reflect.apply(reload, this, args);
    };
  }
  const close = page.close;
  page.close = async function (...args) {
    const errors = [];
    if (mode === 'detailed') fs.writeFileSync(path.join(output, `page-${id}-waits.json`), JSON.stringify(waits, null, 2));
    try { fs.writeFileSync(path.join(output, `page-${id}.json`), JSON.stringify(await page.evaluate(snapshot), null, 2)); }
    catch (e) { errors.push(`snapshot: ${e}`); }
    try { await page.screenshot({ path: path.join(output, `page-${id}.png`), timeout: 5000 }); }
    catch (e) { errors.push(`screenshot: ${e}`); }
    if (errors.length) fs.writeFileSync(path.join(output, `page-${id}-capture-errors.json`), JSON.stringify(errors, null, 2));
    return Reflect.apply(close, this, args);
  };
  return page;
}
for (const name of ['webkit', 'chromium']) {
  const type = playwright[name]; const launch = type.launch;
  type.launch = async function (options = {}) {
    const executable = name === 'webkit' ? process.env.CHART_DIAG_WEBKIT_EXECUTABLE : process.env.CHART_DIAG_CHROMIUM_EXECUTABLE;
    metadata.browser = name; metadata.executableOverride = executable || null; metadata.launch = 'starting'; writeMeta();
    let browser;
    try { browser = await Reflect.apply(launch, this, [executable ? { ...options, executablePath: executable } : options]); }
    catch (e) { metadata.launch = 'failed'; metadata.error = String(e); writeMeta(); throw e; }
    metadata.launch = 'succeeded'; metadata.version = browser.version(); writeMeta();
    const newPage = browser.newPage;
    browser.newPage = async function (...args) { return instrumentPage(await Reflect.apply(newPage, this, args)); };
    const newContext = browser.newContext;
    browser.newContext = async function (...args) {
      const context = await Reflect.apply(newContext, this, args); const contextNewPage = context.newPage;
      context.newPage = async function (...pageArgs) { return instrumentPage(await Reflect.apply(contextNewPage, this, pageArgs)); };
      return context;
    };
    return browser;
  };
}
