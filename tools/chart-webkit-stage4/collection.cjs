'use strict';
const {performance}=require('node:perf_hooks');
// Absolute deadlines are checked on event entry as well as timers.
function createCollection({state,stopping,write,deadlineMs=2000,now=()=>performance.now(),deadline=now()+deadlineMs,observationDeadline=Infinity,onFinish=()=>{},onRecordFailure=()=>{},details=()=>({})}){
  const pending=new Set(['child_exit','child_close','stdout_close','stderr_close']);
  let timer=null,waiting=false,recorded=false,recordFailed=false,sequence=0,writing=false,finishing=false;
  const queued=new Set();
  state.onFailure(reason=>{if(recorded&&!recordFailed&&now()<observationDeadline){queued.add(reason);drain();}});
  function drain(){if(writing||recordFailed)return;while(queued.size&&!recordFailed){const reasons=[...queued];queued.clear();record('controller-amendment',{reasons});}}
  function record(type,extra={}){
    if(recordFailed)return false;
    writing=true;
    try{write({type,sequence:++sequence,...extra,assessment:state.result()});}
    catch(_){recordFailed=true;queued.clear();const reason=type==='controller-finish'?'initial_write_failed':'amendment_write_failed';state.fail('result_write_failed');state.fail(reason);onRecordFailure(reason);return false;}
    finally{writing=false;}
    drain();return true;
  }
  function finish(timeout){
    if(recorded||finishing)return;finishing=true;
    if(timeout&&pending.size)state.fail('collection_timeout');
    clearTimeout(timer);
    stopping.finalize(()=>{
      let extra={};try{extra=details();}catch(_){state.fail('finalize_context_failed');}
      if(now()>=deadline&&pending.size)state.fail('collection_timeout');
      recorded=true;
      record('controller-finish',{...extra,pending:[...pending],collection:pending.size?'UNKNOWN':'COMPLETE',deadline,observationDeadline:Number.isFinite(observationDeadline)?observationDeadline:null,afterObservation:'UNKNOWN'});
      onFinish();
    });
  }
  function check(){if(waiting){if(now()>=deadline)finish(true);else if(!pending.size)finish(false);}}
  return {
    expect(name){if(recorded||now()>=deadline){state.fail('late_expectation');return;}pending.add(name);},
    observed(name){
      if(now()>=observationDeadline){state.fail('after_observation_event');return false;}
      if(now()>=deadline){if(pending.size)state.fail('collection_timeout');state.fail('late_observation');check();return false;}
      if(recorded){state.fail('late_observation');return false;}pending.delete(name);check();return true;
    },
    fail(reason){stopping.request(reason);},
    start(){if(waiting)return;waiting=true;timer=setTimeout(()=>finish(true),Math.max(0,deadline-now()));check();},
    expire(){waiting=true;finish(true);},
    snapshot(){return {pending:[...pending],waiting,recorded,recordFailed,observation:now()<observationDeadline?'OPEN':'CLOSED',afterObservation:'UNKNOWN'};},
    aggregate(records){const failures=new Set();for(const row of records)for(const f of row.assessment.failures)failures.add(f);return {failures:[...failures],procedure:failures.size?'FAIL':records.length?records.at(-1).assessment.procedure:'UNKNOWN'};}
  };
}
module.exports={createCollection};
