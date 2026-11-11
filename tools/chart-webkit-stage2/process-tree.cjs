'use strict';
// Linux /proc identities prevent signalling a reused PID. Detached descendants are included.
const fs = require('node:fs');
function stat(pid) {
  try { const s=fs.readFileSync(`/proc/${pid}/stat`,'utf8'); const f=s.slice(s.lastIndexOf(')')+2).split(' '); return {pid:Number(pid),state:f[0],ppid:Number(f[1]),start:f[19]}; } catch (_) {return null;}
}
function descendants(root) {
  const all=fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x)).map(stat).filter(Boolean);const result=[];let frontier=[root];
  while(frontier.length) {const next=all.filter(x=>frontier.includes(x.ppid) && !result.some(y=>y.pid===x.pid));result.push(...next);frontier=next.map(x=>x.pid);}
  const r=stat(root);if(r)result.unshift(r);return result;
}
function signal(identities, sig) { for(const p of [...identities].reverse()) { const now=stat(p.pid);if(now && now.start===p.start && now.state!=='Z') try {process.kill(p.pid,sig);} catch (_) {} } }
async function terminate(root) {
  const captured=descendants(root);signal(captured,'SIGTERM');
  await new Promise(resolve=>setTimeout(resolve,2000));
  signal(captured,'SIGKILL');
  await new Promise(resolve=>setTimeout(resolve,300));
  return {captured,remaining:captured.map(p=>stat(p.pid)).filter((p)=>p && p.state!=='Z' && captured.some(old=>old.pid===p.pid && old.start===p.start)),uncapturedOrReparented:'UNKNOWN'};
}
module.exports={stat,descendants,terminate};
