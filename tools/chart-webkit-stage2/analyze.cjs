'use strict';
// Read-only analysis; sequence gaps and unknown tail are reported separately.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(process.argv[2] || '');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'SHA256-manifest.json'),'utf8'));
const mismatches=[];
for(const file of manifest.files) {
  const absolute=path.resolve(root,file.path);
  if(!absolute.startsWith(root+path.sep)) throw Error('manifest path outside root');
  const bytes=fs.readFileSync(absolute);if(bytes.length!==file.bytes || crypto.createHash('sha256').update(bytes).digest('hex')!==file.sha256)mismatches.push(file.path);
}
const report={hash:{checked:manifest.files.length,mismatches,scannerUnsafe:manifest.unsafe,scannerUnscanned:manifest.unscanned},plan:JSON.parse(fs.readFileSync(path.join(root,'plan.json'),'utf8')),documents:[],parseErrors:[]};
for(const file of manifest.files.filter(x=>x.path.endsWith('/events.jsonl'))) {
  const full=path.join(root,file.path), lines=fs.readFileSync(full,'utf8').split('\n'), docs=new Map();let lastReceivedUtc=null;
  for(let index=0;index<lines.length;index++) {
    if(!lines[index])continue;let record;try{record=JSON.parse(lines[index]);}catch(e){report.parseErrors.push({path:file.path,line:index+1,error:String(e)});continue;}
    if(record.receivedUtc)lastReceivedUtc=record.receivedUtc;
    const p=record.payload;if(!p?.documentId || !Array.isArray(p.events))continue;
    const key=`${record.pageId}:${p.documentId}`;if(!docs.has(key))docs.set(key,{path:file.path,pageId:record.pageId,documentId:p.documentId,timeOrigin:p.timeOrigin,events:[],dropped:0,recorderErrors:0,lastReceivedUtc:null,boundary:false,pendingAtBoundary:null});
    const d=docs.get(key);d.events.push(...p.events);d.dropped=Math.max(d.dropped,p.dropped || 0);d.recorderErrors=Math.max(d.recorderErrors,p.recorderErrors || 0);d.lastReceivedUtc=record.receivedUtc || d.lastReceivedUtc;if(record.type==='boundary'){d.boundary=true;d.pendingAtBoundary=p.pending;}
  }
  for(const d of docs.values()) {
    d.events.sort((a,b)=>a.seq-b.seq);const sequences=d.events.map(e=>e.seq),seen=new Set(sequences);let gaps=0;const max=sequences.length?sequences.at(-1):0;for(let n=1;n<=max;n++)if(!seen.has(n))gaps++;
    const indices=[];for(let i=0;i<d.events.length;i++){const e=d.events[i];if(e.kind==='input' && e.target?.value==='Infinity' && e.target?.row?.chartItemIndex==='1' && e.target?.data?.chartSeriesIndex==='0')indices.push(i);}
    const windows=indices.map(i=>d.events.slice(Math.max(0,i-5),Math.min(d.events.length,i+12)));
    const clicks=[];for(let i=0;i<d.events.length;i++){const e=d.events[i];if(e.kind==='click' && e.state && e.target?.row?.chartItemIndex==='1') {const window=d.events.slice(Math.max(0,i-15),Math.min(d.events.length,i+8));clicks.push({anyInfinityInputInLimitedWindow:window.some(x=>x.kind==='input' && x.target?.value==='Infinity'),events:window});}}
    report.documents.push({path:d.path,pageId:d.pageId,documentId:d.documentId,timeOrigin:d.timeOrigin,recorded:d.events.length,firstSeq:sequences[0] || null,lastSeq:max || null,gaps,duplicates:sequences.length-seen.size,dropped:d.dropped,recorderErrors:d.recorderErrors,lastReceivedUtc:d.lastReceivedUtc,boundary:d.boundary,pendingAtBoundary:d.pendingAtBoundary,tail:'UNKNOWN',targetWindows:windows,itemMoveClickWindows:clicks});
  }
  if(!docs.size)report.documents.push({path:file.path,lastReceivedUtc,documents:'none observed',tail:'UNKNOWN'});
}
process.stdout.write(JSON.stringify(report,null,2)+'\n');if(mismatches.length || report.parseErrors.length)process.exitCode=1;
