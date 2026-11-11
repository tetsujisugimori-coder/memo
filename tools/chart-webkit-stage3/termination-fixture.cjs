'use strict';
// Synthetic child only: parent supplies commands and never targets a product process.
const {createLedger}=require('./ledger.cjs');
const ledger=createLedger(process.argv[2]);let last=0;
async function finish(reason){const flush=await ledger.close(500),code=reason==='sigterm'?143:0;if(process.send){process.send({type:'final',reason,lastObserved:last,flush},()=>process.exit(code));setTimeout(()=>process.exit(code),500).unref();}else process.exit(code);}
if(process.platform!=='win32')process.on('SIGTERM',()=>void finish('sigterm'));
process.on('message',async msg=>{
  if(msg==='event'){last++;process.send?.({type:'observed',seq:last});const ok=await ledger.append({documentId:'synthetic-child',seq:last});process.send?.({type:'write-callback',seq:last,ok});}
  else if(msg==='unwritten'){last++;process.send?.({type:'unwritten-observed',seq:last});}
  else if(msg==='normal')await finish('normal');
  else if(msg==='hold')process.send?.({type:'holding',lastObserved:last});
});
process.send?.({type:'ready'});
