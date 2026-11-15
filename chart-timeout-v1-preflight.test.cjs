'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {FIXED,SLOTS,MIN_FREE,sha,inspectZip,fileIdentity,archiveIdentity,checkOutput,collect,assess,save,main,peImports,libraries}=require('./scripts/chart-timeout-v1-preflight.cjs');
const controls=[];
// Explicit synthetic independent anchors: never used by the CLI/real collector.
function normal() {
  const digest='a'.repeat(64),route='b'.repeat(64),mapping='c'.repeat(64),script='d'.repeat(64);
  const anchors={packages:{treeSha256:digest,reference:'synthetic independent package inventory'},review:{scriptSha256:script,reference:'synthetic independent review'}};
  const facts={createdAt:'2026-11-15T00:00:00.000Z',preflight:{sha256:script},source:{head:FIXED.head,tree:FIXED.tree,sha256:FIXED.source,lockSha256:FIXED.lock,workingLock:{status:'PASS',sha256:FIXED.lock,bytes:44319}},diagnostic:{runners:{}},dependencies:{expectedVersion:FIXED.playwright,lockedCoreVersion:FIXED.playwright,playwright:{version:FIXED.playwright},'playwright-core':{version:FIXED.playwright},layoutMatches:true,mismatches:[],missing:[],browsersJSON:{revisions:{...FIXED.revisions}},packageProof:{treeSha256:digest}},environment:{platform:'linux',arch:'x64',node:'v22.23.4'},browsers:{},output:{status:'PASS',reason:'NEW_PATH_AND_CAPACITY',freeBytes:MIN_FREE},plan:{slots:[...SLOTS],attemptsPerSlot:1,retries:0,actionTimeoutMs:30000,wallMs:180000,maxBuffer:16777216,evidenceBudgetBytes:300*1024**2,executions:SLOTS.map(slot=>({slot,executions:0,status:'NOT_TESTED'}))},review:{scriptSha256:script,reference:anchors.review.reference}};
  for(const [file,expected]of Object.entries(FIXED.blobs))facts.diagnostic[file]={blob:expected,workingMatches:true};
  for(const scenario of ['legacy','narrow'])facts.diagnostic.runners[scenario]={...FIXED.runners[scenario],targetCount:1,fallbackAbsent:true};
  for(const engine of ['chromium','webkit']) {
    anchors[engine]={url:`https://cdn.playwright.dev/synthetic/${engine}.zip`,reference:'synthetic independently pinned distribution record',archiveSha256:digest,archiveBytes:100,routeSha256:route,mappingSha256:mapping,executableSha256:digest};
    facts.browsers[engine]={revision:FIXED.revisions[engine],archive:{status:'PASS',bytes:100,sha256:digest,structure:{status:'PASS',reason:'CRC_VERIFIED',entries:1,unpackedBytes:100}},acquisition:{url:anchors[engine].url,routeSha256:route},executable:{status:'PASS',sha256:digest,bytes:100,executeAccess:'PASS'},executablePathCandidate:{status:'PASS',sha256:digest,bytes:100},launchChain:{mappingSha256:mapping,entrypointSha256:digest,complete:true,fallback:false},libraries:{status:'PASS',coverage:'complete-static',required:['libfixture.so'],resolved:[{name:'libfixture.so',status:'PASS',sha256:digest,bytes:100}],loaderIdentity:{status:'PASS',sha256:digest,bytes:100},missing:[]}};
  }
  return {facts,anchors};
}
function recordControl(name,mutate,group,item,want) {
  test(name,()=>{const {facts,anchors}=normal();mutate(facts,anchors);const report=assess(facts,anchors),check=report.checks.find(c=>c.group===group&&c.item===item);assert.ok(check);assert.equal(check.status,want);assert.notEqual(report.overall,'PASS');assert.equal(report.diagnostic,'NOT_TESTED');assert.ok(report.slots.every(r=>r.executions===0&&r.status==='NOT_TESTED'));controls.push({name,kind:'SYNTHETIC_FAULT_CONTROL_NOT_BROWSER_EVIDENCE',report});});
}
test('normal synthetic fixed evidence is accepted without executing any slot',()=>{
  const {facts,anchors}=normal(),report=assess(facts,anchors);assert.equal(report.overall,'PASS');assert.ok(report.checks.every(r=>r.status==='PASS'));assert.equal(report.executionAuthorized,false);assert.equal(report.launchSuccess,'UNKNOWN');assert.deepEqual(report.slots,SLOTS.map(slot=>({slot,executions:0,status:'NOT_TESTED'})));controls.push({name:'normal',kind:'SYNTHETIC_NORMAL_CONTROL_NOT_BROWSER_EVIDENCE',report});
});
recordControl('missing browser executable blocks',f=>{f.browsers.chromium.executable={status:'BLOCKED',reason:'ENOENT'};},'B','chromium executable bytes','BLOCKED');
recordControl('wrong browser SHA256 rejects',f=>{f.browsers.chromium.executable.sha256='e'.repeat(64);},'B','chromium real launch chain','FAIL');
recordControl('wrong archive SHA256 rejects',f=>{f.browsers.webkit.archive.sha256='e'.repeat(64);},'A','webkit provenance and expected archive digest','FAIL');
recordControl('Playwright revision mismatch rejects',f=>{f.dependencies.browsersJSON.revisions.webkit='2248';},'C','webkit declared revision','FAIL');
recordControl('headless shell revision independently checked',f=>{f.dependencies.browsersJSON.revisions['chromium-headless-shell']='1194';},'C','chromium-headless-shell declared revision','FAIL');
recordControl('fixed raw lock mismatch rejects',f=>{f.source.workingLock.sha256='e'.repeat(64);},'C','working-lock-bytes','FAIL');
recordControl('placed Playwright mismatch rejects',f=>{f.dependencies.playwright.version='1.56.1';},'C','playwright installed version','FAIL');
recordControl('installed dependency lock mismatch rejects',f=>{f.dependencies.mismatches=['node_modules/jose'];},'C','installed lock and package versions','FAIL');
recordControl('missing dependency blocks',f=>{f.dependencies.missing=['node_modules/playwright-core'];},'C','installed lock and package versions','BLOCKED');
recordControl('missing shared library blocks',f=>{f.browsers.webkit.libraries.missing=['libMissing.so'];},'D','webkit libraries and loader','BLOCKED');
recordControl('direct libraries alone never imply complete closure',f=>{f.browsers.chromium.libraries.coverage='direct-only';},'D','chromium libraries and loader','UNKNOWN');
recordControl('missing source of acquisition stays UNKNOWN',(f,a)=>{delete a.webkit;},'A','webkit provenance and expected archive digest','UNKNOWN');
recordControl('matching local hash without acquisition route stays UNKNOWN',f=>{f.browsers.chromium.acquisition=null;},'A','chromium provenance and expected archive digest','UNKNOWN');
recordControl('incomplete trust anchor stays UNKNOWN',(_f,a)=>{delete a.chromium.routeSha256;},'A','chromium provenance and expected archive digest','UNKNOWN');
recordControl('nonofficial distribution URL stays UNKNOWN',(f,a)=>{a.chromium.url=f.browsers.chromium.acquisition.url='https://untrusted.example/archive.zip';},'A','chromium provenance and expected archive digest','UNKNOWN');
recordControl('corrupt archive rejects',f=>{f.browsers.chromium.archive.structure={status:'FAIL',reason:'ZIP_CRC_OR_SIZE'};},'A','chromium archive structure and CRC','FAIL');
recordControl('unknown launch destination cannot pass',f=>{f.browsers.webkit.launchChain=null;},'B','webkit real launch chain','UNKNOWN');
recordControl('fallback chain cannot pass',f=>{f.browsers.chromium.launchChain.fallback=true;},'B','chromium real launch chain','UNKNOWN');
recordControl('missing evidence is UNKNOWN not NOT_TESTED',f=>{delete f.browsers.webkit.archive;},'A','webkit retained archive','UNKNOWN');
recordControl('fixed source drift rejects',f=>{f.source.sha256='e'.repeat(64);},'E','sha256','FAIL');
recordControl('diagnostic version drift rejects',f=>{f.diagnostic['scripts/chart-timeout-v1.cjs'].blob='e'.repeat(40);},'E','scripts/chart-timeout-v1.cjs Git blob','FAIL');
recordControl('observer worktree drift rejects',f=>{f.diagnostic['scripts/chart-timeout-v1-observer.cjs'].workingMatches=false;},'E','scripts/chart-timeout-v1-observer.cjs worktree','FAIL');
recordControl('ambiguous generated target rejects',f=>{f.diagnostic.runners.legacy.targetCount=2;},'E','generated legacy','FAIL');
recordControl('capacity shortage blocks',f=>{f.output={status:'BLOCKED',reason:'INSUFFICIENT_CAPACITY'};},'F','new evidence destination','BLOCKED');
recordControl('nonzero slot executions reject the preflight contract',f=>{f.plan.executions[0].executions=1;},'F','fixed four-slot plan','FAIL');
recordControl('automatic retry in plan rejects',f=>{f.plan.retries=1;},'F','fixed four-slot plan','FAIL');
recordControl('timeout drift in plan rejects',f=>{f.plan.actionTimeoutMs=60000;},'F','fixed four-slot plan','FAIL');
recordControl('P3 review is not a new pre-execution review',f=>{f.review=null;},'F','independent pre-execution review','BLOCKED');
recordControl('review of another preflight cannot pass',f=>{f.review.scriptSha256='e'.repeat(64);},'F','independent pre-execution review','FAIL');
recordControl('executable digest missing cannot pass',f=>{delete f.browsers.chromium.executable.sha256;},'B','chromium executable bytes','UNKNOWN');
recordControl('archive byte size missing cannot pass',f=>{delete f.browsers.webkit.archive.bytes;},'A','webkit retained archive','UNKNOWN');
recordControl('archive digest missing cannot pass',f=>{delete f.browsers.webkit.archive.sha256;},'A','webkit retained archive','UNKNOWN');
recordControl('CRC measurements missing cannot pass',f=>{delete f.browsers.webkit.archive.structure.entries;},'A','webkit archive structure and CRC','UNKNOWN');
recordControl('library closure measurements missing cannot pass',f=>{delete f.browsers.webkit.libraries.resolved;},'D','webkit libraries and loader','UNKNOWN');
recordControl('capacity measurements missing cannot pass',f=>{delete f.output.freeBytes;},'F','new evidence destination','UNKNOWN');
recordControl('runner digest drift rejects',f=>{f.diagnostic.runners.legacy.sha256='e'.repeat(64);},'E','generated legacy','FAIL');
test('engine eligibility includes common fixed lock and source gates',()=>{const {facts,anchors}=normal();facts.source.workingLock.sha256='e'.repeat(64);const r=assess(facts,anchors);assert.equal(r.browsers.chromium,'FAIL');assert.equal(r.browsers.webkit,'FAIL');});
test('real CLI has no approved anchors; caller facts cannot elevate authenticity',()=>{const {facts}=normal(),r=assess(facts);assert.notEqual(r.overall,'PASS');assert.equal(r.checks.find(c=>c.item==='chromium provenance and expected archive digest').status,'UNKNOWN');});
function zip() {
  // Known independent CRC32("hello") = 0x3610a686, stored ZIP, one entry.
  const name=Buffer.from('hello.txt'),data=Buffer.from('hello'),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt32LE(0x3610a686,14);local.writeUInt32LE(5,18);local.writeUInt32LE(5,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt32LE(0x3610a686,16);central.writeUInt32LE(5,20);central.writeUInt32LE(5,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+data.length,16);
  return Buffer.concat([local,name,data,central,name,end]);
}
test('valid archive CRC is accepted; corrupt payload and truncated archive reject',()=>{
  assert.equal(inspectZip(zip()).status,'PASS');const broken=zip();broken[39]^=1;assert.equal(inspectZip(broken).status,'FAIL');assert.equal(inspectZip(zip().subarray(0,-22)).status,'FAIL');assert.equal(inspectZip(Buffer.from('not a zip')).status,'FAIL');
});
test('archive local header CRC and sizes cannot disagree with central directory',()=>{
  for(const offset of [14,18,22]){const b=zip();b[offset]^=1;const r=inspectZip(b);assert.equal(r.status,'FAIL');assert.equal(r.reason,'ZIP_LOCAL_CRC_OR_SIZE');}
});
test('deflated and data-descriptor archives retain independent CRC/size checks',()=>{
  const zlib=require('node:zlib'),stored=zip(),data=zlib.deflateRawSync(Buffer.from('hello')),local=Buffer.from(stored.subarray(0,39)),central=Buffer.from(stored.subarray(44,-22)),end=Buffer.from(stored.subarray(-22));
  local.writeUInt16LE(8,8);local.writeUInt32LE(data.length,18);central.writeUInt16LE(8,10);central.writeUInt32LE(data.length,20);end.writeUInt32LE(local.length+data.length,16);
  assert.equal(inspectZip(Buffer.concat([local,data,central,end])).status,'PASS');
  const descriptor=Buffer.alloc(16);descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(0x3610a686,4);descriptor.writeUInt32LE(data.length,8);descriptor.writeUInt32LE(5,12);
  local.writeUInt16LE(8,6);local.fill(0,14,26);central.writeUInt16LE(8,8);end.writeUInt32LE(local.length+data.length+descriptor.length,16);
  assert.equal(inspectZip(Buffer.concat([local,data,descriptor,central,end])).status,'PASS');descriptor[4]^=1;
  assert.equal(inspectZip(Buffer.concat([local,data,descriptor,central,end])).status,'FAIL');
});
test('unsupported encrypted archive stays UNKNOWN',()=>{const b=zip();b.writeUInt16LE(1,6);b.writeUInt16LE(1,44+8);assert.equal(inspectZip(b).status,'UNKNOWN');});
function temporary(fn) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'memo-preflight-test-'));try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
function capacity(fn,free=MIN_FREE+1024**3) {const previous=fs.statfsSync;fs.statfsSync=()=>({bavail:free,bsize:1});try{return fn();}finally{fs.statfsSync=previous;}}
test('file absence and broken symlink are separately detected without execution',()=>temporary(dir=>{
  assert.equal(fileIdentity(path.join(dir,'absent')).status,'BLOCKED');
  const target=path.join(dir,'target'),link=path.join(dir,'link');fs.mkdirSync(target);fs.symlinkSync(target,link,'junction');fs.rmdirSync(target);
  const result=fileIdentity(path.join(link,'browser'));assert.equal(result.status,'BLOCKED');assert.equal(result.reason,'BROKEN_SYMLINK');
}));
test('retained file identity and CRC are measured, not inferred from marker files',()=>temporary(dir=>{
  const file=path.join(dir,'archive.zip');fs.writeFileSync(file,zip());const r=archiveIdentity(file,[]);assert.equal(r.sha256,sha(zip()));assert.equal(r.bytes,zip().length);assert.equal(r.structure.status,'PASS');assert.equal(archiveIdentity(null).status,'UNKNOWN');
}));
test('archive hash and structure must describe the same bytes',()=>temporary(dir=>{
  const file=path.join(dir,'archive.zip');fs.writeFileSync(file,zip());const original=fs.readFileSync;
  fs.readFileSync=function(p,...args){const value=original.call(this,p,...args);if(p===file){const changed=Buffer.from(value);changed[39]^=1;return changed;}return value;};
  try{const r=archiveIdentity(file,[]);assert.equal(r.status,'FAIL');assert.equal(r.reason,'ARCHIVE_CHANGED_BETWEEN_READS');}finally{fs.readFileSync=original;}
}));
test('existing evidence and dangling output links are refused unchanged',()=>temporary(dir=>capacity(()=>{
  const output=path.join(dir,'evidence');fs.mkdirSync(output);const file=path.join(output,'existing.txt');fs.writeFileSync(file,'KEEP');assert.equal(checkOutput(dir,output).reason,'OUTPUT_EXISTS');
  assert.throws(()=>save(dir,output,{}),/OUTPUT_EXISTS/);assert.equal(fs.readFileSync(file,'utf8'),'KEEP');
  fs.symlinkSync(path.join(dir,'missing'),path.join(dir,'dangling'),'junction');assert.equal(checkOutput(dir,path.join(dir,'dangling')).reason,'OUTPUT_EXISTS');
})));
test('outside root, linked parent and insufficient capacity cannot qualify',()=>temporary(dir=>capacity(()=>{
  assert.equal(checkOutput(dir,path.join(path.dirname(dir),'outside')).status,'BLOCKED');
  const target=path.join(dir,'real');fs.mkdirSync(target);fs.symlinkSync(target,path.join(dir,'link'),'junction');assert.equal(checkOutput(dir,path.join(dir,'link','out')).reason,'OUTPUT_SYMLINK');
  capacity(()=>assert.equal(checkOutput(dir,path.join(dir,'out')).reason,'INSUFFICIENT_CAPACITY'),MIN_FREE-1);
})));
test('new evidence is exclusively saved and read back; external preservation remains unverified',()=>temporary(dir=>capacity(()=>{
  const output=path.join(dir,'new'),{facts,anchors}=normal(),report=assess(facts,anchors),manifest=save(dir,output,report),b=fs.readFileSync(path.join(output,'preflight.json'));
  assert.equal(sha(b),manifest.sha256);assert.equal(b.length,manifest.bytes);assert.equal(manifest.preservationComplete,false);assert.equal(manifest.externalReacquisition,'NOT_VERIFIED');assert.throws(()=>save(dir,output,report),/OUTPUT_EXISTS/);
})));
test('PE malformed bytes are rejected without trying to execute them',()=>assert.throws(()=>peImports(Buffer.from('not executable')),/PE_HEADER/));
test('static PE import parsing detects an unavailable DLL without loading it',()=>temporary(dir=>{
  const b=Buffer.alloc(1024),pe=64,opt=pe+24,section=opt+240;b.write('MZ');b.writeUInt32LE(pe,0x3c);b.writeUInt32LE(0x4550,pe);b.writeUInt16LE(1,pe+6);b.writeUInt16LE(240,pe+20);b.writeUInt16LE(0x20b,opt);b.writeUInt32LE(0x1000,opt+120);b.writeUInt32LE(0x1000,section+12);b.writeUInt32LE(512,section+16);b.writeUInt32LE(512,section+20);b.writeUInt32LE(0x1040,512+12);b.write('missing-preflight-fixture.dll\0',576);
  assert.deepEqual(peImports(b),['missing-preflight-fixture.dll']);const file=path.join(dir,'fixture.exe');fs.writeFileSync(file,b);const r=libraries(fileIdentity(file),[],'win32');assert.equal(r.status,'BLOCKED');assert.deepEqual(r.missing,['missing-preflight-fixture.dll']);
}));
test('static ELF inspection detects missing loader/library using only reader commands',()=>temporary(dir=>{
  const original=cp.spawnSync,loader=path.join(dir,'loader'),file=path.join(dir,'fixture');fs.writeFileSync(file,'fixture');
  cp.spawnSync=(command,args)=>{assert.ok(['/usr/bin/readelf','/sbin/ldconfig'].includes(command));return {status:0,stdout:command.endsWith('readelf')?`[Requesting program interpreter: ${loader}]\n(NEEDED) Shared library: [libmissing-preflight-fixture.so]`:''};};
  try {assert.equal(libraries(fileIdentity(file),[],'linux',false).status,'BLOCKED');fs.writeFileSync(loader,'fixture loader data');const r=libraries(fileIdentity(file),[],'linux',false);assert.equal(r.status,'BLOCKED');assert.deepEqual(r.missing,['libmissing-preflight-fixture.so']);}finally{cp.spawnSync=original;}
}));
test('CLI rejects execute/install/retry and arbitrary facts ingestion flags',()=>{for(const flag of ['--execute','--install','--retry','--facts'])assert.throws(()=>main([flag,'value']),/UNKNOWN_OR_DUPLICATE_OPTION/);});
test('collector never runs browsers or installed package code, and preserves missing-history state',()=>temporary(dir=>capacity(()=>{
  const original=cp.spawnSync,commands=[];cp.spawnSync=(command,args)=>{commands.push([command,args]);assert.equal(command,'git');return {status:1,stdout:Buffer.alloc(0)};};
  try{const facts=collect(dir,{output:path.join(dir,'out'),browserCache:path.join(dir,'cache')});assert.ok(commands.length>0);assert.equal(facts.browsers.chromium.executable.status,'BLOCKED');assert.equal(facts.environment.launchSuccess,'UNKNOWN');const r=assess(facts);assert.notEqual(r.overall,'PASS');assert.equal(r.checks.find(c=>c.item==='head').status,'UNKNOWN');}finally{cp.spawnSync=original;}
})));
test('fixed commit identity requires an existing commit object, not literal SHA echo',()=>temporary(dir=>capacity(()=>{
  const original=cp.spawnSync;let first=true;
  cp.spawnSync=(command,args)=>{assert.equal(command,'git');if(first){assert.deepEqual(args,['rev-parse','--verify',FIXED.head+'^{commit}']);first=false;}return {status:1,stdout:Buffer.alloc(0)};};
  try{const r=assess(collect(dir,{output:path.join(dir,'out'),browserCache:path.join(dir,'cache')}));assert.equal(r.checks.find(c=>c.item==='head').status,'UNKNOWN');}finally{cp.spawnSync=original;}
})));
test.after(()=>{
  if(!process.env.CHART_PREFLIGHT_CONTROLS)return;
  const out=path.resolve(process.env.CHART_PREFLIGHT_CONTROLS);fs.mkdirSync(out);
  for(const [name,rows]of [['normal-controls.json',controls.filter(c=>c.name==='normal')],['fault-controls.json',controls.filter(c=>c.name!=='normal')]])fs.writeFileSync(path.join(out,name),JSON.stringify(rows,null,2)+'\n',{flag:'wx'});
});
