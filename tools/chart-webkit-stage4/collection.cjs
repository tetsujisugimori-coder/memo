'use strict';
// Pure coordination: no processes, signals, WebKit, or filesystem on import.
function createCollection({state,stopping,write,deadlineMs=2000,onFinish=()=>{},onRecordFailure=()=>{},details=()=>({})}){
  const pending=new Set(['child_exit','child_close','stdout_close','stderr_close']);
  let timer=null,waiting=false,recorded=false,recordFailed=false,sequence=0;
  const originalFail=state.fail;let writing=false;
  state.fail=reason=>{const had=state.result().failures.includes(reason);originalFail(reason);if(recorded&&!had&&!writing)record('controller-amendment',{reason});};
  function record(type,extra={}){
    writing=true;try{write({type,sequence:++sequence,...extra,assessment:state.result()});return true;}
    catch(_){recordFailed=true;originalFail('result_write_failed');onRecordFailure();return false;}finally{writing=false;}
  }
  function finish(timeout){
    if(recorded)return;
    if(timeout&&pending.size)state.fail('collection_timeout');
    clearTimeout(timer);
    stopping.finalize(()=>{let extra={};try{extra=details();}catch(_){state.fail('finalize_context_failed');}recorded=true;record('controller-finish',{...extra,pending:[...pending],collection:pending.size?'UNKNOWN':'COMPLETE'});onFinish();});
  }
  function check(){if(waiting&&!pending.size)finish(false);}
  return {
    expect(name){if(recorded){state.fail('late_expectation');return;}pending.add(name);},
    observed(name){pending.delete(name);check();},
    fail(reason){stopping.request(reason);},
    start(){if(waiting)return;waiting=true;timer=setTimeout(()=>finish(true),deadlineMs);check();},
    snapshot(){return {pending:[...pending],waiting,recorded,recordFailed};},
    aggregate(records){const failures=new Set();for(const row of records)for(const f of row.assessment.failures)failures.add(f);return {failures:[...failures],procedure:failures.size?'FAIL':records.length?records.at(-1).assessment.procedure:'UNKNOWN'};}
  };
}
module.exports={createCollection};
