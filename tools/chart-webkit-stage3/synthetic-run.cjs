'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const {terminate}=require('../chart-webkit-stage2/process-tree.cjs');
if(process.platform!=='linux')throw Error('synthetic comparison requires Linux descendant identity tracking');
const output=path.resolve(process.argv[2]||'');if(!process.argv[2])throw Error('output required');fs.mkdirSync(output);
const plan=[];for(const mode of ['none','light','detailed'])for(let i=1;i<=3;i++)plan.push({mode,index:String(i),status:'NOT_TESTED'});
const data={plan,limits:{perTrialSeconds:30,overallSeconds:600,outputBytes:100*1024*1024},createdUtc:new Date().toISOString(),tailPolicy:'UNKNOWN if no final checkpoint',results:[]};
const save=()=>fs.writeFileSync(path.join(output,'plan.json'),JSON.stringify(data,null,2)+'\n');save();const start=performance.now();
function bytes(dir){return fs.readdirSync(dir,{withFileTypes:true}).reduce((n,e)=>{const p=path.join(dir,e.name);return n+(e.isDirectory()?bytes(p):e.isFile()?fs.statSync(p).size:0);},0);}
async function one(t){return new Promise(resolve=>{
  const stdout=fs.openSync(path.join(output,`${t.mode}-${t.index}.stdout.log`),'wx'),stderr=fs.openSync(path.join(output,`${t.mode}-${t.index}.stderr.log`),'wx');
  const child=spawn(process.execPath,[path.join(__dirname,'fixture-one.cjs'),t.mode,t.index,output],{stdio:['ignore',stdout,stderr],detached:true,env:process.env});let reason=null,done=false,termination=null;
  const timer=setTimeout(()=>{reason='outer_timeout';termination=terminate(child.pid);},30000);
  child.on('error',error=>finish({error:String(error)}));child.on('close',(code,signal)=>finish({code,signal}));
  async function finish(result){if(done)return;done=true;clearTimeout(timer);const terminated=termination?await termination:null;fs.closeSync(stdout);fs.closeSync(stderr);resolve({...result,reason,termination:terminated,descendantsAfterTimeout:reason?'UNKNOWN':'NOT_APPLICABLE'});}
});}
(async()=>{for(const t of plan){if(performance.now()-start>600000||bytes(output)>100*1024*1024){data.stop='budget';break;}t.startUtc=new Date().toISOString();t.status='running';save();const result=await one(t);t.endUtc=new Date().toISOString();t.status=result.reason||result.error||result.code!==0?'FAIL':'PASS';data.results.push({mode:t.mode,index:t.index,...result});save();if(t.status!=='PASS'){data.stop='trial_failure';break;}}data.endUtc=new Date().toISOString();save();if(data.stop||data.results.length!==9)process.exitCode=1;})().catch(e=>{data.fatal=String(e);save();process.exitCode=1;});
