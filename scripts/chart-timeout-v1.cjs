'use strict';
// Diagnostic-only extraction. Never edits the source checkout.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const HEAD = '87a5ac2f2dbbb940e8f4b4dd6269e5c349e75fc1';
const SOURCE_HASH = '240e906757c2514864cf1f2150cf4dfb5423abb8ba2030673ca80c49ad3a4722';
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function generate(source, scenario) {
  if (hash(source) !== SOURCE_HASH) throw Error('SOURCE_MISMATCH');
  if (!['legacy', 'narrow'].includes(scenario)) throw Error('SCENARIO');
  const end = scenario === 'legacy' ? '    await invalidReorderValue.fill("140");' : '    const narrowTotalLayout = await page.locator';
  const cutoff = source.indexOf(end);
  const cleanup = source.lastIndexOf('  } catch (error) {\n    runError = error;');
  if (cutoff < 0 || cleanup < cutoff) throw Error('EXTRACTION');
  let result = source.slice(0, cutoff) + '    });\n' + source.slice(cleanup);
  // Disable the original Windows Chromium fallback in this diagnostic copy only.
  result = result.replace(/    const executablePath = path\.join\(process\.env\.LOCALAPPDATA[^]*?return browserType\.launch\(\{ headless: true, executablePath \}\);/, '    throw error;');
  result = result.replace('      const pageErrors = [];', '      await require(process.env.CHART_DIAGNOSTIC_OBSERVER).attach(page);\n      const pageErrors = [];');
  return result;
}
function analyzeOriginal(log, engine, attempt) {
  const matches = [...log.matchAll(/Chart failure state: (\{[^\n]+\})/g)];
  const state = matches.length ? JSON.parse(matches.at(-1)[1]) : null;
  const timeoutLine = /chart-block\.e2e\.js:(1620|1757):16/.exec(log)?.[1] || null;
  return { engine, attempt, timeoutLine, state, dom: 'NOT_OBTAINED', events: 'NOT_OBTAINED', cause: 'UNKNOWN', result: timeoutLine ? 'FAIL' : /Chart E2E script chart-block.e2e.js\s*\n/.test(log) && log.includes('[PASS] Chart E2E script chart-block.e2e.js') ? 'PASS' : 'UNKNOWN' };
}
function auditWaits(text, scenario) {
  const records = text.trim() ? text.trim().split('\n').map(line=>JSON.parse(line)) : [];
  const target = r => scenario==='legacy' ? r.predicate?.includes('2件目の売上の数値') : r.predicate?.includes('labels.every((label, index)');
  const starts = records.filter(r=>r.phase==='before' && target(r));
  if(starts.length===0) return {targetReached:false,evidence:'NOT_OBTAINED',reasons:['TARGET_NOT_REACHED']};
  const reasons=[];
  const required=scenario==='legacy'?['legacyFocus','legacyStatus']:['stacked','showTotals','oneSeries','fiveItems','valuesMatch','fiveLabels','labelsMatch'];
  if(starts.length!==1) reasons.push('DUPLICATE_TARGET');
  const before=starts[0];
  if(!Number.isSafeInteger(before.id)||before.id<1) reasons.push('INVALID_ID');
  const terminal=records.filter(r=>r.id===before.id && r.phase!=='before');
  if(terminal.length!==1 || !['after','failure'].includes(terminal[0]?.phase)) reasons.push('TERMINAL_MISSING_OR_INVALID');
  for(const r of [before,...terminal]) {
    const v=r.snapshot;
    if(!v || !v.current || !Array.isArray(v.inputs) || !Array.isArray(v.labels) || !Array.isArray(v.events) || !v.conditions || !Number.isFinite(v.time) || !Array.isArray(v.current.items) || !Array.isArray(v.current.series) || !v.current.appearance || typeof v.current.appearance!=='object' || !('focus' in v) || !('status' in v) || !(v.focus===null||typeof v.focus==='string') || !(v.status===null||typeof v.status==='string')) reasons.push('SNAPSHOT_INCOMPLETE');
  }
  for(const r of [before,...terminal]) {
    if(required.some(k=>typeof r.snapshot?.conditions?.[k]!=='boolean')) reasons.push('CONDITION_MISSING');
    if(r.phase==='failure' && (typeof r.error!=='string'||!r.error)) reasons.push('FAILURE_ERROR_MISSING');
  }
  if(terminal[0]?.snapshot?.time < before.snapshot?.time) reasons.push('TIME_REVERSED');
  if(records.indexOf(terminal[0])<records.indexOf(before)) reasons.push('ORDER_REVERSED');
  return {targetReached:true,targetTerminal:terminal[0]?.phase||null,evidence:reasons.length?'INCOMPLETE':'COMPLETE',reasons};
}
function run(root, out) {
  fs.mkdirSync(out, { recursive: false }); // refuse overwrite/retry into same evidence directory
  const slots = ['chromium:legacy', 'webkit:legacy', 'chromium:narrow', 'webkit:narrow'];
  const plan = { schema: 1, source: HEAD, slots, attemptsPerSlot: 1, wallMs: 180000, maxBuffer: 16777216, actionTimeoutMs: 30000, additionalTrials: false, interventions: 'wait snapshots and passive DOM event listeners; no OFF pair' };
  fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify(plan, null, 2));
  const results = slots.map(slot => ({slot, status: 'NOT_TESTED'}));
  const flush = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  flush();
  const browserIdentity={};
  const pw=require(path.join(root,'node_modules/playwright'));
  for(const engine of ['chromium','webkit']) {
    const executable=pw[engine].executablePath();
    if(!fs.existsSync(executable)) {fs.writeFileSync(path.join(out,'preflight.json'),JSON.stringify({status:'BLOCKED',reason:'EXECUTABLE_NOT_OBTAINED',engine,executable},null,2));process.exitCode=1;return;}
    browserIdentity[engine]={executable,sha256:hash(fs.readFileSync(executable))};
  }
  fs.writeFileSync(path.join(out,'browser-identity.json'),JSON.stringify(browserIdentity,null,2));
  const fixedLock = execFileSync('git', ['show', HEAD + ':package-lock.json'], {cwd:root});
  if(hash(fixedLock)!==hash(fs.readFileSync(path.join(root,'package-lock.json')))) throw Error('DEPENDENCY_LOCK_MISMATCH');
  const source = execFileSync('git', ['show', HEAD + ':chart-block.e2e.js'], { cwd: root, encoding:'utf8' });
  // Full fixed tree, not current main, including unmodified product and dependencies lock.
  const work = path.join(out, 'fixed-source'); fs.mkdirSync(work);
  const archive = execFileSync('git', ['archive', HEAD], {cwd:root,maxBuffer:100*1024*1024});
  fs.writeFileSync(path.join(out, 'source.tar'), archive);
  execFileSync('tar', ['-xf', path.join(out, 'source.tar'), '-C', work]);
  fs.symlinkSync(path.join(root,'node_modules'), path.join(work,'node_modules'), 'dir');
  fs.writeFileSync(path.join(out,'environment.json'),JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,sourceTree:execFileSync('git',['rev-parse',HEAD+'^{tree}'],{cwd:root,encoding:'utf8'}).trim(),diagnosticHash:hash(fs.readFileSync(__filename)),observerHash:hash(fs.readFileSync(path.join(root,'scripts/chart-timeout-v1-observer.cjs'))),playwright:require(path.join(root,'node_modules/playwright/package.json')).version},null,2));
  for(let i=0;i<slots.length;i++) {
    const [engine,scenario]=slots[i].split(':'); const dir=path.join(out,engine+'-'+scenario);fs.mkdirSync(dir);
    const runner = path.join(work,'diagnostic-'+engine+'-'+scenario+'.cjs'); fs.writeFileSync(runner,generate(source,scenario));
    fs.copyFileSync(runner,path.join(dir,'runner.cjs'));
    const env={...process.env,MEMO_NEXUS_E2E_BROWSER:engine,CHART_DIAGNOSTIC_OBSERVER:path.join(root,'scripts/chart-timeout-v1-observer.cjs'),CHART_DIAGNOSTIC_OUTPUT:dir,TMPDIR:dir};
    delete env.MEMO_NEXUS_E2E_URL; delete env.MEMO_NEXUS_E2E_ACTIONABILITY_PHASES;
    const r=spawnSync(process.execPath,[runner,'--feature','chart-multi-series'],{cwd:work,env,encoding:'utf8',timeout:plan.wallMs,maxBuffer:plan.maxBuffer});
    fs.writeFileSync(path.join(dir,'stdout.log'),r.stdout||'');fs.writeFileSync(path.join(dir,'stderr.log'),r.stderr||'');
    let observation;
    try { observation=auditWaits(fs.existsSync(path.join(dir,'waits.jsonl'))?fs.readFileSync(path.join(dir,'waits.jsonl'),'utf8'):'',scenario); }
    catch(error){observation={targetReached:false,evidence:'INCOMPLETE',reasons:['MALFORMED_OBSERVATIONS']};}
    const primary=r.status===0?'PASS':'FAIL';
    if(primary==='PASS' && observation.targetTerminal==='failure') {observation.evidence='INCOMPLETE';observation.reasons.push('EXIT_OBSERVATION_MISMATCH');}
    results[i]={slot:slots[i],status:primary,primary,exit:r.status,signal:r.signal,error:r.error?.code||null,runnerHash:hash(fs.readFileSync(runner)),...observation};
    if(!results[i].targetReached) results[i].status='NOT_TESTED';
    else if(results[i].evidence!=='COMPLETE') results[i].status='INCOMPLETE';
    const launchBlocked=/Executable doesn't exist|browserType.launch|EACCES|EPERM|error while loading shared libraries/.test(r.stderr||'');
    if(launchBlocked) results[i].status='BLOCKED'; flush();
    if(r.error || results[i].status==='BLOCKED') break; // no environment retries; remaining slots NOT_TESTED
  }
  if(results.some(r=>r.status!=='PASS')) process.exitCode=1;
}
if(require.main===module) {
  const [command,dir]=process.argv.slice(2);
  if(command!=='--execute' || !dir) throw Error('explicit --execute NEW_OUTPUT_DIRECTORY required');
  run(path.resolve(__dirname,'..'),path.resolve(dir));
}
module.exports={generate,analyzeOriginal,auditWaits,hash,HEAD,SOURCE_HASH};
