'use strict';
// Linux runner: one ordered, bounded set of four full-suite trials.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const {spawn, execFileSync} = require('node:child_process');
const {performance} = require('node:perf_hooks');
const {terminate} = require('./process-tree.cjs');
const classify = require('./classify.cjs');
if (process.platform !== 'linux') throw new Error('Linux process-group termination required');
const [main, pr, mainLight, prLight, output, modules] = process.argv.slice(2).map(x=>x && path.resolve(x));
if (!main || !pr || !mainLight || !prLight || !output || !modules) throw new Error('usage: node run.cjs main pr mainLight prLight output node_modules');
fs.mkdirSync(output); // Refuse to overwrite earlier results.
const preload = path.join(__dirname,'preload.cjs');
const limits = {smokeSeconds:120,suiteSeconds:900,overallSeconds:4800,outputBytes:1024*1024*1024};
const plan = [
  {name:'main-none',root:main,revision:'08572bb0f888c5e8b6f57f3c1aefe98fbf5d2e4d',mode:'none'},
  {name:'pr-none',root:pr,revision:'a581cb66cb0dc4889ff8ce3434c1edad88546431',mode:'none'},
  {name:'main-light',root:mainLight,revision:'08572bb0f888c5e8b6f57f3c1aefe98fbf5d2e4d',mode:'light'},
  {name:'pr-light',root:prLight,revision:'a581cb66cb0dc4889ff8ce3434c1edad88546431',mode:'light'}
];
const hash = b=>crypto.createHash('sha256').update(b).digest('hex');
const json = (file,obj)=>fs.writeFileSync(file,JSON.stringify(obj,null,2)+'\n');
function git(root,...args) { return execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:64*1024*1024}).trim(); }
function verify(root,rev) {
  const head=git(root,'rev-parse','HEAD'); if(head!==rev) throw Error(`HEAD mismatch ${root}: ${head}`);
  const status=git(root,'status','--porcelain=v1','--untracked-files=all');
  if(status) throw Error(`Source checkout not clean: ${root}\n${status}`);
  return {commit:head,tree:git(root,'rev-parse','HEAD^{tree}'),trackedStatus:status};
}
function size(dir) { let total=0; for(const e of fs.readdirSync(dir,{withFileTypes:true})) {const p=path.join(dir,e.name); if(e.isDirectory()) total+=size(p); else if(e.isFile()) total+=fs.statSync(p).size;} return total; }
const started=performance.now();
const baseEnv={...process.env, NODE_PATH:modules, MEMO_NEXUS_E2E_BROWSER:'webkit'};
for (const k of Object.keys(baseEnv)) if (k.startsWith('MEMO_NEXUS_E2E_') && k!=='MEMO_NEXUS_E2E_BROWSER') delete baseEnv[k];
delete baseEnv.NODE_OPTIONS;
const meta = {createdUtc:new Date().toISOString(),limits,plan:plan.map(({name,revision,mode})=>({name,revision,mode})),node:process.version,platform:process.platform,arch:process.arch,osRelease:os.release(),osReleaseFile:fs.readFileSync('/etc/os-release','utf8'),runner:{os:process.env.RUNNER_OS || 'UNKNOWN',imageOS:process.env.ImageOS || 'UNKNOWN',imageVersion:process.env.ImageVersion || 'UNKNOWN',runId:process.env.GITHUB_RUN_ID || 'UNKNOWN'},playwright:require(path.join(modules,'playwright','package.json')).version,browserManifest:JSON.parse(fs.readFileSync(path.join(modules,'playwright-core','browsers.json'),'utf8')),envAllowlist:{MEMO_NEXUS_E2E_BROWSER:'webkit',NODE_PATH:'configured dependency directory'},nodeOptions:'unset for A; require diagnostic preloader for B',preloadSha256:hash(fs.readFileSync(preload)),controllerSha256:hash(fs.readFileSync(__filename)),results:[]};
json(path.join(output,'plan.json'),meta);
function command(dir, name, args, env, seconds) {
  return new Promise(resolve=>{
    const begin=new Date().toISOString(), start=performance.now();
    const out=fs.openSync(path.join(dir,`${name}.stdout.log`),'wx'), err=fs.openSync(path.join(dir,`${name}.stderr.log`),'wx');
    const child=spawn(args[0],args.slice(1),{cwd:env.root,env:env.vars,stdio:['ignore',out,err],detached:true});
    let reason=null, finished=false, termination=null;
    function stop(why) {if (!reason) {reason=why;termination=terminate(child.pid);}}
    const timer=setTimeout(()=>stop('outer_timeout'),seconds*1000);
    const guard=setInterval(()=>{ if (!reason && (performance.now()-started>limits.overallSeconds*1000 || size(output)>limits.outputBytes)) stop('budget_stop'); },5000);
    async function end(outcome) {if(finished)return;finished=true;clearTimeout(timer);clearInterval(guard);const terminationResult=termination ? await termination : null;fs.closeSync(out);fs.closeSync(err);resolve({begin,end:new Date().toISOString(),durationMs:performance.now()-start,command:args,reason,termination:terminationResult,...outcome});}
    child.on('error',e=>end({spawnError:String(e)})); child.on('close',(code,signal)=>end({code,signal}));
  });
}
async function run() {
  for (const t of plan) {
    if (performance.now()-started > limits.overallSeconds*1000 || size(output)>limits.outputBytes) {meta.stopped='budget';break;}
    const dir=path.join(output,t.name);fs.mkdirSync(dir);
    let before;try {before=verify(t.root,t.revision);} catch(e) {meta.stopped=String(e);break;}
    const env={...baseEnv,TMPDIR:path.join(dir,'tmp')};fs.mkdirSync(env.TMPDIR);
    const result={name:t.name,mode:t.mode,before,smoke:null,suite:null,status:'started'};meta.results.push(result);json(path.join(output,'plan.json'),meta);
    result.smoke=await command(dir,'smoke',[process.execPath,'chart-actionability-phase-smoke.e2e.js'],{root:t.root,vars:env},limits.smokeSeconds);
    if(result.smoke.code!==0 || result.smoke.reason || result.smoke.spawnError) {result.status='smoke_failure_or_timeout';meta.stopped='smoke';json(path.join(dir,'result.json'),result);break;}
    const suiteEnv={...env}; if(t.mode!=='none') {suiteEnv.NODE_OPTIONS=`--require=${preload}`;suiteEnv.CHART_STAGE2_MODE=t.mode;suiteEnv.CHART_STAGE2_OUTPUT=dir;}
    result.suite=await command(dir,'suite',['npm','run','test:e2e:chart:all'],{root:t.root,vars:suiteEnv},limits.suiteSeconds);
    result.status=classify(result.suite);
    result.trackedStatusAfter=git(t.root,'status','--porcelain=v1','--untracked-files=no');
    result.sourceStatusAfter=git(t.root,'status','--porcelain=v1','--untracked-files=no','--','.',':(exclude)e2e-artifacts/**');
    if(result.sourceStatusAfter) {result.sourceChanged=true;meta.stopped='source_changed';}
    result.exportStarted=fs.readFileSync(path.join(dir,'suite.stdout.log'),'utf8').includes('[START] Chart E2E script chart-file-export.e2e.js');
    result.evidenceTail=t.mode==='none'?'NOT_APPLICABLE':'UNKNOWN after last accepted batch';
    json(path.join(dir,'result.json'),result);json(path.join(output,'plan.json'),meta);
    if(meta.stopped || result.status!=='passed') {meta.stopped=meta.stopped || 'trial_not_passed';break;}
  }
  meta.endUtc=new Date().toISOString();meta.outputBytes=size(output);json(path.join(output,'plan.json'),meta);
  if(meta.results.length!==4 || meta.stopped || meta.results.some(x=>x.status!=='passed')) process.exitCode=1;
}
run().catch(e=>{meta.fatal=String(e.stack||e);json(path.join(output,'plan.json'),meta);process.exitCode=1;});
