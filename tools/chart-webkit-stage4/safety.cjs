'use strict';
function sameIdentity(a,b){return !!(a&&b&&Number.isSafeInteger(a.pid)&&a.pid>0&&a.pid===b.pid&&typeof a.start==='string'&&a.start.length>0&&a.start===b.start);}
// A procedure result alone never establishes evidence collection or storage.
function progressGate(result){return result&&result.procedure==='PASS'&&result.evidence==='PASS'&&result.rawSaved==='PASS'&&result.durableStorage==='PASS'&&result.uncapturedDescendants==='PASS'?'PASS':'BLOCKED';}
function createState(group){
  if(!['A','B'].includes(group))throw Error('invalid group');
  const failures=new Set(),listeners=new Set();
  function fail(reason){if(failures.has(reason))return false;failures.add(reason);for(const listener of listeners)listener(reason);return true;}
  let requested=false,accepted=null,exit=null,preflush=null,preflushId=null;
  return {
    fail,
    onFailure(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
    signalRequested(){requested=true;},
    signalResult(ok){accepted=ok===true;if(!accepted)fail('signal_send_failed');},
    preflushRequested(id){if(preflushId!==null)fail('ipc_duplicate');else preflushId=id;},
    preflushResult(m){if(preflush!==null||!m||typeof m!=='object'||m.requestId!==preflushId||preflushId===null||typeof m.ok!=='boolean'){fail('ipc_invalid');return;}preflush=m.ok;if(!m.ok)fail('preflush_failed');},
    childExit(code,signal){exit={code,signal};if(!requested||!accepted)fail('child_early_exit');if(signal==='SIGKILL')fail('sigkill');if(code!==143||signal!==null)fail('child_abnormal_exit');},
    result(){return {procedure:failures.size?'FAIL':exit&&requested&&accepted&&(group!=='B'||preflush===true)?'PASS':'UNKNOWN',failures:[...failures],signalRequested:requested,signalAccepted:accepted,exit,preflush,signalReceived:'UNKNOWN',evidence:'UNKNOWN',rawSaved:'UNKNOWN',durableStorage:'UNKNOWN',uncapturedDescendants:'UNKNOWN'};}
  };
}
function assessEvidence(x={}){
  const evidence={parentInfinity:x.parentInfinity===true?'PASS':'UNKNOWN',childInput:x.childInput===true?'PASS':'UNKNOWN',signalSent:x.signalSent===true?'PASS':'UNKNOWN',signalReceived:x.signalReceived===true?'PASS':'UNKNOWN',finish:x.finish===true?'PASS':'UNKNOWN',flushStart:x.flushStart===true?'PASS':'UNKNOWN',flushEnd:x.flushEnd===true?'PASS':'UNKNOWN',evaluate:x.evaluate===true?'PASS':'UNKNOWN',callback:x.callback===true?'PASS':'UNKNOWN',boundary:x.boundary===true?'PASS':'UNKNOWN',infinityStored:x.infinityStored===true?'PASS':'UNKNOWN',lastSeq:Number.isSafeInteger(x.lastSeq)?x.lastSeq:'UNKNOWN',exit:x.exit===true?'PASS':'UNKNOWN',hashMatch:x.hashMatch===true?'PASS':'UNKNOWN',unconfirmedTail:'UNKNOWN',durableStorage:'UNKNOWN'};
  return evidence;
}
module.exports={sameIdentity,createState,assessEvidence,progressGate};
