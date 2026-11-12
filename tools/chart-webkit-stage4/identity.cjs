'use strict';
const fs=require('node:fs');
function identity(pid,read=fs.readFileSync){
  if(!Number.isSafeInteger(pid)||pid<=0)return {status:'PARSE_ERROR'};
  let s;try{s=read(`/proc/${pid}/stat`,'utf8');}catch(e){return {status:e.code==='ENOENT'?'ABSENT':'READ_ERROR'};}
  if(typeof s!=='string')return {status:'PARSE_ERROR'};
  const end=s.lastIndexOf(')'),begin=s.indexOf(' (');const f=end>=0?s.slice(end+2).trim().split(/\s+/):[];
  if(begin<1||Number(s.slice(0,begin))!==pid||end<begin||f.length<20||!/^\d+$/.test(f[19])||!/^\d+$/.test(f[1])||! /^[A-Za-z]$/.test(f[0]))return {status:'PARSE_ERROR'};
  return {status:'PRESENT',pid,start:f[19],state:f[0],ppid:Number(f[1])};
}
function descendants(root,{list=()=>fs.readdirSync('/proc'),read}={}){
  let entries;try{entries=list();}catch(_){return {processes:[],unknown:[{status:'READ_ERROR'}]};}
  const all=[],unknown=[];
  for(const name of entries.filter(x=>/^\d+$/.test(x))){const result=identity(Number(name),read);if(result.status==='PRESENT')all.push(result);else if(result.status!=='ABSENT')unknown.push({pid:Number(name),status:result.status});}
  const processes=[],seen=new Set([root]);let frontier=[root];
  while(frontier.length){const next=all.filter(p=>frontier.includes(p.ppid)&&!seen.has(p.pid));for(const p of next){seen.add(p.pid);processes.push(p);}frontier=next.map(p=>p.pid);}
  return {processes,unknown}; // Races, reparenting and uncaptured descendants remain UNKNOWN.
}
module.exports={identity,descendants};
