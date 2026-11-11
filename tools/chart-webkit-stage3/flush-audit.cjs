'use strict';
function key(record){return `${record.processId||'UNKNOWN'}:${record.pageId||'UNKNOWN'}:${record.requestId}`;}
function auditFlushes(records){
  const requests=new Map(),results=new Map();let late=0;
  for(const r of records){if(r.type==='flush-request')requests.set(key(r),(requests.get(key(r))||0)+1);else if(r.type==='flush-result'){const k=key(r),v=results.get(k)||[];v.push(r.result);results.set(k,v);}else if(r.type==='late-write-callback')late++;}
  let missing=0,unmatched=0,duplicates=0,failed=0;
  for(const [k,count] of requests){const v=results.get(k)||[];if(!v.length)missing++;if(count>1||v.length>1)duplicates++;if(v.some(x=>x!=='callback_completed'))failed++;}
  for(const k of results.keys())if(!requests.has(k))unmatched++;
  return {requests:requests.size,results:results.size,missing,unmatched,duplicates,failed,late};
}
module.exports={auditFlushes,key};
