const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert/strict');
const source=fs.readFileSync('scripts/fixed-report-observe.cjs','utf8');
(async()=>{
 let closes=0;const ctx={tracing:{start:async()=>{throw Error('trace disk failure');},stop:async()=>{throw Error('trace disk failure');}},close:async()=>{closes++;}};
 const engine={launch:async()=>({version:()=>''}),launchPersistentContext:async()=>ctx},pw={chromium:{...engine},webkit:{...engine}};
 vm.runInNewContext(source,{require:n=>n==='playwright'?pw:require(n),process:{env:{REPORT_FIXED_OUT:path.resolve('e2e-artifacts/track-a-observer-controls')}}});
 let rejected=false;try{await pw.webkit.launchPersistentContext();}catch(e){rejected=e.message==='trace disk failure';}
 console.log(JSON.stringify({rejected,actualContextCloseCalls:closes}));assert.equal(rejected,true);assert.equal(closes,1,'trace save failure must not prevent actual context cleanup');
})();
