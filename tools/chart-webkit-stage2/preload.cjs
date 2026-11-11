'use strict';
// Diagnostic only. The all-suite parent and npm processes are not instrumented.
const path = require('node:path');
const entry = path.basename(process.argv[1] || '');
if (['chart-block.e2e.js', 'chart-file-export.e2e.js'].includes(entry)) {
  const fs = require('node:fs');
  const crypto = require('node:crypto');
  const { performance } = require('node:perf_hooks');
  const { createRequire } = require('node:module');
  const fromTest = createRequire(path.join(process.cwd(), 'package.json'));
  const pw = fromTest('playwright');
  const mode = process.env.CHART_STAGE2_MODE;
  if (!['light', 'detailed'].includes(mode)) throw new Error('invalid diagnostic mode');
  const output = path.join(process.env.CHART_STAGE2_OUTPUT, `process-${process.pid}-${crypto.randomBytes(8).toString('hex')}`);
  fs.mkdirSync(output); // Unique process directory; never overwrite another process.
  const stream = fs.createWriteStream(path.join(output, 'events.jsonl'), { flags: 'wx' });
  let writes = 0, completed = 0, writeErrors = 0, backpressure = 0, rejected = 0;
  stream.on('error', () => { writeErrors++; });
  function line(object) {
    return new Promise(resolve => {
      try {
        const data = JSON.stringify(object) + '\n';
        if (stream.writableLength + Buffer.byteLength(data) > 1024*1024) { rejected++; return resolve(false); }
        writes++;
        if (!stream.write(data, e => { if (e) writeErrors++; else completed++; resolve(!e); })) backpressure++;
      } catch (_) { writeErrors++; resolve(false); }
    });
  }
  line({type:'process-start', entry, pid:process.pid, mode, utc:new Date().toISOString(), nodeTimeOrigin:performance.timeOrigin});
  process.on('exit', code => {
    // A stream write accepted into memory is not proof of durable storage.
    try { fs.writeFileSync(path.join(output, 'exit.json'), JSON.stringify({code, utc:new Date().toISOString(), acceptedWrites:writes, writeCallbacksCompleted:completed, writeErrors, backpressure, rejected, unflushedTail:'UNKNOWN'}), {flag:'wx'}); } catch (_) {}
  });
  function recorder({mode}) {
    const documentId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ids = new WeakMap(); let nextId = 0, sequence = 0, dropped = 0, pending = false, errors = 0;
    let queue = []; const max = 1500;
    const describe = n => {
      if (!(n instanceof Element)) return null;
      if (!ids.has(n)) ids.set(n, ++nextId);
      const row = n.closest('.chart-block-item-row,.chart-block-series-row');
      return {id:ids.get(n), tag:n.tagName, domId:n.id, aria:n.getAttribute('aria-label'), data:{...n.dataset}, row:row ? {...row.dataset} : null, connected:n.isConnected, focused:document.activeElement===n, value:'value' in n ? n.value : null};
    };
    function state() {
      let chart = null;
      try { chart = window.MemoNexusChartBlockUtils?.splitChartBlocks(document.querySelector('#editor')?.value || '').find(s => s.type === 'chart')?.chart || null; } catch (_) {}
      return {chart, status:document.querySelector('.chart-block-editor .chart-block-status')?.textContent || null, fields:[...document.querySelectorAll('.chart-block-editor input[data-chart-series-value]')].map(describe)};
    }
    function record(kind, target, extra = {}) {
      try {
        const event = {seq:++sequence, t:performance.now(), kind, target:describe(target), active:describe(document.activeElement), ...extra};
        if (queue.length === max) { queue.shift(); dropped++; }
        queue.push(event);
      } catch (_) { errors++; }
    }
    function flush() {
      if (pending || !queue.length || typeof window.__chartStage2Sink !== 'function') return;
      pending = true; const batch = queue; queue = [];
      Promise.resolve(window.__chartStage2Sink({documentId, timeOrigin:performance.timeOrigin, sentAt:performance.now(), dropped, recorderErrors:errors, events:batch}))
        .catch(() => { errors++; dropped += batch.length; }).finally(() => { pending = false; });
    }
    Object.defineProperty(window, '__chartStage2', {value:{flush, state, describe, stats:()=>({sequence,dropped,errors,queued:queue.length,pending}), take:()=>{const events=queue;queue=[];return {documentId,timeOrigin:performance.timeOrigin,t:performance.now(),dropped,recorderErrors:errors,pending,events};}}});
    for (const kind of ['beforeinput','input','focusin','focusout','pointerdown','click']) {
      document.addEventListener(kind, e => {
        if (!(e.target instanceof Element) || !e.target.closest('.chart-block-editor')) return;
        const action = e.target.closest('button')?.dataset.chartAction || '';
        record(kind, e.target, {inputType:e.inputType || null, data:e.data || null, trusted:e.isTrusted, ...(kind === 'click' && action.includes('move-item') ? {state:state()} : {})});
      }, {capture:true, passive:true});
    }
    if (mode === 'detailed') {
      const focus = HTMLElement.prototype.focus;
      HTMLElement.prototype.focus = function (...args) { try { record('focus-call',this,{stack:new Error().stack}); } catch (_) {} return Reflect.apply(focus,this,args); };
      new MutationObserver(records => {
        for (const r of records) {
          const relevant = n => n instanceof Element && (n.matches('.chart-block-editor') || n.closest('.chart-block-editor') || n.querySelector('.chart-block-editor'));
          if (relevant(r.target) || [...r.addedNodes,...r.removedNodes].some(relevant)) record('mutation-callback',r.target,{added:[...r.addedNodes].slice(0,30).map(describe),removed:[...r.removedNodes].slice(0,30).map(describe),truncated:Math.max(0,r.addedNodes.length-30)+Math.max(0,r.removedNodes.length-30)});
        }
      }).observe(document,{childList:true,subtree:true});
    }
    addEventListener('pagehide',flush);
    setInterval(flush, 1000); // No await or rAF/timer replacement in the tested operations.
  }
  const seen = new WeakSet(); let pageId = 0;
  async function instrument(page) {
    if (seen.has(page)) return page;
    seen.add(page); const id = ++pageId;
    await page.exposeBinding('__chartStage2Sink', async (_source, payload) => { if (!await line({type:'batch',pageId:id,receivedUtc:new Date().toISOString(),nodeMs:performance.now(),payload})) throw new Error('diagnostic write rejected'); });
    await page.addInitScript(recorder,{mode});
    line({type:'page-created',pageId:id,utc:new Date().toISOString(),nodeMs:performance.now()});
    if (mode === 'light') {
      // These checkpoints occur at test-requested close/reload boundaries; they can delay the next feature.
      for (const operation of ['close','reload']) {
        const original = page[operation];
        page[operation] = async function (...args) {
          try {
            const payload = await page.evaluate(() => window.__chartStage2?.take() || null);
            if (!await line({type:'boundary',operation,pageId:id,receivedUtc:new Date().toISOString(),nodeMs:performance.now(),payload})) line({type:'capture-error',pageId:id,error:'boundary write rejected'});
          } catch (e) { line({type:'capture-error',pageId:id,error:String(e)}); }
          return Reflect.apply(original,this,args);
        };
      }
    }
    if (mode === 'detailed') {
      const wait = page.waitForFunction;
      page.waitForFunction = async function (...args) {
        if (!String(args[0]).includes('2件目の売上の数値')) return Reflect.apply(wait,this,args);
        const start = performance.now(); line({type:'wait-start',pageId:id,nodeMs:start,condition:String(args[0])});
        try { const result = await Reflect.apply(wait,this,args); line({type:'wait-end',pageId:id,nodeMs:performance.now(),outcome:'resolved'}); return result; }
        catch (error) {
          line({type:'wait-end',pageId:id,nodeMs:performance.now(),outcome:'rejected',error:String(error)});
          try { const snapshot = await page.evaluate(() => ({timeOrigin:performance.timeOrigin,t:performance.now(),state:window.__chartStage2?.state(),stats:window.__chartStage2?.stats()})); line({type:'timeout-snapshot',pageId:id,nodeMs:performance.now(),snapshot}); }
          catch (captureError) { line({type:'capture-error',pageId:id,error:String(captureError)}); }
          throw error;
        }
      };
    }
    return page;
  }
  for (const name of ['webkit','chromium']) {
    const type = pw[name], launch = type.launch;
    type.launch = async function (...args) {
      line({type:'browser-launch-start',browser:name,options:args[0] || {},utc:new Date().toISOString()});
      try {
        const browser = await Reflect.apply(launch,this,args);
        line({type:'browser-launch-end',browser:name,version:browser.version(),utc:new Date().toISOString()});
        browser.on('disconnected',()=>line({type:'browser-disconnected',browser:name,utc:new Date().toISOString()}));
        const newPage = browser.newPage;
        browser.newPage = async function (...a) { return instrument(await Reflect.apply(newPage,this,a)); };
        const newContext = browser.newContext;
        browser.newContext = async function (...a) { const context = await Reflect.apply(newContext,this,a); const create = context.newPage; context.newPage = async function (...p) { return instrument(await Reflect.apply(create,this,p)); }; return context; };
        return browser;
      } catch (e) { line({type:'browser-launch-error',error:String(e),utc:new Date().toISOString()}); throw e; }
    };
  }
}
