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
  result = result.replace('      const pageErrors = [];', '      await require(process.env.CHART_DIAGNOSTIC_OBSERVER).attach(page);\n      const pageErrors = [];');
  return result;
}
function analyzeOriginal(log, engine, attempt) {
  const matches = [...log.matchAll(/Chart failure state: (\{[^\n]+\})/g)];
  const state = matches.length ? JSON.parse(matches.at(-1)[1]) : null;
  const timeoutLine = /chart-block\.e2e\.js:(1620|1757):16/.exec(log)?.[1] || null;
  return { engine, attempt, timeoutLine, state, dom: 'NOT_OBTAINED', events: 'NOT_OBTAINED', cause: 'UNKNOWN', result: timeoutLine ? 'FAIL' : /Chart E2E script chart-block.e2e.js\s*\n/.test(log) && log.includes('[PASS] Chart E2E script chart-block.e2e.js') ? 'PASS' : 'UNKNOWN' };
}
function run(root, out) {
  fs.mkdirSync(out, { recursive: false }); // refuse overwrite/retry into same evidence directory
  const slots = ['chromium:legacy', 'webkit:legacy', 'chromium:narrow', 'webkit:narrow'];
  const plan = { schema: 1, source: HEAD, slots, attemptsPerSlot: 1, wallMs: 180000, maxBuffer: 16777216, actionTimeoutMs: 30000, additionalTrials: false, interventions: 'wait snapshots and passive DOM event listeners; no OFF pair' };
  fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify(plan, null, 2));
  const results = slots.map(slot => ({slot, status: 'NOT_TESTED'}));
  const flush = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  flush();
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
    results[i]={slot:slots[i],status:r.status===0?'PASS':'FAIL',exit:r.status,signal:r.signal,error:r.error?.code||null,runnerHash:hash(fs.readFileSync(runner)),targetReached:fs.existsSync(path.join(dir,'waits.jsonl')) && fs.readFileSync(path.join(dir,'waits.jsonl'),'utf8').includes(scenario==='legacy'?'2件目の売上の数値':'labels.every((label, index)')};
    if(!results[i].targetReached) results[i].status='NOT_TESTED';
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
module.exports={generate,analyzeOriginal,hash,HEAD,SOURCE_HASH};
