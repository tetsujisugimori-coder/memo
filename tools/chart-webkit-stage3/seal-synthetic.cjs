'use strict';
// Synthetic evidence only: reject binary, images, links, oversized text and token-like values.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{TextDecoder}=require('node:util');
const root=path.resolve(process.argv[2]||'');if(!process.argv[2])throw Error('directory required');const rows=[],problems=[];
function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(dir,e.name),rel=path.relative(root,p).replaceAll('\\','/');if(e.isDirectory()){visit(p);continue;}if(!e.isFile()){problems.push({path:rel,reason:'non-regular'});continue;}if(rel==='SHA256-manifest.json')continue;
  const st=fs.statSync(p);if(!/\.(jsonl?|log)$/.test(rel)||st.size>32*1024*1024){problems.push({path:rel,reason:'unsupported-format-or-size'});continue;}
  const b=fs.readFileSync(p);let s;try{s=new TextDecoder('utf-8',{fatal:true}).decode(b);}catch(_){problems.push({path:rel,reason:'invalid-utf8'});continue;}
  if(/(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-proj-[A-Za-z0-9_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(s))problems.push({path:rel,reason:'possible-secret'});
  rows.push({path:rel,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')});
}}
visit(root);const result={createdUtc:new Date().toISOString(),scope:'synthetic text only; token-pattern scan is not proof of absence of all secrets',files:rows,problems};fs.writeFileSync(path.join(root,'SHA256-manifest.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({files:rows.length,problems:problems.length}));if(problems.length)process.exitCode=1;
