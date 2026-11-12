'use strict';
// This state machine only governs the IPC handshake; it does not prove storage.
function createPreflush({state,send,stop,proceed,now=()=>performance.now(),deadlineMs=5000,absoluteDeadline=Infinity}){
  let phase='idle',deadline=0,sendDone=false,response=null,callbackSeen=false,sendReturned=false,stopRequested=false;
  function requestStop(){phase='failed';if(!stopRequested){stopRequested=true;stop();}}
  function fail(reason){state.fail(reason);requestStop();}
  function advance(){
    if(phase!=='waiting'||!sendReturned||!sendDone||!response)return;
    if(now()>=deadline){fail('preflush_timeout');return;}
    if(state.result().failures.length){requestStop();return;}
    phase='complete';proceed();
  }
  return {
    request(id){
      if(phase!=='idle'){fail('ipc_duplicate');return;}
      if(state.result().failures.length){fail('preflush_precondition_failed');return;}
      phase='waiting';deadline=Math.min(now()+deadlineMs,absoluteDeadline);state.preflushRequested(id);
      try{send({type:'stage4-preflush',requestId:id},err=>{if(callbackSeen){fail('ipc_callback_duplicate');return;}callbackSeen=true;if(err){fail('ipc_error');return;}sendDone=true;advance();});sendReturned=true;advance();}catch(_){fail('ipc_error');}
    },
    receive(message){
      if(phase!=='waiting'||response){fail('ipc_duplicate_or_late');return;}
      if(now()>=deadline){fail('preflush_timeout');return;}
      state.preflushResult(message);
      if(state.result().failures.length){requestStop();return;}
      response=message;advance();
    },
    timeout(){if(phase==='waiting')fail('preflush_timeout');}
  };
}
module.exports={createPreflush};
