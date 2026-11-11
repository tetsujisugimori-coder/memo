'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { createRequire } = require('node:module');
const { spawn, execFileSync } = require('node:child_process');
const args = process.argv.slice(2); const options = { sources: [], revisions: {}, modes: ['none','light','detailed'], repeats: 2, browser: 'webkit', timeout: 180 };
const usage = 'node run.cjs --source main=/path/main --source pr=/path/pr --revision main=08572bb --revision pr=a581cb6 --output /path/results [--git-repo /path/repo] [--modes none,light,detailed] [--repeats 2] [--browser webkit|chromium] [--webkit-executable /path/launcher] [--chromium-executable /path/browser] [--node-modules /path/node_modules] [--timeout 180]';
function pair(value) { const index = value.indexOf('='); if (index < 1) throw new Error(`Expected name=value: ${value}`); return [value.slice(0,index), value.slice(index+1)]; }
for (let i=0;i<args.length;i++) {
  const flag = args[i]; if (flag === '--help') { console.log(usage); process.exit(0); }
  const value = args[++i]; if (!value) throw new Error(`Missing value for ${flag}`);
  if (flag === '--source') { const [label, root] = pair(value); options.sources.push({ label, root: path.resolve(root) }); }
  else if (flag === '--revision') { const [label, revision] = pair(value); options.revisions[label] = revision; }
  else if (flag === '--output') options.output = path.resolve(value);
  else if (flag === '--modes') options.modes = value.split(',');
  else if (flag === '--repeats') options.repeats = Number(value);
  else if (flag === '--timeout') options.timeout = Number(value);
  else if (flag === '--browser') options.browser = value;
  else if (flag === '--git-repo') options.gitRepo = path.resolve(value);
  else if (flag === '--node-modules') options.nodeModules = path.resolve(value);
  else if (flag === '--webkit-executable') options.webkitExecutable = path.resolve(value);
  else if (flag === '--chromium-executable') options.chromiumExecutable = path.resolve(value);
  else throw new Error(`Unknown flag ${flag}`);
}
if (!options.sources.length || !options.output) throw new Error(usage);
if (!Number.isInteger(options.repeats) || options.repeats < 1 || options.repeats > 20) throw new Error('repeats must be an integer 1..20');
if (!(options.timeout > 0 && options.timeout <= 180)) throw new Error('timeout must be > 0 and <= 180 seconds');
if (!['webkit','chromium'].includes(options.browser)) throw new Error('Unsupported browser');
if (!options.modes.length || options.modes.some(m => !['none','light','detailed'].includes(m))) throw new Error('Invalid modes');
if (new Set(options.sources.map(s=>s.label)).size !== options.sources.length || options.sources.some(s=>!/^[a-zA-Z0-9_-]+$/.test(s.label))) throw new Error('Source labels must be unique and alphanumeric/underscore/hyphen');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const hashFile = file => fs.existsSync(file) ? hash(fs.readFileSync(file)) : null;
function sourceManifest(root) {
  const files = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (['.git','node_modules','e2e-artifacts'].includes(entry.name)) continue;
      const absolute = path.join(dir, entry.name); const relative = path.relative(root,absolute);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push({ path: relative, sha256: hashFile(absolute) });
      else if (entry.isSymbolicLink()) files.push({ path: relative, symlink: fs.readlinkSync(absolute) });
    }
  }
  visit(root); return { treeSha256: hash(JSON.stringify(files)), files };
}
function gitIdentity(source) {
  const expected = options.revisions[source.label] || null;
  try {
    const repo = options.gitRepo || source.root;
    const sha = execFileSync('git',['-C',repo,'rev-parse',expected || 'HEAD'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    const tree = execFileSync('git',['-C',repo,'rev-parse',`${sha}^{tree}`],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    return { requestedRevision:expected, commit:sha, gitTree:tree, note:'Git object identity; actual source contents separately hashed in source-manifest.json.' };
  } catch (e) { return { requestedRevision:expected, gitIdentityUnavailable: String(e.message) }; }
}
fs.mkdirSync(options.output,{recursive:true});
const preload = path.join(__dirname,'preload.cjs');
const results = [];
const protectedFiles = ['app.js', 'chart-block.e2e.js', 'chart-block-utils.js', 'typing-derived-ui-scheduler.js', 'package.json', 'package-lock.json'];
const plan = [];
for (let repetition=1; repetition<=options.repeats; repetition++) for (const source of options.sources) for (const mode of options.modes)
  plan.push({ name: `${repetition}-${source.label}-${options.browser}-${mode}`, source: source.root, mode, repetition, status:'not_started' });
const savePlan = () => fs.writeFileSync(path.join(options.output,'plan.json'), JSON.stringify(plan,null,2));
savePlan();
function protectedHashes(root) { return Object.fromEntries(protectedFiles.map(file=>[file,hashFile(path.join(root,file))])); }
function verifySource(source, identity) {
  if (!identity.commit) {
    if (options.revisions[source.label]) throw new Error(`Cannot verify expected source revision for ${source.label}: ${identity.gitIdentityUnavailable}`);
    return { verified:false, reason:'No resolvable Git revision supplied' };
  }
  const files = {};
  for (const file of protectedFiles) {
    const expected = execFileSync('git',['-C',options.gitRepo || source.root,'show',`${identity.commit}:${file}`],{maxBuffer:16*1024*1024});
    const actual = fs.readFileSync(path.join(source.root,file));
    if (!actual.equals(expected)) throw new Error(`Source mismatch: ${source.label}/${file} differs from ${identity.commit}`);
    files[file] = hash(actual);
  }
  return { verified:true, commit:identity.commit, files };
}
function runtimeMetadata(source) {
  const fromSource = createRequire(path.join(source.root,'package.json'));
  const modulePath = options.nodeModules ? path.join(options.nodeModules,'playwright-core') : 'playwright-core';
  let browserManifest;
  try { const manifestPath = path.join(path.dirname(fromSource.resolve(modulePath)), 'browsers.json'); browserManifest = {path:manifestPath,sha256:hashFile(manifestPath),contents:JSON.parse(fs.readFileSync(manifestPath,'utf8'))}; }
  catch(e) { browserManifest = {unavailable:String(e)}; }
  return { node:process.version, platform:process.platform, arch:process.arch, osRelease:os.release(),
    osReleaseFile:fs.existsSync('/etc/os-release')?fs.readFileSync('/etc/os-release','utf8'):null,
    browserManifest, fixture:{viewport:{width:1100,height:820}, assertionTimeoutMs:30000, note:'Original test/Playwright default, no override'} };
}
async function run(source, mode, repetition) {
  const name = `${repetition}-${source.label}-${options.browser}-${mode}`;
  const dir = path.join(options.output,name);
  const planEntry = plan.find(entry=>entry.name === name); planEntry.status='starting'; planEntry.start=new Date().toISOString(); savePlan();
  fs.mkdirSync(dir); // Fail closed instead of overwriting evidence from an earlier run.
  const temp = path.join(dir,'tmp'); fs.mkdirSync(temp);
  const identity = gitIdentity(source);
  let sourceVerification;
  try { sourceVerification = verifySource(source,identity); } catch(e) { planEntry.status='source_verification_failure'; planEntry.error=String(e); savePlan(); throw e; }
  const manifest = sourceManifest(source.root);
  fs.writeFileSync(path.join(dir,'source-manifest.json'),JSON.stringify(manifest,null,2));
  const command = [ '--require', preload, path.join(source.root,'chart-block.e2e.js'), '--feature','chart-multi-series' ];
  const info = { name, source:source.root, ...identity, sourceVerification, runtime:runtimeMetadata(source), protectedHashesBefore:protectedHashes(source.root), mode, browser: options.browser, repetition,
    start: new Date().toISOString(), timeoutSeconds: options.timeout, command:[process.execPath,...command],
    hashes:{ sourceTree:manifest.treeSha256, test:hashFile(path.join(source.root,'chart-block.e2e.js')), lock:hashFile(path.join(source.root,'package-lock.json')), preloader:hashFile(preload), controller:hashFile(__filename) },
    tmpdir:temp, output:dir };
  fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify(info,null,2));
  const env = { ...process.env, TMPDIR:temp, TMP:temp, TEMP:temp, CHART_DIAG_MODE:mode, CHART_DIAG_OUTPUT:dir, MEMO_NEXUS_E2E_BROWSER:options.browser };
  // Disable unrelated opt-in diagnostic instrumentation, preserving the unchanged test source.
  for (const key of Object.keys(env)) if (key.startsWith('MEMO_NEXUS_E2E_') && key !== 'MEMO_NEXUS_E2E_BROWSER') delete env[key];
  delete env.NODE_OPTIONS;
  if (options.nodeModules) { env.NODE_PATH = options.nodeModules; env.CHART_DIAG_PW_MODULE = path.join(options.nodeModules,'playwright'); }
  if (options.webkitExecutable) env.CHART_DIAG_WEBKIT_EXECUTABLE = options.webkitExecutable;
  if (options.chromiumExecutable) env.CHART_DIAG_CHROMIUM_EXECUTABLE = options.chromiumExecutable;
  const out = fs.openSync(path.join(dir,'stdout.log'),'wx'); const err = fs.openSync(path.join(dir,'stderr.log'),'wx');
  let timedOut = false; let forceKill;
  console.log(`START ${name} ${info.start}`);
  const child = spawn(process.execPath,command,{cwd:source.root,env,stdio:['ignore',out,err],detached:process.platform !== 'win32'});
  function kill(signal) { try { if (process.platform !== 'win32') process.kill(-child.pid,signal); else child.kill(signal); } catch (_) {} }
  const timer = setTimeout(()=>{ timedOut=true; kill('SIGTERM'); forceKill=setTimeout(()=>kill('SIGKILL'),2000); },options.timeout*1000);
  const outcome = await new Promise(resolve=> {
    child.once('error',error=>resolve({spawnError:String(error)}));
    child.once('exit',(code,signal)=>resolve({exitCode:code,signal}));
  });
  clearTimeout(timer);
  // Terminate any descendants left by a timeout even if the main process exited first.
  if (timedOut) { kill('SIGKILL'); clearTimeout(forceKill); }
  fs.closeSync(out); fs.closeSync(err);
  let browserInfo; try { browserInfo=JSON.parse(fs.readFileSync(path.join(dir,'browser.json'),'utf8')); } catch (_) {}
  Object.assign(info,outcome,{end:new Date().toISOString(),browserMetadata:browserInfo || null,
    status:timedOut?'controller_timeout':outcome.spawnError || browserInfo?.launch !== 'succeeded'?'startup_failure':outcome.exitCode === 0?'passed':'test_failure',
    hashesAfter:{test:hashFile(path.join(source.root,'chart-block.e2e.js')),lock:hashFile(path.join(source.root,'package-lock.json'))} });
  info.protectedHashesAfter = protectedHashes(source.root);
  info.protectedFilesUnchanged = JSON.stringify(info.protectedHashesBefore) === JSON.stringify(info.protectedHashesAfter);
  info.testAndLockUnchanged = info.hashes.test === info.hashesAfter.test && info.hashes.lock === info.hashesAfter.lock;
  fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify(info,null,2));
  Object.assign(planEntry,{status:info.status,end:info.end}); savePlan();
  results.push(info); fs.writeFileSync(path.join(options.output,'summary.json'),JSON.stringify(results,null,2));
  console.log(`END ${name} ${info.status} ${info.end}`);
}
(async()=>{ for(let r=1;r<=options.repeats;r++) for(const source of options.sources) for(const mode of options.modes) await run(source,mode,r); if (results.some(r => r.status !== 'passed' || !r.protectedFilesUnchanged)) process.exitCode=1; })()
  .catch(e=>{console.error(e);process.exitCode=1;});
