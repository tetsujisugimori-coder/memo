'use strict';
// Linux sampled process-tree metrics; processes wholly between samples are missed.
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const {descendants}=require('../chart-webkit-stage2/process-tree.cjs');
function startResourceSampling(intervalMs=200){
  if(process.platform!=='linux')return {sample(){},stop:()=>({status:'UNKNOWN',reason:'Linux /proc unavailable'})};
  const pageSize=Number(execFileSync('getconf',['PAGESIZE'],{encoding:'utf8'})),ticks=Number(execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'}));
  const prev=new Map();let cpuTicks=0,peakRssBytes=0,samples=0,readErrors=0;
  function sample(){
    let rss=0;const identities=descendants(process.pid);
    for(const p of identities){try{const s=fs.readFileSync(`/proc/${p.pid}/stat`,'utf8'),f=s.slice(s.lastIndexOf(')')+2).split(' '),cpu=Number(f[11])+Number(f[12]),key=`${p.pid}:${p.start}`,prior=prev.get(key);if(prior!==undefined&&cpu>=prior)cpuTicks+=cpu-prior;prev.set(key,cpu);rss+=Number(f[21])*pageSize;}catch(_){readErrors++;}}
    peakRssBytes=Math.max(peakRssBytes,rss);samples++;
  }
  sample();const timer=setInterval(sample,intervalMs);
  return {sample,stop(){clearInterval(timer);sample();return {status:'sampled',scope:'controller and observed descendants, not whole runner',intervalMs,samples,readErrors,cpuMs:cpuTicks/ticks*1000,peakRssBytes,missingShortLivedProcesses:'UNKNOWN'};}};
}
module.exports={startResourceSampling};
