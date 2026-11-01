"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),z=require("node:zlib"),crypto=require("node:crypto");
const {buildG}=require("./source.cjs"),{derive}=require("./derive-delay.cjs"),{fixedDelay,observedTerminal}=require("./delay.cjs"),{validateHistory}=require("./history-guard.cjs"),{analyze}=require("./analyze.cjs");
const root=path.resolve(__dirname,"../.."),read=p=>fs.readFileSync(path.join(root,p),"utf8"),base="experiments/mcp-search-worker-feasibility/",prior="experiments/idb-upgrade-lifecycle/";
test("preregistered twelve samples and fixed 1ms reproduce from authenticated saved raw bytes",()=>{
  assert.deepEqual(derive(),require("./delay-decision.json"));assert.deepEqual(derive().rows.map(r=>r.deltaMs),[1,0,1,0,1,1,1,0,1,1,1,1]);assert.equal(derive().medianMs,1);
});
test("G restores byte-identical D; no transaction await or close added; handlers and catch retained",()=>{
  const original=read(base+"worker.js"),g=buildG(read(base+"suite.js"),original,read(prior+"observer.js"));new vm.Script(g.worker);new vm.Script(g.suite);
  assert.equal(g.suite,g.baselineSuite);let restored=g.worker.slice(g.prefix.length);
  for(const c of [...g.changes].reverse()){assert.equal(restored.split(c.after).length,2);restored=restored.replace(c.after,c.before);assert.ok(!c.after.includes("await transactionDone"));assert.ok(!c.after.includes("db.close()"));}
  assert.equal(restored,g.baselineWorker);assert.equal(g.changes.length,3);
  assert.equal((g.worker.match(/await transactionDone/g)||[]).length,(g.baselineWorker.match(/await transactionDone/g)||[]).length);
  assert.ok(g.worker.includes(original.match(/  db.onversionchange = .*;/)[0]));assert.ok(g.worker.endsWith(original.slice(original.lastIndexOf("  } catch (error)"))));
  assert.ok(g.worker.includes('if (testId === "T7") await fixedDelay(1, __workerLife); send("unresolved")'));
  for(const [file,s] of [["suite",g.baselineSuite],["worker",g.baselineWorker]])assert.equal(s.replaceAll("\r\n","\n"),z.gunzipSync(fs.readFileSync(path.join(root,prior,`evidence/generated-D-${file}.js.gz`))).toString());
});
test("timer duration is fixed and independent of complete/abort/error/UNKNOWN",async()=>{
  for(const terminal of ["complete","abort","error","UNKNOWN"]){
    const calls=[],logs=[];let resolveTimer;
    const scope={setTimeout:(fn,ms)=>{calls.push(ms);resolveTimer=fn;},life:{state:{transactions:[{terminal}]},log:(e,d)=>logs.push({e,...d})}};
    vm.runInNewContext(`globalThis.result=(${fixedDelay.toString()})(1,life)`,scope);
    assert.deepEqual(calls,[1]);assert.equal(logs.length,1);resolveTimer();await scope.result;assert.equal(logs.length,2);assert.equal(logs[1].e,"delay_end");
  }
  assert.ok(!fixedDelay.toString().includes("transactionDone"));assert.ok(!fixedDelay.toString().includes("terminal"));
});
test("observation never maps abort/error/unknown to complete",()=>{
  for(const terminal of ["complete","abort","UNKNOWN",undefined])assert.equal(observedTerminal({transactionId:"t",terminal},new Set()),terminal==="complete"||terminal==="abort"?terminal:"UNKNOWN");
  assert.equal(observedTerminal({transactionId:"t",terminal:"complete"},new Set(["t"])),"error");
});
function sample(terminal="complete"){
  const events=[];
  for(let i=1;i<=12;i++){
    const worker=`worker-${i}`;const add=(event,source,extra={})=>events.push({event,source,owner:source,iteration:i,clockDomain:`r/${source}`,sourceSeq:events.length+1,receiveSeq:events.length+1,sourceMs:events.length,dbName:"dummy",...extra});
    add("getAll_success",worker);add("delay_start",worker,{requestedDelayMs:1});
    if(terminal==="complete")add("transaction_complete",worker);
    add("delay_end",worker,{requestedDelayMs:1,outcome:"timer_returned"});add("unresolved_send",worker,{observedTerminal:terminal});
    add("worker_message_received","main",{owner:worker,workerEvent:"unresolved"});for(const name of ["worker_stop_requested","worker_terminate_called","worker_terminate_returned"])add(name,"main");
    add("open_start","main",{requestId:`r${i}`,requestedVersion:i+1});add("open_success","main",{requestId:`r${i}`});
  }
  return {runId:"r",value:{events,value:{cleanup:{status:"PASS"}}},precleanupSaved:true,contextClose:"RETURNED",browserClose:"RETURNED",pageErrors:[]};
}
test("condition independent of complete; causal categories preserve unknown; anomalies and incomplete runs never pass",()=>{
  assert.equal(analyze(sample()).execution,"PASS");assert.ok(analyze(sample()).rows.every(r=>r.category==="A"));
  const unknown=analyze(sample("UNKNOWN"));assert.equal(unknown.condition,"PASS");assert.equal(unknown.causalComparison,"UNKNOWN");assert.ok(unknown.rows.every(r=>r.sendTerminal==="UNKNOWN"&&r.actualStopTerminal==="UNKNOWN"&&r.category==="E"));
  for(const terminal of ["abort","error"])assert.equal(analyze(sample(terminal)).execution,"FAIL");
  const late=sample("UNKNOWN");late.value.events.push({event:"transaction_complete",source:"worker-1",owner:"worker-1",iteration:1,receiveSeq:1000});assert.equal(analyze(late).rows[0].category,"E");
  for(const mode of ["abort","error","timeout","incomplete","cleanup","page"]){const t=sample();
    if(["abort","error"].includes(mode))t.value.events.push({event:`transaction_${mode}`,source:"worker-1",owner:"worker-1",iteration:1});
    if(mode==="timeout")t.value.events.find(e=>e.event==="open_success").event="upgrade_timeout";
    if(mode==="incomplete")t.value.events=t.value.events.filter(e=>e.iteration<12);
    if(mode==="cleanup")t.value.value.cleanup.status="UNKNOWN";
    if(mode==="page")t.pageErrors.push("error");assert.equal(analyze(t).execution,"FAIL",mode);
  }
});
test("GitHub global guard rejects fresh additional runs, reruns, and mismatched identity",()=>{
  const run={id:1,head_sha:"sha",run_attempt:1,head_branch:"investigate/idb-time-delay-only"};validateHistory({total_count:1,workflow_runs:[run]},1,"sha");
  for(const x of [{total_count:2,workflow_runs:[run,run]},{total_count:1,workflow_runs:[{...run,run_attempt:2}]},{total_count:1,workflow_runs:[{...run,id:2}]}])assert.throws(()=>validateHistory(x,1,"sha"));
});
test("original source hashes retained; one guarded runner; persistence precedes original cleanup",()=>{
  const index=JSON.parse(read(prior+"evidence/index.json"));for(const [file,x] of Object.entries(index.sourceChecks))assert.equal(crypto.createHash("sha256").update(read(file).replaceAll("\r\n","\n")).digest("hex"),x.sha256);
  const r=read("experiments/idb-time-delay-only/run.cjs"),w=read(".github/workflows/idb-time-delay-only.yml");new vm.Script(r);
  assert.equal((r.match(/webkit\.launch\(/g)||[]).length,1);assert.ok(r.indexOf("await reserveHistory()")<r.indexOf("webkit.launch("));assert.ok(r.includes('trial.browserVersion !== "26.5"'));
  assert.ok(r.includes('if (report.outcome !== "PASS") process.exitCode = 1'));assert.ok(!w.includes("continue-on-error"));assert.ok(!w.includes("workflow_dispatch"));assert.ok(w.includes("cancel-in-progress: false"));
  assert.ok(!/require\([^\n]+idb-(transaction-complete-only|upgrade-lifecycle)\/run/.test(r));
  const g=buildG(read(base+"suite.js"),read(base+"worker.js"),read(prior+"observer.js"));assert.ok(g.suite.indexOf("await window.__saveBeforeCleanup(")<g.suite.indexOf("const cleanup = await window.WorkerPocCleanup.deleteDatabaseObserved"));
  assert.equal((g.suite.match(/WorkerPocCleanup\.deleteDatabaseObserved/g)||[]).length,1);
});
