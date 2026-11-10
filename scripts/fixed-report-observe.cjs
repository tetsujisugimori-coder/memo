'use strict';
// Optional evidence only. No writer/timer/expected value replacement.
const fs=require('node:fs'),path=require('node:path');
const pw=require('playwright');
const out=path.resolve(process.env.REPORT_FIXED_OUT||'e2e-artifacts/report-fixed/webkit');fs.mkdirSync(out,{recursive:true});
let serial=0;
const event=(type,data={})=>fs.appendFileSync(path.join(out,'lifecycle.jsonl'),JSON.stringify({at:new Date().toISOString(),type,...data})+'\n');
for(const name of ['chromium','webkit']){
 const engine=pw[name],launch=engine.launch.bind(engine);
 engine.launch=async(...args)=>{event('browser-launch-start',{engine:name});try{const browser=await launch(...args);event('browser-launch-end',{engine:name,version:browser.version()});return browser;}catch(e){event('browser-launch-failed',{engine:name,error:e.message});throw e;}};
 const persistent=engine.launchPersistentContext.bind(engine);
 engine.launchPersistentContext=async(...args)=>{
  const id=++serial;event('context-start',{engine:name,id});
  let context;try{context=await persistent(...args);}catch(e){event('context-failed',{engine:name,id,error:e.message});throw e;}event('context-ready',{engine:name,id});
  try{await context.tracing.start({screenshots:true,snapshots:true,sources:true});}catch(error){event('trace-start-failed',{id,error:error.message});try{await context.close();}catch(closeError){event('context-close-failed',{id,error:closeError.message});}throw error;}
  const close=context.close.bind(context);let closed=false;
  context.close=async()=>{if(closed)return;closed=true;try{await context.tracing.stop({path:path.join(out,`context-${id}.zip`)});}finally{event('context-close',{id});await close();}};
  return context;
 };
}
