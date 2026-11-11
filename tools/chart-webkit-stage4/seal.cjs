'use strict';
// A limited screen is not proof of confidentiality; raw files are never modified.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const MAX=32*1024*1024, TOTAL=100*1024*1024;
const sensitive=/(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-proj-[A-Za-z0-9_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;
function scan(root){
  const rows=[],problems=[];let total=0;
  function fail(rel,reason){problems.push({path:rel,reason});}
  function walk(dir){
    let entries;try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch(_){fail('.','unreadable_directory');return;}
    for(const d of entries.sort((a,b)=>a.name.localeCompare(b.name))){
      const p=path.join(dir,d.name),rel=path.relative(root,p).replaceAll('\\','/');
      try{
        const st=fs.lstatSync(p);if(st.isSymbolicLink()){fail(rel,'symlink');continue;}if(st.isDirectory()){walk(p);continue;}if(!st.isFile()){fail(rel,'not_regular');continue;}
        total+=st.size;if(st.size>MAX||total>=TOTAL){fail(rel,'size_limit');continue;}
        const b=fs.readFileSync(p),after=fs.lstatSync(p);if(after.size!==st.size||after.mtimeMs!==st.mtimeMs||after.ino!==st.ino){fail(rel,'changed_during_read');continue;}
        const hash=crypto.createHash('sha256').update(b).digest('hex');rows.push({path:rel,bytes:b.length,sha256:hash});
        if(!/\.(json|jsonl|log)$/.test(rel)){fail(rel,'unsupported_format');continue;}
        const text=new TextDecoder('utf-8',{fatal:true}).decode(b);if(text.includes('\0')){fail(rel,'binary');continue;}
        if(rel.endsWith('.json'))JSON.parse(text);if(rel.endsWith('.jsonl'))for(const line of text.split(/\r?\n/))if(line.trim())JSON.parse(line);
        if(sensitive.test(text))fail(rel,'restricted_pattern');
      }catch(_){fail(rel,'invalid_or_unreadable');}
    }
  }
  try{const st=fs.lstatSync(root);if(!st.isDirectory()||st.isSymbolicLink())fail('.','invalid_root');else walk(root);}catch(_){fail('.','invalid_root');}
  if(!rows.length)fail('.','missing_evidence');
  return {files:rows,problems,hashing:problems.some(p=>['invalid_root','unreadable_directory','changed_during_read','invalid_or_unreadable','size_limit','symlink','not_regular'].includes(p.reason))?'UNKNOWN':'PASS',screen:problems.length?'FAIL':'PASS',scope:'limited text screen; not proof of secrecy'};
}
function verifyManifest(root,manifest){
  const current=scan(root);
  const result={integrity:'FAIL',screen:current.screen,publicUpload:'DENY',privateStorage:'BLOCKED',durableStorage:'BLOCKED'};
  if(!manifest||!Array.isArray(manifest.files)||!manifest.files.length)return {...result,reason:'manifest_invalid'};
  if(current.hashing!=='PASS')return {...result,integrity:'UNKNOWN',reason:'hashing_incomplete'};
  const expected=new Map();for(const row of manifest.files){if(!row||typeof row.path!=='string'||!Number.isSafeInteger(row.bytes)||row.bytes<0||!/^([a-f0-9]{64})$/.test(row.sha256||'')||expected.has(row.path))return {...result,reason:'manifest_invalid'};expected.set(row.path,row);}
  if(expected.size!==current.files.length||current.files.some(x=>!expected.has(x.path)||expected.get(x.path).sha256!==x.sha256||expected.get(x.path).bytes!==x.bytes))return {...result,reason:'hash_or_file_mismatch'};
  return {...result,integrity:'PASS'};
}
if(require.main===module){if(!process.argv[2])throw Error('directory required');const result=scan(path.resolve(process.argv[2]));console.log(JSON.stringify({files:result.files.length,problems:result.problems.length,screen:result.screen}));if(result.screen!=='PASS'||result.hashing!=='PASS')process.exitCode=1;}
module.exports={scan,verifyManifest};
