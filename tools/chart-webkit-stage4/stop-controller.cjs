'use strict';
// Coordinates requests, not process identity or durable evidence.
function createStopController({state,cleanup,schedule=setImmediate}){
  let requested=false,started=false,completed=false,finalized=false;
  function run(){
    if(!requested||started)return;
    started=true;
    try{cleanup();}catch(_){state.fail('cleanup_failed');}
    finally{completed=true;}
  }
  return {
    request(reason){
      state.fail(reason);
      if(requested)return;
      requested=true;
      try{schedule(run);}catch(_){state.fail('cleanup_schedule_failed');run();}
    },
    finalize(fn){
      if(finalized)return false;
      finalized=true;run();
      try{fn();}catch(_){state.fail('finalize_failed');}
      return true;
    },
    snapshot(){return {requested,started,completed,finalized,cleanupSuccess:'UNKNOWN'};}
  };
}
module.exports={createStopController};
