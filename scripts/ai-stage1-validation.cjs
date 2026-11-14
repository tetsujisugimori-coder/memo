'use strict';
// Synthetic-only, localhost-only diagnostic harness. Never imports user storage.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { buildAiMessages } = require('../ai-prompts');
const { DEFAULT_AI_SETTINGS } = require('../ai-provider');
const { OllamaAdapter } = require('../ollama-adapter');
const { createStore } = require('../ai-diagnostics');
const BASE = 'http://127.0.0.1:11434';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const PLAN = Object.freeze(['A','A','B','B','B','B','B','C','C','D','D','D','D','D']);
function fixture(group, history = [], language = 'ja') {
  if (!['A','B','C','D'].includes(group)) throw Error('invalid_group');
  const purpose = ['A','B'].includes(group) ? 'translate' : 'question';
  const reference = purpose === 'translate' ? { mode: 'selected-text', content: 'The blue bird sits by the window.' } : { mode: 'none' };
  const userInstruction = purpose === 'question' ? '2+3はいくつですか' : '';
  const selectedHistory = ['B','D'].includes(group) ? history : [];
  return { purpose, referenceMode: reference.mode, historyMessageCount: selectedHistory.length,
    translationLanguage: language, userInstruction,
    messages: buildAiMessages({ purpose, reference, userInstruction, history: selectedHistory,
      translationLanguage: language, systemInstruction: DEFAULT_AI_SETTINGS.systemInstruction }) };
}
function newOutput(parent) {
  // A new leaf must be created, never overwrite existing evidence.
  const dir = path.join(path.resolve(parent), `ai-stage1-${Date.now()}-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'raw')); fs.mkdirSync(path.join(dir, 'analysis'));
  return dir;
}
function save(dir, relative, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  fs.writeFileSync(path.join(dir, relative), text, { flag: 'wx' });
  return { file: relative, bytes: Buffer.byteLength(text), sha256: hash(text) };
}
async function boundedJson(route, fetchImpl = fetch) {
  const response = await fetchImpl(BASE + route, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw Error('http_error');
  if (!response.body) throw Error('response_missing');
  const reader = response.body.getReader(); const chunks = []; let bytes = 0;
  try { while (true) { const p = await reader.read(); if (p.done) break; bytes += p.value.byteLength;
    if (bytes > 1024 * 1024) throw Error('response_limit'); chunks.push(Buffer.from(p.value));
  } } finally { await reader.cancel().catch(()=>{}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function probe(fetchImpl = fetch) {
  let version = 'UNKNOWN', models = [], service = 'BLOCKED';
  try {
    const v = await boundedJson('/api/version', fetchImpl);
    const m = await boundedJson('/api/tags', fetchImpl);
    if (typeof v.version !== 'string' || !/^[\w.+-]{1,80}$/.test(v.version) || !Array.isArray(m.models)) throw Error('invalid_metadata');
    version = v.version;
    models = m.models.map(m => m.name).filter(n => typeof n === 'string' && /^[\w][\w.:/-]{0,199}$/.test(n)).slice(0,100);
    service = models.length ? 'AVAILABLE' : 'NO_MODELS';
  } catch (_) { /* Never persist arbitrary server/error messages. */ }
  let cli = 'NOT_FOUND';
  try { const s = execFileSync('ollama', ['--version'], { timeout: 5000, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }); cli = /\d+\.\d+\.\d+/.exec(s)?.[0] || 'UNKNOWN'; } catch (_) {}
  let browser = 'NOT_FOUND'; try { browser = require('playwright/package.json').version; } catch (_) {}
  return { platform: process.platform, node: process.version, ollamaCli: cli, version, service, models, playwright: browser,
    browserExecution: 'NOT_TESTED', windowsExecution: process.platform === 'win32' ? 'PROBE_ONLY' : 'NOT_TESTED', endpoint: BASE };
}
function classify(d) {
  if (!d || typeof d.requestId !== 'string' || !d.finalized) return 'INCOMPLETE';
  if (d.staleResponse) return 'STALE';
  if (d.errorType === 'timeout') return 'TIMEOUT';
  if (d.errorType === 'aborted') return 'INTERRUPTED';
  if (d.errorType === 'connection') return 'CONNECTION';
  if (d.errorType !== 'UNKNOWN') return 'ERROR';
  if (!Number.isInteger(d.httpStatus) || d.httpStatus < 200 || d.httpStatus > 299) return 'ERROR';
  if (!d.streamStarted || !d.streamEndedNormally) return 'INCOMPLETE';
  if (!d.doneReceived) return 'MISSING_DONE';
  if (!d.bodyCharacters) return d.thinkingCharacters ? 'THINKING_ONLY' : 'EMPTY';
  if (!d.finalAnswerCharacters) return 'FINALIZATION_CANDIDATE';
  return 'TEXT_OBSERVED';
}
async function observe(request, lane, fetchImpl = fetch, deadlineMs = 60000) {
  const store = createStore(); const diagnostic = store.begin({ ...request, provider: 'ollama', uiPurpose: request.purpose, uiTranslationLanguage: request.translationLanguage });
  const controller = new AbortController(); let deadline = false;
  const timer = setTimeout(() => { deadline = true; controller.abort(); }, deadlineMs);
  let answer = '', errorCode;
  // Bound bytes and forbid redirects, including in the unchanged production adapter.
  const guardedFetch = async (url, options) => {
    if (url !== BASE + '/api/chat') throw Error('endpoint_rejected');
    let r;
    try { r = await fetchImpl(url, { ...options, redirect: 'error' }); }
    catch (e) { const safe = Error('transport'); safe.code = e.name === 'AbortError' ? 'aborted' : 'connection'; throw safe; }
    const reader = r.body?.getReader(); let bytes = 0;
    const stream = reader && new ReadableStream({ async pull(c) {
      try { const part = await reader.read(); if (part.done) { c.close(); return; }
        bytes += part.value.byteLength; if (bytes > 1024 * 1024) { await reader.cancel(); c.error(Error('response_limit')); return; } c.enqueue(part.value);
      } catch (_) { const e = Error('transport'); e.code = 'connection'; c.error(e); }
    }, cancel() { return reader.cancel(); } });
    return new Response(stream || null, { status: r.status, headers: r.headers });
  };
  try {
    if (lane === 'adapter') {
      const adapter = new OllamaAdapter({ baseUrl: BASE, fetchImpl: guardedFetch });
      for await (const e of adapter.generate({ ...request, signal: controller.signal, onDiagnostic: diagnostic.observe })) if (e.type === 'text') answer += e.content;
    } else if (lane === 'direct') {
      const response = await guardedFetch(BASE + '/api/chat', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ model: request.model, stream: true, messages: request.messages, options: {} }), signal: controller.signal });
      diagnostic.observe('http', { status: response.status });
      if (!response.ok || !response.body) throw Error('http_error');
      diagnostic.observe('stream-start'); const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      const line = text => { if (!text.trim()) return; const e = JSON.parse(text); if (e.error) throw Error('provider_error');
        const body = typeof e.message?.content === 'string' ? e.message.content : typeof e.response === 'string' ? e.response : '';
        const thinking = typeof e.message?.thinking === 'string' ? e.message.thinking : '';
        if (body) diagnostic.observe('body', {characters: body.length}); diagnostic.observe('thinking', {characters: thinking.length});
        if (e.done === true) diagnostic.observe('done'); answer += body;
      };
      try { while (true) { const p = await reader.read(); if (p.done) break; diagnostic.observe('chunk'); buffer += decoder.decode(p.value, {stream:true});
        let index; while ((index = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0,index)); buffer = buffer.slice(index+1); }
      } buffer += decoder.decode(); line(buffer); diagnostic.observe('stream-end'); }
      finally { await reader.cancel().catch(()=>{}); }
    } else throw Error('invalid_lane');
  } catch (e) { errorCode = deadline ? 'timeout' : e.code || (e.name === 'AbortError' ? 'aborted' : 'invalid_response'); }
  finally { clearTimeout(timer); diagnostic.finish({characters:answer.length,errorCode}); }
  const record = store.snapshot()[0]; store.clear();
  return { record, answer, classification: classify(record) };
}
function auditPair(pair) {
  const a = pair?.direct, b = pair?.adapter;
  const result = { trialId: pair?.trialId, evidence: 'INCOMPLETE', rootCause: 'UNKNOWN', visibility: 'NOT_TESTED', app: 'NOT_TESTED', candidate: 'UNKNOWN' };
  if (!/^trial-\d{2}-[ABCD]$/.test(pair?.trialId || '') || !a || !b || !pair.fixtureSha256 || !/^[a-f0-9]{64}$/.test(pair.fixtureSha256)) return result;
  if (a.requestId === b.requestId || a.provider !== 'ollama' || b.provider !== 'ollama') return result;
  for (const key of ['model','purpose','referenceMode','historyMessageCount','translationLanguage','sentMessageCount','inputCharacters']) if (a[key] !== b[key]) return result;
  for (const d of [a,b]) {
    if (typeof d.model !== 'string' || !/^[\w][\w.:/-]{0,199}$/.test(d.model) ||
      !['translate','question'].includes(d.purpose) || !['selected-text','none'].includes(d.referenceMode) ||
      !['ja','en'].includes(d.translationLanguage) || !['UNKNOWN','aborted','timeout','connection','model_missing','provider','invalid_response','stream_parse'].includes(d.errorType) ||
      ['historyMessageCount','sentMessageCount','inputCharacters','bodyChunks','doneCount'].some(k=>!Number.isSafeInteger(d[k]) || d[k]<0) ||
      ['streamStarted','streamEndedNormally','doneReceived','finalized','staleResponse'].some(k=>typeof d[k] !== 'boolean') ||
      (d.httpStatus !== 'UNKNOWN' && (!Number.isInteger(d.httpStatus) || d.httpStatus<100 || d.httpStatus>599)) ||
      d.doneReceived !== (d.doneCount>0) || (d.streamEndedNormally && !d.streamStarted) ||
      (d.bodyCharacters>0 && (!d.bodyChunks || !d.streamStarted)) ||
      (d.errorType === 'UNKNOWN' && (!Number.isInteger(d.httpStatus) || d.httpStatus<200 || d.httpStatus>299))) return result;
  }
  for (const d of [a,b]) if (!d.finalized || typeof d.requestId !== 'string' || ['bodyCharacters','thinkingCharacters','finalAnswerCharacters','receivedChunks'].some(k => !Number.isSafeInteger(d[k]) || d[k] < 0)) return result;
  result.evidence = 'PAIR_OBSERVED'; result.direct = classify(a); result.adapter = classify(b);
  if (result.direct === 'TEXT_OBSERVED' && b.bodyCharacters === 0) result.candidate = 'TRANSPORT_OR_ADAPTER';
  else if (!a.bodyCharacters && !b.bodyCharacters) result.candidate = 'MODEL_PROMPT_OR_OLLAMA';
  else if (b.bodyCharacters && !b.finalAnswerCharacters) result.candidate = 'FINALIZATION';
  // Adapter execution is not app execution; do not fabricate DOM or visibility.
  return result;
}
async function run({ model, output, execute = false, fetchImpl = fetch }) {
  if (!execute) throw Error('explicit_execute_required');
  if (typeof model !== 'string' || !/^[\w][\w.:/-]{0,199}$/.test(model)) throw Error('invalid_model');
  const env = await probe(fetchImpl); if (!env.models.includes(model)) throw Error('installed_model_required');
  const available = fs.statfsSync(path.resolve(output)); if (Number(available.bavail) * Number(available.bsize) < 32*1024*1024) throw Error('capacity_required');
  const dir = newOutput(output); const manifest = [save(dir, 'raw/environment.json', env)];
  const source = {}; for (const f of ['ai-prompts.js','ai-context.js','ai-provider.js','ollama-adapter.js','ai-diagnostics.js','scripts/ai-stage1-validation.cjs']) source[f] = hash(fs.readFileSync(path.join(__dirname,'..',f)));
  manifest.push(save(dir,'raw/source.json',source)); manifest.push(save(dir,'raw/plan.json',{groups:PLAN,order:['direct','adapter'],maxRequests:28,maxSecondsPerRequest:60,maxResponseBytes:1048576,retries:0,syntheticOnly:true}));
  const rows = []; let history = [], previous = '';
  for (const [i, group] of PLAN.entries()) {
    if (group !== previous || ['A','C'].includes(group)) history = [];
    previous = group; const f = fixture(group,history); const req = {...f, model};
    const a = await observe(req, 'direct', fetchImpl); const b = await observe(req, 'adapter', fetchImpl);
    const trialId = `trial-${String(i+1).padStart(2,'0')}-${group}`;
    const pair = {trialId, fixtureSha256: hash(JSON.stringify({model,messages:f.messages,options:{}})),direct:a.record,adapter:b.record};
    manifest.push(save(dir,`raw/${trialId}.json`,pair)); rows.push(auditPair(pair));
    // Same prior direct synthetic answer supplied to both lanes, not independent divergent histories.
    if (f.userInstruction) history.push({role:'user',content:f.userInstruction});
    if (a.answer) history.push({role:'assistant',content:a.answer});
    if (['TIMEOUT','CONNECTION','ERROR','INCOMPLETE'].includes(a.classification) || ['TIMEOUT','CONNECTION','ERROR','INCOMPLETE'].includes(b.classification)) break;
  }
  manifest.push(save(dir,'analysis/report.json',{result:'PARTIAL',rows,rootCause:'UNKNOWN',app:'PENDING_MANUAL',planned:14,completed:rows.length}));
  manifest.push(save(dir,'analysis/report.md',`# Stage 1 bounded comparison\n\nPARTIAL. Root UNKNOWN. App/DOM/visibility PENDING_MANUAL.\n\n${rows.map(r=>`- ${r.trialId}: ${r.direct || 'INCOMPLETE'} / ${r.adapter || 'INCOMPLETE'}; ${r.candidate}`).join('\n')}\n`));
  save(dir,'manifest.json',manifest); return dir;
}
async function main(args) {
  const [command, ...rest] = args; const get = flag => rest[rest.indexOf(flag)+1];
  if (command === 'plan') console.log(JSON.stringify({groups:PLAN,requests:28,endpoint:BASE,executeRequired:true,app:'PENDING_MANUAL'}));
  else if (command === 'probe') console.log(JSON.stringify(await probe(),null,2));
  else if (command === 'run') console.log(await run({model:get('--model'),output:get('--output'),execute:rest.includes('--execute')}));
  else throw Error('use_plan_probe_run');
}
module.exports = {fixture,probe,classify,observe,auditPair,run,PLAN};
if (require.main === module) main(process.argv.slice(2)).catch(()=>{ console.error('BLOCKED: validation command failed; no automatic retry. Check model, output, command and local service.'); process.exitCode=1; });
