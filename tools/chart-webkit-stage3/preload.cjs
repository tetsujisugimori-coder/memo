'use strict';
// Only the two Chart suite child scripts are instrumented; A uses no preloader.
const path=require('node:path');const entry=path.basename(process.argv[1]||'');
if(['chart-block.e2e.js','chart-file-export.e2e.js'].includes(entry)){
  const fs=require('node:fs'),crypto=require('node:crypto'),{createRequire}=require('node:module');
  const {createLedger,bounded}=require('./ledger.cjs'),{attachBrowser}=require('./recorder.cjs');
  const mode=process.env.CHART_STAGE3_MODE;if(mode!=='detailed')throw Error('stage3 preloader requires detailed mode');
  const root=process.env.CHART_STAGE3_OUTPUT;if(!root)throw Error('CHART_STAGE3_OUTPUT required');
  const output=path.join(root,`process-${process.pid}-${crypto.randomBytes(8).toString('hex')}`);fs.mkdirSync(output);
  const ledger=createLedger(path.join(output,'events.jsonl')),recorders=[];let finishStarted=false,finishResult=null;
  const emit=record=>ledger.append({utc:new Date().toISOString(),pid:process.pid,...record});
  void emit({type:'process-start',entry,platform:process.platform,mode});
  const pw=createRequire(path.join(process.cwd(),'package.json'))('playwright');
  for(const name of ['webkit','chromium']){const type=pw[name],launch=type.launch;type.launch=async function(...args){void emit({type:'browser-launch-start',name,options:args[0]||{}});try{const browser=await Reflect.apply(launch,this,args);recorders.push(attachBrowser(browser,ledger,{mode,boundaryMs:500}));void emit({type:'browser-launch-complete',name,version:browser.version()});return browser;}catch(e){void emit({type:'browser-launch-error',name,error:String(e)});throw e;}};}
  async function finish(reason){
    if(finishStarted)return;finishStarted=true;void emit({type:'process-flush-request',reason});
    const livePages=recorders.map(r=>r.livePageCount());
    const pages=await bounded(Promise.all(recorders.map(r=>r.flushAll(`process.${reason}`))).then(groups=>({ok:groups.flat().every(x=>x?.ok===true)&&(reason!=='SIGTERM'||livePages.some(n=>n>0)),livePages,results:groups.flat()})),1500);
    const close=await ledger.close(1500);finishResult={reason,pages,close,state:{...ledger.state},unconfirmedTail:'UNKNOWN',storageDurability:'NOT_CONFIRMED'};
  }
  process.once('beforeExit',()=>{void finish('normal');});
  if(process.platform!=='win32')process.once('SIGTERM',()=>{void finish('SIGTERM').finally(()=>process.exit(143));});
  process.on('exit',code=>{try{fs.writeFileSync(path.join(output,'exit.json'),JSON.stringify({utc:new Date().toISOString(),code,platform:process.platform,finishResult,ledger:{...ledger.state},unconfirmedTail:'UNKNOWN'},null,2)+'\n',{flag:'wx'});}catch(_){} });
}
