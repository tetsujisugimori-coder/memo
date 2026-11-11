'use strict';
// This state machine only governs the IPC handshake; it does not prove storage.
function createPreflush({state,send,stop,proceed,now=()=>performance.now(),deadlineMs=5000}){
  let phase='idle',deadline=0;
  function fail(reason){state.fail(reason);phase='failed';stop();}
  return {
    request(id){
      if(phase!=='idle'){fail('ipc_duplicate');return;}
      phase='waiting';deadline=now()+deadlineMs;state.preflushRequested(id);
      try{send({type:'stage4-preflush',requestId:id},err=>{if(err)fail('ipc_error');});}catch(_){fail('ipc_error');}
    },
    receive(message){
      if(phase!=='waiting'){fail('ipc_duplicate_or_late');return;}
      if(now()>=deadline){fail('preflush_timeout');return;}
      state.preflushResult(message);
      if(state.result().failures.length){phase='failed';stop();return;}
      phase='complete';proceed();
    },
    timeout(){if(phase==='waiting')fail('preflush_timeout');}
  };
}
module.exports={createPreflush};
