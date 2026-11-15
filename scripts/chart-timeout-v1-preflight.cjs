'use strict';
// Offline, non-browser inspection only. Never import Playwright, run a wrapper,
// invoke an installer/loader, or call the diagnostic run() entry point.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const cp = require('node:child_process');
const vm = require('node:vm');
const FIXED = Object.freeze({
  head:'87a5ac2f2dbbb940e8f4b4dd6269e5c349e75fc1', tree:'b28b20bfe6a5b21da39b2c010e0ea4be42437932',
  source:'240e906757c2514864cf1f2150cf4dfb5423abb8ba2030673ca80c49ad3a4722',
  lock:'284777a48f5a357a603bd6916f5d86c2fa1e7cd43537442c0fcb62f478b85edb',
  diagnosticHead:'a4115eab8d4b5c26ab0177c84b6d92f10534647a',
  blobs:{'scripts/chart-timeout-v1.cjs':'3287599bd10f9e24aa85d22c443d4c17a0338f9d','scripts/chart-timeout-v1-observer.cjs':'2ca7d3198013a805d0dda411cbef5f58edbf2338'},
  playwright:'1.62.1', revisions:{chromium:'1234','chromium-headless-shell':'1234',webkit:'2336'},
  runners:{legacy:{sha256:'50f3d42e4a51d18db258fe0a1f01184ac5ea7382f5209b274440a26e2bcd94b1',targetId:'chart-v1:legacy:infinity-rejection',targetCallSha256:'98df35f4a61e932144724f854ca405fb5b65edd9a36754fe66e3d62c9deb8f05'},narrow:{sha256:'f05faa82e2483ad5727c74f7a06739ac7aa57af8ba582c983e43eeb9b996d2ef',targetId:'chart-v1:narrow:five-items-totals',targetCallSha256:'0906ee5ea4fa5cf7a840171760e445f08f828457fe3247b9cc84719ee14f1e84'}}
});
const SLOTS = Object.freeze(['chromium:legacy','webkit:legacy','chromium:narrow','webkit:narrow']);
const MIN_FREE = 16 * 1024 ** 3;
const MAX_ARCHIVE = 512 * 1024 ** 2;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const blob = b => crypto.createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex');
const errorCode = e => typeof e?.code === 'string' ? e.code : 'INSPECTION_ERROR';
const aggregate = checks => ['FAIL','BLOCKED','UNKNOWN'].find(s => checks.some(c => c.status === s)) || (checks.length&&checks.every(c=>c.status==='PASS')?'PASS':'UNKNOWN');
// No approved acquisition/digest/launch-chain trust anchors were supplied for
// this case. Installed hashes, marker files, and caller claims cannot create one.
const APPROVED = Object.freeze({});
function crc32(b) {
  let c = 0xffffffff;
  for (const v of b) { c ^= v; for (let i=0;i<8;i++) c = (c>>>1) ^ ((c&1)?0xedb88320:0); }
  return (c ^ 0xffffffff) >>> 0;
}
function inspectZip(b) {
  // Bounded ZIP CRC inspection; ZIP64/unsupported methods are UNKNOWN, never PASS.
  try {
    if (b.length < 22 || b.readUInt32LE(0) !== 0x04034b50) throw Error('ZIP_HEADER');
    let end=-1;
    for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--) if(b.readUInt32LE(i)===0x06054b50 && i+22+b.readUInt16LE(i+20)===b.length) {end=i;break;}
    if(end<0) throw Error('ZIP_CENTRAL_DIRECTORY');
    const count=b.readUInt16LE(end+10),size=b.readUInt32LE(end+12),offset=b.readUInt32LE(end+16);
    if(b.readUInt16LE(end+4)||b.readUInt16LE(end+6)||count===65535||offset===0xffffffff||size===0xffffffff) return {status:'UNKNOWN',reason:'ZIP_FORMAT_UNSUPPORTED'};
    if(!count||count>10000||offset+size!==end||b.readUInt16LE(end+8)!==count) throw Error('ZIP_DIRECTORY_RANGE');
    let cursor=offset,total=0;const ranges=[],names=new Set();
    for(let i=0;i<count;i++) {
      if(cursor+46>end||b.readUInt32LE(cursor)!==0x02014b50) throw Error('ZIP_DIRECTORY_ENTRY');
      const flags=b.readUInt16LE(cursor+8),method=b.readUInt16LE(cursor+10),crc=b.readUInt32LE(cursor+16),compressed=b.readUInt32LE(cursor+20),unpacked=b.readUInt32LE(cursor+24);
      const n=b.readUInt16LE(cursor+28),extra=b.readUInt16LE(cursor+30),comment=b.readUInt16LE(cursor+32),local=b.readUInt32LE(cursor+42);
      if(cursor+46+n+extra+comment>end||local+30>offset||b.readUInt32LE(local)!==0x04034b50) throw Error('ZIP_LOCAL_ENTRY');
      const name=b.subarray(cursor+46,cursor+46+n).toString('utf8');
      if(name.includes('..')||name.startsWith('/')||name.includes('\\')||name.includes(':')||name.includes('\0')) throw Error('ZIP_UNSAFE_PATH');
      if(names.has(name))throw Error('ZIP_DUPLICATE_ENTRY');names.add(name);
      if(flags&1||![0,8].includes(method)||unpacked>64*1024**2||(total+=unpacked)>MAX_ARCHIVE) return {status:'UNKNOWN',reason:'ZIP_INSPECTION_LIMIT'};
      const start=local+30+b.readUInt16LE(local+26)+b.readUInt16LE(local+28);
      if(start+compressed>offset||b.readUInt16LE(local+8)!==method||b.readUInt16LE(local+6)!==flags||!b.subarray(local+30,local+30+b.readUInt16LE(local+26)).equals(b.subarray(cursor+46,cursor+46+n))) throw Error('ZIP_LOCAL_MISMATCH');
      let entryEnd=start+compressed;
      if(flags&8) {
        let descriptor=entryEnd;if(descriptor+4<=offset&&b.readUInt32LE(descriptor)===0x08074b50)descriptor+=4;
        if(descriptor+12>offset||b.readUInt32LE(descriptor)!==crc||b.readUInt32LE(descriptor+4)!==compressed||b.readUInt32LE(descriptor+8)!==unpacked)throw Error('ZIP_DESCRIPTOR_MISMATCH');
        entryEnd=descriptor+12;
      } else if(b.readUInt32LE(local+14)!==crc||b.readUInt32LE(local+18)!==compressed||b.readUInt32LE(local+22)!==unpacked)throw Error('ZIP_LOCAL_CRC_OR_SIZE');
      if(ranges.some(([s,e])=>local<e&&entryEnd>s))throw Error('ZIP_OVERLAPPING_ENTRIES');ranges.push([local,entryEnd]);
      const data=b.subarray(start,start+compressed),inflated=method===8?zlib.inflateRawSync(data,{maxOutputLength:64*1024**2,info:true}):null,raw=inflated?inflated.buffer:data;
      if(inflated&&inflated.engine.bytesWritten!==compressed)throw Error('ZIP_COMPRESSED_SIZE');
      if(raw.length!==unpacked||crc32(raw)!==crc) throw Error('ZIP_CRC_OR_SIZE');
      cursor+=46+n+extra+comment;
    }
    if(cursor!==end) throw Error('ZIP_DIRECTORY_SIZE');
    return {status:'PASS',reason:'ZIP_ENTRIES_CRC_VERIFIED',entries:count,unpackedBytes:total};
  } catch(e) {return {status:'FAIL',reason:/^ZIP_/.test(e.message)?e.message:'ZIP_CORRUPT'};}
}
function fileIdentity(file, commands) {
  const r={path:file};
  try {
    // Inspect every path component: a dangling link is not an absent regular file.
    let current=path.parse(path.resolve(file)).root; r.links=[];
    for(const part of path.resolve(file).slice(current.length).split(path.sep).filter(Boolean)) {
      current=path.join(current,part); const st=fs.lstatSync(current);
      if(st.isSymbolicLink()) {r.links.push({path:current,target:fs.readlinkSync(current)}); try {fs.realpathSync(current);} catch {return {...r,status:'BLOCKED',reason:'BROKEN_SYMLINK'};}}
    }
    r.realpath=fs.realpathSync(file); const st=fs.statSync(file);
    if(!st.isFile()) return {...r,status:'BLOCKED',reason:'NOT_REGULAR_FILE'};
    fs.accessSync(file,fs.constants.R_OK);r.bytes=st.size;r.mode=st.mode & 0o777;
    const h=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.alloc(1024*1024);let readBytes=0,stable;
    try {
      const opened=fs.fstatSync(fd);let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0){h.update(buffer.subarray(0,n));readBytes+=n;}
      const ended=fs.fstatSync(fd);stable=opened.ino===st.ino&&opened.dev===st.dev&&readBytes===st.size&&ended.size===opened.size&&ended.mtimeMs===opened.mtimeMs;
    } finally {fs.closeSync(fd);}
    r.sha256=h.digest('hex');
    if(!stable)return {...r,status:'FAIL',reason:'FILE_CHANGED_DURING_HASH'};
    if(process.platform==='win32') r.executeAccess='UNKNOWN';
    else {try {fs.accessSync(file,fs.constants.X_OK);r.executeAccess='PASS';} catch {r.executeAccess='BLOCKED';}}
    r.status='PASS';r.reason='READ_AND_HASHED';
  } catch(e) {r.status='BLOCKED';r.reason=errorCode(e);}
  commands?.push({operation:'lstat/realpath/read/hash/access',path:file,status:r.status});return r;
}
function archiveIdentity(file, commands) {
  if(!file) return {status:'UNKNOWN',reason:'ARCHIVE_NOT_RETAINED'};
  const r=fileIdentity(file,commands);if(r.status!=='PASS')return r;
  if(r.bytes>MAX_ARCHIVE)return {...r,structure:{status:'UNKNOWN',reason:'ARCHIVE_SIZE_LIMIT'}};
  try {
    const data=fs.readFileSync(file);
    if(data.length!==r.bytes||sha(data)!==r.sha256)return {...r,status:'FAIL',reason:'ARCHIVE_CHANGED_BETWEEN_READS',structure:{status:'FAIL',reason:'ARCHIVE_CHANGED_BETWEEN_READS'}};
    return {...r,structure:inspectZip(data)};
  } catch(e) {return {...r,status:'BLOCKED',reason:errorCode(e),structure:{status:'UNKNOWN',reason:'ARCHIVE_READ_UNAVAILABLE'}};}
}
function peImports(b) {
  // Parse bytes only. No LoadLibrary, winldd, ldd, executable --version, or wrapper.
  if(b.length<64||b.toString('ascii',0,2)!=='MZ')throw Error('PE_HEADER');
  const pe=b.readUInt32LE(0x3c);if(pe+24>b.length||b.readUInt32LE(pe)!==0x4550)throw Error('PE_HEADER');
  const sections=b.readUInt16LE(pe+6),opt=pe+24,magic=b.readUInt16LE(opt),table=opt+b.readUInt16LE(pe+20);
  const base=magic===0x20b?112:magic===0x10b?96:0;if(!base)throw Error('PE_OPTIONAL_HEADER');
  const map=rva=>{for(let i=0;i<sections;i++){const s=table+i*40;if(s+40>b.length)throw Error('PE_RANGE');const start=b.readUInt32LE(s+12),size=b.readUInt32LE(s+16);if(rva>=start&&rva<start+size){const off=b.readUInt32LE(s+20)+rva-start;if(off>=b.length)throw Error('PE_RANGE');return off;}}throw Error('PE_RVA');};
  const imports=[],rva=b.readUInt32LE(opt+base+8);if(!rva)return imports;
  let cursor=map(rva);
  for(let i=0;i<2048;i++,cursor+=20){if(cursor+20>b.length)throw Error('PE_RANGE');const name=b.readUInt32LE(cursor+12);if(!name)return imports;const start=map(name),end=b.indexOf(0,start);if(end<start||end-start>260)throw Error('PE_NAME');const value=b.toString('ascii',start,end);if(!/^[A-Za-z0-9_.-]+\.dll$/i.test(value))throw Error('PE_NAME');imports.push(value);}
  throw Error('PE_IMPORT_LIMIT');
}
function libraries(identity, commands, platform=process.platform, environmentOverridesPresent=Boolean(process.env.LD_LIBRARY_PATH||process.env.LD_PRELOAD)) {
  if(identity.status!=='PASS')return {status:'BLOCKED',reason:'EXECUTABLE_UNAVAILABLE',missing:[]};
  try {
    if(platform==='win32') {
      const required=peImports(fs.readFileSync(identity.realpath)),missing=[],resolved=[],virtual=[];
      const system=path.join(process.env.SystemRoot||'C:\\Windows','System32');
      for(const name of required) {
        if(/^api-ms-|^ext-ms-/i.test(name)){virtual.push(name);continue;}
        const found=[path.join(path.dirname(identity.realpath),name),path.join(system,name)].find(p=>{try{return fs.statSync(p).isFile();}catch{return false;}});
        if(found)resolved.push({name,path:found});else missing.push(name);
      }
      commands.push({operation:'static PE import-table parsing; no loader',status:'PASS'});
      return {status:missing.length?'BLOCKED':'UNKNOWN',reason:missing.length?'DIRECT_DLL_MISSING':'TRANSITIVE_AND_LOADER_RESOLUTION_UNPROVEN',required,resolved,missing,virtual,coverage:'direct-only'};
    }
    if(platform==='linux') {
      const command='/usr/bin/readelf',args=['-l','-d',identity.realpath];
      const p=cp.spawnSync(command,args,{encoding:'utf8',timeout:10000,maxBuffer:2*1024**2});
      commands.push({command,args,exit:p.status,error:p.error?errorCode(p.error):null});
      if(p.status!==0)return {status:'UNKNOWN',reason:'STATIC_ELF_INSPECTION_UNAVAILABLE',missing:[]};
      const needed=[...p.stdout.matchAll(/\(NEEDED\).*?\[([^\]]+)\]/g)].map(m=>m[1]);
      const loader=/Requesting program interpreter: ([^\]]+)/.exec(p.stdout)?.[1]||null;
      const loaderMissing=loader&&!fs.existsSync(loader),registry='/sbin/ldconfig',args2=['-p'];
      const cache=cp.spawnSync(registry,args2,{encoding:'utf8',timeout:10000,maxBuffer:2*1024**2});
      commands.push({command:registry,args:args2,exit:cache.status,error:cache.error?errorCode(cache.error):null});
      const dirs=[path.dirname(identity.realpath),...([...p.stdout.matchAll(/\((?:RPATH|RUNPATH)\).*?\[([^\]]+)\]/g)].flatMap(m=>m[1].split(':')).map(d=>d.replace(/\$\{?ORIGIN\}?/g,path.dirname(identity.realpath))).filter(d=>path.isAbsolute(d)&&!d.includes('$')))];
      const resolved=[],unresolved=[];
      for(const name of needed) {
        const locations=[...dirs.map(d=>path.join(d,name)),...([...String(cache.stdout||'').matchAll(/\s+(\S+)\s+\([^\n]*?\) => (\S+)/g)].filter(m=>m[1]===name).map(m=>m[2]))];
        const found=locations.find(f=>{try{return fs.statSync(f).isFile();}catch{return false;}});
        if(found)resolved.push({name,path:found});else unresolved.push(name);
      }
      const missing=loaderMissing?[loader]:cache.status===0&&!environmentOverridesPresent?unresolved:[];
      return {status:missing.length?'BLOCKED':'UNKNOWN',reason:missing.length?'LOADER_OR_DIRECT_SO_MISSING':'TRANSITIVE_LOADER_OR_ENVIRONMENT_UNPROVEN',loader,required:needed,resolved,unresolved,missing,environmentOverridesPresent,coverage:'direct-only'};
    }
    return {status:'UNKNOWN',reason:'STATIC_LOADER_INSPECTION_UNSUPPORTED',missing:[]};
  } catch {return {status:'UNKNOWN',reason:'STATIC_BINARY_FORMAT_UNRESOLVED',missing:[]};}
}
function checkOutput(root, output) {
  try {
    if(fs.lstatSync(root).isSymbolicLink())return {status:'BLOCKED',reason:'OUTPUT_ROOT_SYMLINK'};
    const base=fs.realpathSync(root),parent=fs.realpathSync(path.dirname(output)),rel=path.relative(base,parent);
    if(rel.startsWith('..')||path.isAbsolute(rel)||output===base) return {status:'BLOCKED',reason:'OUTPUT_OUTSIDE_CASE_ROOT'};
    let exists=false;try{fs.lstatSync(output);exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
    if(exists)return {status:'BLOCKED',reason:'OUTPUT_EXISTS'};
    // Reject symlink ancestors even if their realpath remains within this workspace.
    let current=path.resolve(root);
    for(const part of path.relative(current,path.dirname(output)).split(path.sep).filter(Boolean)){current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())return {status:'BLOCKED',reason:'OUTPUT_SYMLINK'};}
    fs.accessSync(parent,fs.constants.W_OK);const s=fs.statfsSync(parent);
    const freeBytes=Number(s.bavail)*Number(s.bsize);
    if(!Number.isSafeInteger(freeBytes))return {status:'UNKNOWN',reason:'FREE_SPACE_UNMEASURED'};
    return {status:freeBytes>=MIN_FREE?'PASS':'BLOCKED',reason:freeBytes>=MIN_FREE?'NEW_PATH_AND_CAPACITY':'INSUFFICIENT_CAPACITY',freeBytes,requiredBytes:MIN_FREE,parent};
  } catch(e) {return {status:'BLOCKED',reason:errorCode(e)};}
}
function collect(root, {output,dependencies,browserCache,archives={}}) {
  const commands=[], git=(args)=>{
    const r=cp.spawnSync('git',args,{cwd:root,timeout:10000,maxBuffer:16*1024**2});
    commands.push({command:'git',args,exit:r.status,error:r.error?errorCode(r.error):null});
    if(r.status!==0)throw Object.assign(Error('GIT_EVIDENCE_UNAVAILABLE'),{code:'GIT_EVIDENCE_UNAVAILABLE'});return r.stdout;
  };
  const facts={schema:1,createdAt:new Date().toISOString(),commands,environment:{platform:process.platform,arch:process.arch,node:process.version,osType:os.type(),release:os.release(),launchSuccess:'UNKNOWN'},source:{},diagnostic:{},dependencies:{},browsers:{},output:checkOutput(root,output),plan:{slots:[...SLOTS],attemptsPerSlot:1,retries:0,actionTimeoutMs:30000,wallMs:180000,maxBuffer:16777216,evidenceBudgetBytes:300*1024**2,executions:SLOTS.map(slot=>({slot,executions:0,status:'NOT_TESTED'}))},review:null};
  facts.preflight=fileIdentity(__filename,commands);
  try {
    facts.source.head=git(['rev-parse',FIXED.head]).toString().trim();facts.source.tree=git(['rev-parse',FIXED.head+'^{tree}']).toString().trim();
    const raw=git(['show',FIXED.head+':chart-block.e2e.js']),lock=git(['show',FIXED.head+':package-lock.json']);
    facts.source.sha256=sha(raw);facts.source.lockSha256=sha(lock);facts.source.lockBytes=lock.length;
    facts.source.workingLock=fileIdentity(path.join(root,'package-lock.json'),commands);
    facts.source.currentHead=git(['rev-parse','HEAD']).toString().trim();facts.source.currentTree=git(['rev-parse','HEAD^{tree}']).toString().trim();
    const lockJSON=JSON.parse(lock);facts.dependencies.expectedVersion=lockJSON.packages['node_modules/playwright'].version;
    facts.dependencies.lockedCoreVersion=lockJSON.packages['node_modules/playwright-core'].version;
    let diagnosticSource;
    for(const [file,expected] of Object.entries(FIXED.blobs)) {
      const committed=git(['show','HEAD:'+file]),working=fs.readFileSync(path.join(root,file));
      facts.diagnostic[file]={blob:blob(committed),expected,sha256:sha(committed),workingSha256:sha(working),workingMatches:working.equals(committed),crlfOnly:working.toString().replace(/\r\n/g,'\n')===committed.toString()};
      if(file==='scripts/chart-timeout-v1.cjs')diagnosticSource=committed;
    }
    // Do not import the worktree module before establishing the diagnostic version.
    if(Object.values(facts.diagnostic).some(d=>d.blob!==d.expected||!d.workingMatches&&!d.crlfOnly))throw Object.assign(Error('DIAGNOSTIC_VERSION_MISMATCH'),{code:'DIAGNOSTIC_VERSION_MISMATCH'});
    const sandbox={require,module:{exports:{}},Buffer};
    vm.runInNewContext(diagnosticSource.toString('utf8'),sandbox,{timeout:1000});
    const {generate,TARGETS}=sandbox.module.exports;
    facts.diagnostic.runners={};
    for(const scenario of ['legacy','narrow']) {
      const runner=generate(raw.toString('utf8'),scenario),id=TARGETS[scenario].id;
      facts.diagnostic.runners[scenario]={sha256:sha(runner),targetId:id,targetCallSha256:sha(TARGETS[scenario].call),targetCount:runner.split(`page.__chartDiagnosticWait(${JSON.stringify(id)}, `).length-1,fallbackAbsent:!runner.includes('chromium_headless_shell-1194')};
    }
    const dir=dependencies||path.join(root,'node_modules');facts.dependencies.layoutMatches=path.resolve(dir)===path.resolve(root,'node_modules');
    facts.dependencies.path=dir;
    for(const name of ['playwright','playwright-core']) {const p=path.join(dir,name,'package.json'),b=fs.readFileSync(p);facts.dependencies[name]={version:JSON.parse(b).version,sha256:sha(b)};}
    const hiddenBytes=fs.readFileSync(path.join(dir,'.package-lock.json')),hidden=JSON.parse(hiddenBytes);
    facts.dependencies.installedLock={sha256:sha(hiddenBytes),bytes:hiddenBytes.length};
    facts.dependencies.mismatches=[];facts.dependencies.missing=[];facts.dependencies.packageMetadata=[];
    for(const [name,entry] of Object.entries(lockJSON.packages).filter(([n])=>n)) {
      const placed=hidden.packages?.[name];
      if(!placed){if(!entry.optional)facts.dependencies.missing.push(name);continue;}
      const bytes=fs.readFileSync(path.join(dir,'..',name,'package.json')),version=JSON.parse(bytes).version;
      facts.dependencies.packageMetadata.push({name,version,sha256:sha(bytes),bytes:bytes.length});
      if(version!==entry.version||placed.version!==entry.version||placed.integrity!==entry.integrity||placed.resolved!==entry.resolved)facts.dependencies.mismatches.push(name);
    }
    const metadataBytes=fs.readFileSync(path.join(dir,'playwright-core','browsers.json')),metadata=JSON.parse(metadataBytes);
    facts.dependencies.browsersJSON={sha256:sha(metadataBytes),revisions:Object.fromEntries(metadata.browsers.filter(b=>Object.hasOwn(FIXED.revisions,b.name)).map(b=>[b.name,b.revision])),revisionOverrides:metadata.browsers.find(b=>b.name==='webkit')?.revisionOverrides||{}};
    facts.dependencies.launcherSource=fileIdentity(path.join(dir,'playwright-core','lib','coreBundle.js'),commands);
  } catch(e) {facts.collectionError=errorCode(e);}
  const cache=browserCache || (process.platform==='win32'?path.join(os.homedir(),'AppData','Local','ms-playwright'):process.platform==='darwin'?path.join(os.homedir(),'Library','Caches','ms-playwright'):path.join(os.homedir(),'.cache','ms-playwright'));
  const suffix=process.platform==='win32'&&process.arch==='x64'?{chromium:['chrome-headless-shell-win64','chrome-headless-shell.exe'],candidate:['chrome-win64','chrome.exe'],webkit:['Playwright.exe']}:process.platform==='linux'&&process.arch==='x64'?{chromium:['chrome-headless-shell-linux64','chrome-headless-shell'],candidate:['chrome-linux64','chrome'],webkit:['pw_run.sh']}:null;
  for(const engine of ['chromium','webkit']) {
    const revision=FIXED.revisions[engine],build=engine==='chromium'?'chromium_headless_shell-'+FIXED.revisions['chromium-headless-shell']:'webkit-'+revision;
    const executable=suffix?fileIdentity(path.join(cache,build,...suffix[engine]),commands):{status:'UNKNOWN',reason:'PLATFORM_MAPPING_UNSUPPORTED'};
    facts.browsers[engine]={revision,archive:archiveIdentity(archives[engine],commands),executable,libraries:libraries(executable,commands),launchChain:null,acquisition:null};
    if(engine==='chromium'&&suffix)facts.browsers[engine].executablePathCandidate=fileIdentity(path.join(cache,'chromium-'+revision,...suffix.candidate),commands);
  }
  return facts;
}
function assess(facts, anchors=APPROVED) {
  const checks=[],add=(group,item,status,reason,evidence)=>checks.push({group,item,status:['PASS','FAIL','BLOCKED','UNKNOWN'].includes(status)?status:'UNKNOWN',reason,evidence:evidence??null});
  const identityStatus=r=>!r?'UNKNOWN':r.status!=='PASS'?r.status:/^[a-f0-9]{64}$/.test(r.sha256)&&Number.isSafeInteger(r.bytes)&&r.bytes>=0?'PASS':'UNKNOWN';
  const eq=(group,item,value,expected)=>add(group,item,value==null?'UNKNOWN':value===expected?'PASS':'FAIL',value==null?'EVIDENCE_MISSING':value===expected?'MATCH':'MISMATCH',{observed:value??null,expected});
  for(const key of ['head','tree','sha256','lockSha256'])eq('E',key,facts.source?.[key],{head:FIXED.head,tree:FIXED.tree,sha256:FIXED.source,lockSha256:FIXED.lock}[key]);
  const lock=facts.source?.workingLock;
  add('C','working-lock-bytes',identityStatus(lock)!=='PASS'?identityStatus(lock):lock.sha256===FIXED.lock?'PASS':'FAIL',!lock?'EVIDENCE_MISSING':lock.status!=='PASS'?lock.reason:lock.sha256===FIXED.lock?'EXACT_FIXED_BYTES':'LOCK_BYTE_MISMATCH',lock);
  for(const [file,expected]of Object.entries(FIXED.blobs)) {
    const d=facts.diagnostic?.[file];eq('E',file+' Git blob',d?.blob,expected);
    add('E',file+' worktree',!d?'UNKNOWN':d.workingMatches||d.crlfOnly?'PASS':'FAIL',!d?'EVIDENCE_MISSING':d.workingMatches?'RAW_BYTES_MATCH':d.crlfOnly?'CRLF_ONLY_RAW_HASH_RECORDED':'DIAGNOSTIC_WORKTREE_CHANGED',d);
  }
  for(const scenario of ['legacy','narrow']) {
    const r=facts.diagnostic?.runners?.[scenario],expected=FIXED.runners[scenario];add('E','generated '+scenario,!r?'UNKNOWN':r.targetCount===1&&r.fallbackAbsent&&Object.entries(expected).every(([k,v])=>r[k]===v)?'PASS':'FAIL',!r?'EVIDENCE_MISSING':'EXACT_FIXED_RUNNER_TARGET_AND_NO_FALLBACK',r);
  }
  const dep=facts.dependencies||{};
  for(const key of ['expectedVersion','lockedCoreVersion'])eq('C',key,dep[key],FIXED.playwright);
  for(const name of ['playwright','playwright-core'])eq('C',name+' installed version',dep[name]?.version,FIXED.playwright);
  add('C','diagnostic dependency location',dep.layoutMatches===undefined?'UNKNOWN':dep.layoutMatches?'PASS':'BLOCKED',dep.layoutMatches?'DIAGNOSTIC_NODE_MODULES':'DIAGNOSTIC_DEPENDENCY_LAYOUT_UNAVAILABLE');
  add('C','installed lock and package versions',!Array.isArray(dep.mismatches)||!Array.isArray(dep.missing)?'UNKNOWN':dep.mismatches.length?'FAIL':dep.missing.length?'BLOCKED':'PASS','ALL_LOCKED_PACKAGES_CHECK', {mismatches:dep.mismatches??null,missing:dep.missing??null});
  for(const [name,rev]of Object.entries(FIXED.revisions))eq('C',name+' declared revision',dep.browsersJSON?.revisions?.[name],rev);
  const trustedPackage=anchors.packages,packageProof=dep.packageProof;
  add('C','installed package authenticity',!trustedPackage||!packageProof?'UNKNOWN':/^[a-f0-9]{64}$/.test(trustedPackage.treeSha256)&&packageProof.treeSha256===trustedPackage.treeSha256&&trustedPackage.reference?'PASS':'FAIL','INSTALLED_JSON_AND_LOCK_SRI_ALONE_DO_NOT_PROVE_PACKAGE_BYTES');
  const env=facts.environment||{};
  const nodeVersion=/^v(\d+)\.\d+\.\d+$/.exec(env.node);
  add('D','OS architecture and Node',!env.platform||!env.arch||!nodeVersion?'UNKNOWN':!['win32','linux'].includes(env.platform)||env.arch!=='x64'?'UNKNOWN':Number(nodeVersion[1])<20?'BLOCKED':'PASS','HOST_METADATA_ONLY_NOT_ORIGINAL_CI_EQUIVALENCE',env);
  for(const engine of ['chromium','webkit']) {
    const b=facts.browsers?.[engine]||{},a=b.archive||{},anchor=anchors[engine];
    add('A',engine+' retained archive',identityStatus(a),a.reason||'ARCHIVE_EVIDENCE_MISSING',a);
    const structure=a.structure,structureStatus=structure?.status==='PASS'&&(!Number.isSafeInteger(structure.entries)||structure.entries<1||!Number.isSafeInteger(structure.unpackedBytes)||structure.unpackedBytes<0)?'UNKNOWN':structure?.status||'UNKNOWN';
    add('A',engine+' archive structure and CRC',structureStatus,structure?.reason||'ARCHIVE_STRUCTURE_UNMEASURED',structure);
    const acquired=b.acquisition;
    let provenance='UNKNOWN',reason='NO_APPROVED_INDEPENDENT_ACQUISITION_ANCHOR';
    if(anchor) {
      if(!acquired)reason='ACQUISITION_ROUTE_MISSING';
      else if(!/^https:\/\/(?:cdn\.playwright\.dev|playwright\.download\.prss\.microsoft\.com|storage\.googleapis\.com)\/[^?#@]+$/.test(anchor.url)||!anchor.reference||!['routeSha256','archiveSha256','mappingSha256','executableSha256'].every(k=>/^[a-f0-9]{64}$/.test(anchor[k]))||!Number.isSafeInteger(anchor.archiveBytes)||anchor.archiveBytes<=0)reason='TRUST_ANCHOR_INSUFFICIENT';
      else if(acquired.url!==anchor.url||acquired.routeSha256!==anchor.routeSha256||a.sha256!==anchor.archiveSha256||a.bytes!==anchor.archiveBytes){provenance='FAIL';reason='TRUSTED_ACQUISITION_MISMATCH';}
      else {provenance='PASS';reason='INDEPENDENT_ANCHOR_AND_ACQUISITION_MATCH';}
    }
    add('A',engine+' provenance and expected archive digest',provenance,reason,{reference:anchor?.reference??null});
    const exe=b.executable;
    const executableStatus=identityStatus(exe);
    add('B',engine+' executable bytes',executableStatus==='PASS'&&exe.bytes===0?'FAIL':executableStatus,exe?.reason||'EXECUTABLE_EVIDENCE_MISSING',exe);
    add('B',engine+' execute access',!exe?'UNKNOWN':exe.status==='BLOCKED'?'BLOCKED':exe.executeAccess||'UNKNOWN','STATIC_ACCESS_ONLY');
    if(engine==='chromium')add('B','Chromium executablePath candidate distinct from headless shell',identityStatus(b.executablePathCandidate),'CANDIDATE_NOT_LAUNCH_IDENTITY',b.executablePathCandidate);
    eq('B',engine+' requested cache revision',b.revision,FIXED.revisions[engine]);
    const chain=b.launchChain;
    add('B',engine+' real launch chain',!anchor||!chain||!['mappingSha256','executableSha256'].every(k=>/^[a-f0-9]{64}$/.test(anchor[k]))?'UNKNOWN':chain.mappingSha256!==anchor.mappingSha256||exe?.sha256!==anchor.executableSha256?'FAIL':executableStatus==='PASS'&&exe.bytes>0&&chain.complete===true&&chain.fallback===false&&chain.entrypointSha256===exe?.sha256?'PASS':'UNKNOWN',!chain?'HEADLESS_SHELL_OR_WRAPPER_TARGET_UNPROVEN':'STATIC_CHAIN_REQUIRES_INDEPENDENT_ANCHOR');
    const libs=b.libraries;
    const completeLibraries=libs?.coverage==='complete-static'&&Array.isArray(libs.missing)&&Array.isArray(libs.required)&&Array.isArray(libs.resolved)&&identityStatus(libs.loaderIdentity)==='PASS'&&libs.required.every(name=>typeof name==='string'&&libs.resolved.some(r=>r.name===name&&identityStatus(r)==='PASS'));
    add('D',engine+' libraries and loader',!libs?'UNKNOWN':libs.missing?.length?'BLOCKED':libs.status==='PASS'&&!completeLibraries?'UNKNOWN':libs.status||'UNKNOWN',libs?.reason||'LIBRARY_EVIDENCE_MISSING',libs);
  }
  const output=facts.output,outputStatus=output?.status==='PASS'?Number.isSafeInteger(output.freeBytes)?output.freeBytes>=MIN_FREE?'PASS':'BLOCKED':'UNKNOWN':output?.status||'UNKNOWN';
  add('F','new evidence destination',outputStatus,output?.reason||'OUTPUT_EVIDENCE_MISSING',output);
  const plan=facts.plan;
  const planOK=plan&&JSON.stringify(plan.slots)===JSON.stringify(SLOTS)&&plan.attemptsPerSlot===1&&plan.retries===0&&plan.actionTimeoutMs===30000&&plan.wallMs===180000&&plan.maxBuffer===16777216&&plan.evidenceBudgetBytes===300*1024**2&&Array.isArray(plan.executions)&&plan.executions.length===4&&plan.executions.every((r,i)=>r.slot===SLOTS[i]&&r.executions===0&&r.status==='NOT_TESTED');
  add('F','fixed four-slot plan',planOK?'PASS':plan?'FAIL':'UNKNOWN',planOK?'PLAN_ONLY_ZERO_EXECUTIONS':'PLAN_MISMATCH_OR_MISSING');
  const review=facts.review,reviewAnchor=anchors.review;
  add('F','independent pre-execution review',!review||!reviewAnchor?'BLOCKED':!reviewAnchor.reference||!/^[a-f0-9]{64}$/.test(reviewAnchor.scriptSha256)?'UNKNOWN':review.scriptSha256===reviewAnchor.scriptSha256&&review.scriptSha256===facts.preflight?.sha256&&review.reference===reviewAnchor.reference?'PASS':'FAIL','REVIEW_MUST_PIN_INSPECTED_PREFLIGHT_NOT_P3_REVIEW');
  return {schema:1,kind:'OFFLINE_PREFLIGHT',createdAt:facts.createdAt,overall:aggregate(checks),groups:Object.fromEntries(['A','B','C','D','E','F'].map(g=>[g,aggregate(checks.filter(c=>c.group===g))])),browsers:Object.fromEntries(['chromium','webkit'].map(e=>[e,aggregate(checks.filter(c=>!/^(chromium|webkit)/i.test(c.item)||c.item.toLowerCase().startsWith(e)))])),checks,slots:SLOTS.map(slot=>({slot,executions:0,status:'NOT_TESTED'})),diagnostic:'NOT_TESTED',rootCause:'UNKNOWN',executionAuthorized:false,launchSuccess:'UNKNOWN',preservation:{localReadback:'PENDING',externalReacquisition:'NOT_VERIFIED',complete:false},facts};
}
function save(root, output, report) {
  // Recheck after inspection, reserve atomically, and never follow a replacement path.
  const ready=checkOutput(root,output);if(ready.status!=='PASS')throw Object.assign(Error(ready.reason),{code:ready.reason});
  fs.mkdirSync(output);const file=path.join(output,'preflight.json'),data=Buffer.from(JSON.stringify(report,null,2)+'\n');
  const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const readback=fs.readFileSync(file);if(!readback.equals(data))throw Error('EVIDENCE_READBACK_MISMATCH');
  const manifest={kind:'POST_CREATED_LOCAL_EVIDENCE_NOT_ACTIONS_ARTIFACT',file:'preflight.json',bytes:readback.length,sha256:sha(readback),localReadback:'VERIFIED',externalReacquisition:'NOT_VERIFIED',preservationComplete:false};
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});return manifest;
}
function main(args) {
  const allowed=new Set(['--root','--output','--dependencies','--browser-cache','--chromium-archive','--webkit-archive']),options={};
  if(args.length%2)throw Error('EXPECTED_OPTION_VALUE_PAIRS');
  for(let i=0;i<args.length;i+=2){if(!allowed.has(args[i])||Object.hasOwn(options,args[i])||!args[i+1])throw Error('UNKNOWN_OR_DUPLICATE_OPTION');options[args[i]]=path.resolve(args[i+1]);}
  if(!options['--output'])throw Error('NEW_OUTPUT_REQUIRED');
  const root=options['--root']||path.resolve(__dirname,'..'),output=options['--output'];
  const facts=collect(root,{output,dependencies:options['--dependencies'],browserCache:options['--browser-cache'],archives:{chromium:options['--chromium-archive'],webkit:options['--webkit-archive']}}),report=assess(facts);
  if(facts.output.status!=='PASS') {console.log(JSON.stringify(report));return 1;}
  save(root,output,report);console.log(JSON.stringify({overall:report.overall,groups:report.groups,browsers:report.browsers,slots:report.slots,executionAuthorized:false}));return report.overall==='PASS'?0:1;
}
module.exports={FIXED,SLOTS,MIN_FREE,sha,blob,crc32,inspectZip,fileIdentity,archiveIdentity,peImports,libraries,checkOutput,collect,assess,save,main,aggregate};
if(require.main===module){try{process.exitCode=main(process.argv.slice(2));}catch(e){console.error(JSON.stringify({overall:'BLOCKED',reason:errorCode(e),executionAuthorized:false,diagnostic:'NOT_TESTED'}));process.exitCode=1;}}
