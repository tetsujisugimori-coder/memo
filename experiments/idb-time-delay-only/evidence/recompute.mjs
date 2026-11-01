// Offline only. From repository root: node experiments/idb-time-delay-only/evidence/recompute.mjs [new-output-directory]
import { createRequire } from "node:module";
const require=createRequire(import.meta.url),fs=require("node:fs"),path=require("node:path"),z=require("node:zlib"),assert=require("node:assert/strict");
const root=process.cwd(),out=path.resolve(process.argv[2]||"e2e-artifacts/g-recomputed");
const read=p=>JSON.parse(z.gunzipSync(fs.readFileSync(path.resolve(root,p))).toString().replace(/^\uFEFF/,""));
const gr=read("experiments/idb-time-delay-only/evidence/results.json.gz"),fr=read("experiments/idb-transaction-complete-only/evidence/results.json.gz"),dr=read("experiments/idb-upgrade-lifecycle/evidence/results.json.gz");
const {analyze}=require("../analyze.cjs"),{derive}=require("../derive-delay.cjs");
assert.deepEqual(JSON.parse(JSON.stringify(analyze(gr.trials[0]))),gr.analysis);
assert.deepEqual(derive(),JSON.parse(fs.readFileSync(path.join(root,"experiments/idb-time-delay-only/delay-decision.json"))));
fs.mkdirSync(out,{recursive:true});
const save=(n,v)=>fs.writeFileSync(path.join(out,n),typeof v==="string"?v:JSON.stringify(v,null,2)+"\n",{flag:"wx"});
const point=e=>e?{event:e.event,source:e.source,sourceSeq:e.sourceSeq,sourceMs:e.sourceMs,receivedMainMs:e.receivedMainMs,receiveSeq:e.receiveSeq,clockDomain:e.clockDomain,workerMs:e.workerMs,requestId:e.requestId,connectionId:e.connectionId,transactionId:e.transactionId}:"NOT_OBSERVED";
const trials=[[dr,dr.trials.find(t=>t.condition==="D"),41299732744],[fr,fr.trials[0],41303212794],[gr,gr.trials[0],41316288566]].map(([r,t,ci])=>{
 const events=t.value?.events||t.partial?.events||[],meta={condition:t.condition,runId:t.runId,dbName:t.dbName||events.find(e=>e.dbName!=="UNKNOWN")?.dbName||"UNKNOWN",commit:r.testedCommit,tree:r.tree,dirty:r.dirty,browser:t.browserVersion,node:r.node,ci,recordedAtJST:r.recordedAtJST};
 const rows=Array.from({length:12},(_,i)=>{
  const iteration=i+1,ev=events.filter(e=>e.iteration===iteration),worker=ev.find(e=>e.source!=="main"),owner=worker?.source;
  const w=name=>ev.find(e=>e.source===owner&&e.event===name),m=name=>ev.find(e=>e.source==="main"&&e.event===name),message=phase=>ev.find(e=>e.event==="worker_message_received"&&e.owner===owner&&e.workerEvent===phase);
  const get=w("getAll_success"),send=w("unresolved_send"),complete=w("transaction_complete"),start=w(t.condition==="G"?"delay_start":"transaction_wait_start"),end=w(t.condition==="G"?"delay_end":"transaction_wait_end"),stop=m("worker_stop_requested");
  const open=ev.find(e=>e.source==="main"&&e.event==="open_start"&&e.requestedVersion===iteration+1),req=name=>ev.find(e=>e.source==="main"&&e.event===name&&e.requestId===open?.requestId);
  const success=req("open_success"),timeout=req("upgrade_timeout"),error=req("open_error"),abortError=ev.filter(e=>e.source===owner&&["transaction_abort","transaction_error"].includes(e.event));
  const getMessage=message("request_success"),sendMessage=message("unresolved");
  const elapsed=(a,b)=>a&&b&&a.clockDomain===b.clockDomain?b.sourceMs-a.sourceMs:null;
  return {iteration,workerId:owner||"NOT_RUN",logicalRequestId:worker?.logicalRequestId||"UNKNOWN",connectionId:get?.connectionId||w("connection_observed")?.connectionId||"UNKNOWN",transactionId:get?.transactionId||w("transaction_start")?.transactionId||"UNKNOWN",version:iteration,
   getAll:point(get),delayStart:point(start),delayEnd:point(end),complete:point(complete),abortError:abortError.map(point),unresolvedSend:point(send),unresolvedReceive:point(sendMessage),completeReceive:point(message("transaction_complete")),stop:point(stop),terminateCalled:point(m("worker_terminate_called")),terminateReturned:point(m("worker_terminate_returned")),
   getAllToSendMs:elapsed(get,send),waitMs:elapsed(start,end),DOriginalMessageIntervalMs:t.condition==="D"&&getMessage&&sendMessage?sendMessage.workerMs-getMessage.workerMs:null,
   sendTerminal:t.condition==="G"?send?.observedTerminal||"UNKNOWN":complete&&send&&complete.sourceSeq<send.sourceSeq?"complete":"UNKNOWN",
   sendTerminalMethod:t.condition==="G"?"Worker metadata snapshot":t.condition==="F"?"derived from earlier Worker complete and awaited promise":"NOT_OBSERVED",
   stopKnowledge:abortError.some(e=>e.receiveSeq<stop?.receiveSeq)?"abort/error":complete&&stop&&complete.receiveSeq<stop.receiveSeq?"complete":"UNKNOWN",actualStopTerminal:"UNKNOWN",
   open:point(open),upgradeneeded:point(req("open_upgradeneeded")),upgradeTransaction:ev.filter(e=>e.source==="main"&&e.requestId===open?.requestId&&e.event.startsWith("transaction_")).map(point),success:point(success),timeout:point(timeout),error:point(error),blocked:point(req("open_blocked")),versionchange:ev.filter(e=>e.event==="versionchange").map(point),
   workerClose:ev.filter(e=>e.source===owner&&["close_called","close_returned","connection_closed_abnormal_event"].includes(e.event)).map(point),upgrade:timeout||error?"FAIL":success?"PASS":open?"UNKNOWN":"NOT_RUN",upgradeElapsedMs:elapsed(open,success),normalConnectionClosed:"UNKNOWN",physicalRelease:"UNKNOWN"};
 });
 return {...meta,rows,cleanup:t.value?.value?.cleanup||{status:"UNKNOWN"},contextClose:t.contextClose,browserClose:t.browserClose,fail:t.value?.value?.failure||t.error||null,events:events.length};
});
save("D-F-G-comparison.json",{clockRule:"Subtract timestamps only within same Worker/main clock. Compare already calculated durations across trials; never subtract raw cross-domain timestamps.",trials});
const g=trials[2],f=trials[1],events=gr.trials[0].value?.events||gr.trials[0].partial?.events||[];
save("analysis.json",{...g,...gr.analysis});
save("worker-events.json",{...g,rows:undefined,events:events.filter(e=>e.source!=="main")});save("main-events.json",{...g,rows:undefined,events:events.filter(e=>e.source==="main")});
const p=e=>typeof e==="object"?`#${e.receiveSeq}`:e;
let table=`# G transaction・停止対応表\n\nrunId ${g.runId}; DB ${g.dbName}; commit ${g.commit}; tree ${g.tree}; WebKit ${g.browser}; ${g.recordedAtJST}\n\n時刻は各Worker内sourceMs、#はmain受信順。停止時の知識は受信済みの情報であり物理的状態ではない。\n\n|i|Worker / connection / tx|version|getAll ms|delay開始/終了 ms|実測delay ms|getAll→送信 ms|complete ms/seq|送信 ms/seq|送信時状態|main受信/stop seq|停止時知識|terminate呼出/戻り seq|\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
for(const x of g.rows)table+=`|${x.iteration}|${x.workerId} / ${x.connectionId} / ${x.transactionId}|${x.version}|${x.getAll.sourceMs??"UNKNOWN"}|${x.delayStart.sourceMs??"UNKNOWN"}/${x.delayEnd.sourceMs??"UNKNOWN"}|${x.waitMs??"UNKNOWN"}|${x.getAllToSendMs??"UNKNOWN"}|${x.complete.sourceMs??"UNKNOWN"}/${p(x.complete)}|${x.unresolvedSend.sourceMs??"UNKNOWN"}/${p(x.unresolvedSend)}|${x.sendTerminal}|${p(x.unresolvedReceive)}/${p(x.stop)}|${x.stopKnowledge}|${p(x.terminateCalled)}/${p(x.terminateReturned)}|\n`;
save("transactions.md",table);
table=`# G upgrade時系列\n\nrunId ${g.runId}; DB ${g.dbName}; HEAD ${g.commit}; tree ${g.tree}; WebKit ${g.browser}; ${g.recordedAtJST}\n\n|i|version|request|open seq/ms|upgradeneeded seq|transaction complete seq|success seq/ms|timeout seq|blocked seq|結果|\n|---|---|---|---|---|---|---|---|---|---|\n`;
for(const x of g.rows)table+=`|${x.iteration}|${x.version}→${x.version+1}|${x.open.requestId??"NOT_RUN"}|${p(x.open)}/${x.open.sourceMs??"UNKNOWN"}|${p(x.upgradeneeded)}|${p(x.upgradeTransaction.find(e=>e.event==="transaction_complete")||"NOT_OBSERVED")}|${p(x.success)}/${x.success.sourceMs??"UNKNOWN"}|${p(x.timeout)}|${p(x.blocked)}|${x.upgrade}|\n`;
save("upgrades.md",table);
const median=values=>{const a=values.filter(x=>typeof x==="number").sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null;};
const durations={FgetAllToSendMs:f.rows.map(x=>x.getAllToSendMs),GgetAllToSendMs:g.rows.map(x=>x.getAllToSendMs),GtimerMs:g.rows.map(x=>x.waitMs)};
save("duration-comparison.json",{...durations,FmedianMs:median(durations.FgetAllToSendMs),GmedianMs:median(durations.GgetAllToSendMs),GtimerMedianMs:median(durations.GtimerMs),differenceOfDurationMediansMs:median(durations.GgetAllToSendMs)-median(durations.FgetAllToSendMs),interpretation:"Separate-run quantized duration measurements, not identical conditions or precise sub-ms times."});
table="# D/F/G比較\n\n各列は独立試行。原始ID/時計・全反復はD-F-G-comparison.json。Dの0msは専用getAll/unresolvedイベントではなく、元の通知payload.workerMs間の参考値。\n\n|項目|D|F|G|\n|---|---|---|---|\n";
const add=(title,fn)=>{table+=`|${title}|${trials.map(fn).join("|")}|\n`;};
add("実行HEAD",t=>t.commit);add("tree",t=>t.tree);add("WebKit / Node",t=>`${t.browser} / ${t.node}`);add("runId",t=>t.runId);add("DB",t=>t.dbName);
add("待機方式",t=>t.condition==="D"?"追加待ちなし":t.condition==="F"?"transaction complete待ち":"固定1ms、completeを条件としない");
add("getAll→送信 実測ms",t=>t.condition==="D"?"専用記録なし。payload参考値0,0":t.rows.map(x=>x.getAllToSendMs??"UNKNOWN").join(","));
add("待機開始→終了 実測ms",t=>t.condition==="D"?"NOT_APPLICABLE":t.rows.map(x=>x.waitMs??"UNKNOWN").join(","));
add("Worker complete観測数",t=>t.rows.filter(x=>typeof x.complete==="object").length);add("送信時終端",t=>t.rows.filter(x=>x.workerId!=="NOT_RUN").map(x=>x.sendTerminal).join(","));add("停止時の受信済み知識",t=>t.rows.filter(x=>x.workerId!=="NOT_RUN").map(x=>x.stopKnowledge).join(","));
add("terminate呼出/戻り観測数",t=>`${t.rows.filter(x=>typeof x.terminateCalled==="object").length}/${t.rows.filter(x=>typeof x.terminateReturned==="object").length}`);
add("upgrade成功数",t=>t.rows.filter(x=>x.upgrade==="PASS").length);add("upgrade timeout",t=>t.rows.filter(x=>typeof x.timeout==="object").map(x=>`i${x.iteration}`).join(",")||"NOT_OBSERVED");add("blocked",t=>t.rows.filter(x=>typeof x.blocked==="object").length);add("versionchange",t=>t.rows.flatMap(x=>x.versionchange).length);add("cleanup",t=>`${t.cleanup.status} (${t.cleanup.elapsedMs??"UNKNOWN"}ms)`);add("Worker close記録数",t=>t.rows.flatMap(x=>x.workerClose).length);add("正常接続閉鎖/物理解放",()=>"UNKNOWN / UNKNOWN");
table+="\nDは専用送信時計なし。Fは完了待ちログ/error監視、Gは固定タイマーログ/終端snapshot/error監視を追加。Gは異常検知時に安全停止するmainガードも持つ。全条件とも正常経路のsuiteは同じ。計測/待ち/環境差があり因果の完全統制比較ではない。\n";save("comparison.md",table);
const connections=events.filter(e=>e.event==="connection_observed").map(c=>{const e=events.filter(x=>x.connectionId===c.connectionId);return {...c,lastObserved:point(e.at(-1)),closeCalled:point(e.find(x=>x.event==="close_called")),closeReturned:point(e.find(x=>x.event==="close_returned")),transactions:e.filter(x=>x.event.startsWith("transaction_")).map(point),normalClosure:"UNKNOWN",physicalRelease:"UNKNOWN"};});save("connections.json",{runId:g.runId,dbName:g.dbName,commit:g.commit,tree:g.tree,browser:g.browser,connections});
console.log(JSON.stringify({output:out,analysis:{condition:gr.analysis.condition,upgrade:gr.analysis.upgrade,execution:gr.analysis.execution,causal:gr.analysis.causalComparison,categories:gr.analysis.rows.map(r=>r.category)},durations,connections:connections.length}));
