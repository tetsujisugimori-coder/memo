'use strict';
const {performance}=require('node:perf_hooks');
function createDeadline(now=()=>performance.now()){
  const started=now();
  // Startup/handshake 0..17s, stop/collection 17..19s, record/observe to 19.5s.
  // Outer budget stays 20s. Synchronous stalls remain unbounded / BLOCKED.
  const stop=started+17000,collect=started+19000,observe=started+19500,outer=started+20000;
  return {started,stop,collect,observe,outer,now,remaining:end=>Math.max(0,end-now())};
}
module.exports={createDeadline};
