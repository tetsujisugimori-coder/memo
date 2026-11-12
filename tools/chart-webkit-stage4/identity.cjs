'use strict';
const fs=require('node:fs');
function identity(pid,read=fs.readFileSync){
  let s;try{s=read(`/proc/${pid}/stat`,'utf8');}catch(e){return {status:e.code==='ENOENT'?'ABSENT':'READ_ERROR'};}
  const end=s.lastIndexOf(')');const f=end>=0?s.slice(end+2).trim().split(/\s+/):[];
  if(end<0||f.length<20||!/^\d+$/.test(f[19])||!f[0])return {status:'PARSE_ERROR'};
  return {status:'PRESENT',pid,start:f[19],state:f[0]};
}
module.exports={identity};
