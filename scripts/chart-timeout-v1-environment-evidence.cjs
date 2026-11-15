'use strict';
// Static evidence extension. No network, package loading, browser/loader execution,
// installation, dependency placement, or qualification/review gate mutation.
const fs=require('node:fs'),path=require('node:path');
const {sha}=require('./chart-timeout-v1-preflight.cjs');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
function lockBytes(buffer) {
  const b=Buffer.from(buffer),text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);
  const bom=b.subarray(0,3).equals(Buffer.from([239,187,191]));
  const value=JSON.parse(bom?text.slice(1):text);
  if(!value||typeof value!=='object'||Array.isArray(value)||!Number.isInteger(value.lockfileVersion)||!value.packages||typeof value.packages!=='object'||Array.isArray(value.packages))throw Error('LOCK_SCHEMA');
  const crlf=(text.match(/\r\n/g)||[]).length;
  return {bytes:b.length,sha256:sha(b),bom,crlf,lfOnly:(text.match(/\n/g)||[]).length-crlf,crOnly:(text.match(/\r/g)||[]).length-crlf,value};
}
function compareLocks(fixed,working) {
  const a=lockBytes(fixed),b=lockBytes(working),keys=[...new Set([...Object.keys(a.value.packages),...Object.keys(b.value.packages)])].sort();
  const changes=field=>keys.filter(k=>JSON.stringify(a.value.packages[k]?.[field])!==JSON.stringify(b.value.packages[k]?.[field])).map(name=>({name,fixed:a.value.packages[name]?.[field]??null,working:b.value.packages[name]?.[field]??null}));
  const normalized=x=>Buffer.from(x).toString('utf8').replace(/\r\n/g,'\n');
  return {kind:'RAW_LOCK_COMPARISON_NOT_CONVERSION',rawStatus:Buffer.from(fixed).equals(Buffer.from(working))?'PASS':'FAIL',fixed:{...a,value:undefined},working:{...b,value:undefined},lineEndingsOnly:!Buffer.from(fixed).equals(Buffer.from(working))&&normalized(fixed)===normalized(working),jsonStructureSame:JSON.stringify(canonical(a.value))===JSON.stringify(canonical(b.value)),lockfileVersionSame:a.value.lockfileVersion===b.value.lockfileVersion,packageVersions:changes('version'),integrity:changes('integrity'),resolved:changes('resolved'),packageEntries:keys.length,workingWasModified:false,executionAuthorized:false};
}
function parsePE(buffer) {
  const b=Buffer.from(buffer),range=(off,size)=>{if(!Number.isSafeInteger(off)||off<0||off+size>b.length)throw Error('PE_RANGE');};
  const u16=off=>{range(off,2);return b.readUInt16LE(off);},u32=off=>{range(off,4);return b.readUInt32LE(off);};
  range(0,64);if(b.toString('ascii',0,2)!=='MZ')throw Error('PE_HEADER');
  const pe=u32(60);if(u32(pe)!==0x4550)throw Error('PE_HEADER');
  const machine=u16(pe+4),count=u16(pe+6),optional=pe+24,optionalBytes=u16(pe+20),magic=u16(optional),plus=magic===0x20b;
  if(!plus&&magic!==0x10b)throw Error('PE_OPTIONAL_HEADER');
  const dd=plus?112:96,dirCountOffset=plus?108:92;
  if(optionalBytes<dd||count>96||!count)throw Error('PE_HEADER_SIZE');range(optional,optionalBytes+count*40);
  const imageBase=plus?(range(optional+24,8),b.readBigUInt64LE(optional+24)):BigInt(u32(optional+28));
  const headerBytes=u32(optional+60),dirCount=Math.min(u32(optional+dirCountOffset),16);
  if(dd+dirCount*8>optionalBytes)throw Error('PE_DIRECTORY_RANGE');
  const sections=[];
  for(let i=0;i<count;i++){const s=optional+optionalBytes+i*40;sections.push({rva:u32(s+12),size:u32(s+16),offset:u32(s+20)});}
  const map=(rva,length=1)=>{
    if(rva<headerBytes){range(rva,length);return rva;}
    const s=sections.find(s=>rva>=s.rva&&rva+length<=s.rva+s.size);if(!s)throw Error('PE_RVA');
    const off=s.offset+rva-s.rva;range(off,length);return off;
  };
  const string=rva=>{const off=map(rva),end=b.indexOf(0,off);if(end<off||end-off>512)throw Error('PE_STRING');map(rva,end-off+1);return b.toString('ascii',off,end);};
  const directory=index=>index<dirCount?{rva:u32(optional+dd+index*8),bytes:u32(optional+dd+index*8+4)}:{rva:0,bytes:0};
  const functionNames=rva=>{
    if(!rva)return {status:'UNKNOWN',names:[]};const names=[],stride=plus?8:4;
    for(let i=0;i<4096;i++){
      const off=map(rva+i*stride,stride),v=plus?b.readBigUInt64LE(off):BigInt(u32(off));if(v===0n)return {status:'PASS',names};
      const flag=plus?0x8000000000000000n:0x80000000n;
      if(v&flag){names.push('#ordinal-'+String(v&0xffffn));continue;}
      if(v>BigInt(Number.MAX_SAFE_INTEGER))throw Error('PE_THUNK_RANGE');const n=Number(v);map(n,2);names.push(string(n+2));
    }throw Error('PE_THUNK_LIMIT');
  };
  const parseDirectory=(index,stride,delay)=>{
    const d=directory(index),out=[];if(!d.rva&&!d.bytes)return out;if(!d.rva||d.bytes<stride)throw Error('PE_IMPORT_DIRECTORY');
    for(let i=0;i<2048&&i*stride<d.bytes;i++){
      if((i+1)*stride>d.bytes)throw Error('PE_DESCRIPTOR_RANGE');const off=map(d.rva+i*stride,stride);
      if(b.subarray(off,off+stride).every(v=>v===0))return out;
      const attributes=delay?u32(off):1;
      if(delay&&(attributes&~1))throw Error('PE_DELAY_ATTRIBUTES');
      const toRva=v=>{if(!delay||attributes&1)return v;const r=BigInt(v)-imageBase;if(r<0n||r>0xffffffffn)throw Error('PE_DELAY_VA');return Number(r);};
      const name=string(toRva(u32(off+(delay?4:12))));if(!/^[A-Za-z0-9_.-]{1,260}$/.test(name)||['.','..'].includes(name))throw Error('PE_DLL_NAME');
      let functions;try{functions=functionNames(toRva(u32(off+(delay?16:0))));}catch(e){functions={status:'UNKNOWN',names:[],reason:e.message};}
      out.push({name,kind:delay?'delay-load':'direct',functions});
    }throw Error('PE_DESCRIPTOR_TERMINATOR_MISSING');
  };
  const direct=parseDirectory(1,20,false),delayed=parseDirectory(13,32,true),security=directory(4);
  if(security.rva||security.bytes)range(security.rva,security.bytes); // certificate directory is a file offset, not RVA
  return {status:'PASS',scope:'PE_BYTES_ONLY_NOT_LOADER_OR_SIGNATURE_VERIFICATION',machine,architecture:machine===0x8664?'x64':machine===0x14c?'x86':machine===0xaa64?'arm64':'UNKNOWN',imageBase:'0x'+imageBase.toString(16),direct,delayed,certificateTable:{present:security.bytes>0,bytes:security.bytes,signatureVerified:false},dynamicSearchAPIs:[...new Set([...direct,...delayed].flatMap(d=>d.functions.names).filter(n=>/LoadLibrary|AddDllDirectory|SetDllDirectory|SetDefaultDllDirectories|GetProcAddress/.test(n)))],loaderBehavior:'UNKNOWN'};
}
function inspectPEGraph(roots,searchDirectories,{maxNodes=256,maxDepth=12,maxBytes=2*1024**3}={}) {
  if(!Number.isSafeInteger(maxNodes)||maxNodes<1||maxNodes>1024||!Number.isSafeInteger(maxDepth)||maxDepth<0||maxDepth>32||!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('GRAPH_LIMITS');
  const queue=roots.map(file=>({file:path.resolve(file),depth:0})),nodes=[],edges=[],seen=new Set();let readBytes=0,limited=false;
  while(queue.length){
    if(nodes.length>=maxNodes){limited=true;break;}
    const {file,depth}=queue.shift();let real;try{real=fs.realpathSync(file);}catch{nodes.push({path:file,depth,status:'BLOCKED',reason:'CANDIDATE_UNAVAILABLE'});continue;}
    if(seen.has(real.toLowerCase()))continue;seen.add(real.toLowerCase());
    const id={path:file,realpath:real};let parsed;
    try {
      const st=fs.statSync(real);if(!st.isFile())throw Error('NOT_REGULAR_FILE');id.bytes=st.size;id.mode=st.mode&0o777;
      if(st.size>256*1024**2||readBytes+st.size>maxBytes){nodes.push({...id,depth,status:'UNKNOWN',reason:'STATIC_READ_LIMIT'});limited=true;continue;}
      const fd=fs.openSync(real,'r'),chunks=[];let consumed=0;
      try {
        const opened=fs.fstatSync(fd);if(opened.ino!==st.ino||opened.dev!==st.dev||opened.size!==st.size)throw Error('FILE_CHANGED_BEFORE_READ');
        while(consumed<st.size){
          const allowed=Math.min(1024**2,st.size-consumed,maxBytes-readBytes);if(allowed<=0){limited=true;throw Error('STATIC_READ_LIMIT');}
          const chunk=Buffer.alloc(allowed),n=fs.readSync(fd,chunk,0,allowed,null);readBytes+=n;consumed+=n;
          if(!n)throw Error('FILE_CHANGED_DURING_READ');chunks.push(chunk.subarray(0,n));
        }
        const ended=fs.fstatSync(fd);if(ended.size!==opened.size||ended.mtimeMs!==opened.mtimeMs)throw Error('FILE_CHANGED_DURING_READ');
      } finally {fs.closeSync(fd);}
      const bytes=Buffer.concat(chunks);id.sha256=sha(bytes);id.status='PASS';id.reason='HASH_AND_PARSE_SAME_BUDGETED_BYTES';id.executeAccess='UNKNOWN';parsed=parsePE(bytes);
    } catch(e) {nodes.push({...id,depth,status:'UNKNOWN',reason:e.message});continue;}
    nodes.push({...id,depth,pe:parsed});
    for(const dep of [...parsed.direct,...parsed.delayed]) {
      const edge={from:real,name:dep.name,kind:dep.kind,candidates:[],status:'UNKNOWN'};
      if(/^api-ms-|^ext-ms-/i.test(dep.name)){edge.reason='API_SET_MAPPING_NOT_RESOLVED';edges.push(edge);continue;}
      const dirs=[...new Set([path.dirname(real),...searchDirectories].map(d=>path.resolve(d)))];
      for(const dir of dirs){const target=path.join(dir,dep.name);try{if(fs.statSync(target).isFile())edge.candidates.push(fs.realpathSync(target));}catch{}}
      edge.candidates=[...new Set(edge.candidates)];edge.reason=edge.candidates.length?'CANDIDATES_NOT_ACTUAL_LOADER_SELECTION':'NOT_FOUND_IN_INSPECTED_DIRECTORIES_NOT_GLOBAL_ABSENCE';edges.push(edge);
      if(depth>=maxDepth){limited=true;continue;}
      for(const target of edge.candidates)queue.push({file:target,depth:depth+1});
    }
  }
  return {kind:'STATIC_PE_CANDIDATE_GRAPH',status:roots.length&&nodes.filter(n=>n.depth===0).every(n=>n.status==='BLOCKED')?'BLOCKED':'UNKNOWN',scope:'explicit directories only; not Windows loader search-order proof',nodes,edges,readBytes,limited,searchDirectories,notInspected:['KnownDLLs/API-set schema resolution','SxS/activation contexts','loaded-module list','package dependency graph','PATH/current-directory/runtime AddDllDirectory policies','effective execution ACL/AppLocker','conditional delay-load/dynamic LoadLibrary targets'],launchSuccess:'UNKNOWN',executionAuthorized:false};
}
module.exports={lockBytes,compareLocks,parsePE,inspectPEGraph};
