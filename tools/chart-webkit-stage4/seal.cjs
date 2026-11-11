'use strict';
// Screening is bounded and deliberately incomplete: reject instead of editing raw evidence.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(process.argv[2]||'');if(!process.argv[2])throw Error('output root required');
const rows=[],problems=[];
function walk(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  const p=path.join(dir,d.name),rel=path.relative(root,p).replaceAll('\\','/');
  if(d.isDirectory()){walk(p);continue;}if(!d.isFile()||!/\.(json|jsonl|log)$/.test(rel)){problems.push({path:rel,reason:'unsupported'});continue;}
  const b=fs.readFileSync(p),s=b.toString('utf8');
  if(b.length>32*1024*1024||Buffer.from(s,'utf8').compare(b)!==0)problems.push({path:rel,reason:'size-or-encoding'});
  if(/gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-proj-[A-Za-z0-9_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(s))problems.push({path:rel,reason:'restricted-pattern'});
  rows.push({path:rel,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')});
}}
walk(root);const result={createdUtc:new Date().toISOString(),scope:'synthetic UTF-8 text; limited scan, not a guarantee',files:rows,problems};
fs.writeFileSync(path.join(root,'SHA256-manifest.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({files:rows.length,problems:problems.length}));if(problems.length)process.exitCode=1;
