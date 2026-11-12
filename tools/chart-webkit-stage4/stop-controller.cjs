'use strict';
// Synchronous cleanup only. completed means the call returned, not success.
function createStopController({state,cleanup,schedule=setImmediate}){
  let requested=false,started=false,completed=false,finalized=false,running=false,pending=null;
  function flush(){if(running||!pending||finalized)return;const fn=pending;pending=null;finalized=true;try{fn();}catch(_){state.fail('finalize_failed');}}
  function run(){
    if(!requested||started)return;
    started=true;running=true;
    try{const value=cleanup();if(value&&typeof value.then==='function'){Promise.resolve(value).catch(()=>{});state.fail('cleanup_async_unsupported');}}
    catch(_){state.fail('cleanup_failed');}
    finally{running=false;completed=true;flush();}
  }
  return {
    request(reason){state.fail(reason);if(requested)return;requested=true;try{schedule(run);}catch(_){state.fail('cleanup_schedule_failed');run();}},
    finalize(fn){if(finalized||pending)return false;pending=fn;run();flush();return true;},
    snapshot(){return {requested,started,completed,finalized,cleanupSuccess:'UNKNOWN'};}
  };
}
module.exports={createStopController};
