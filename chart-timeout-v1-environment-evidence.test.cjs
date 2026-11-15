'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {compareLocks,lockBytes,parsePE,inspectPEGraph}=require('./scripts/chart-timeout-v1-environment-evidence.cjs');
const lock=Buffer.from(JSON.stringify({lockfileVersion:3,packages:{'node_modules/example':{version:'1.0.0',integrity:'sha512-fixture',resolved:'https://example.invalid/package.tgz'}}},null,2)+'\n');
test('normal raw fixed lock accepts, CRLF-only is proven but raw mismatch remains FAIL',()=>{
 assert.equal(compareLocks(lock,lock).rawStatus,'PASS');const changed=Buffer.from(lock.toString().replace(/\n/g,'\r\n')),r=compareLocks(lock,changed);
 assert.equal(r.rawStatus,'FAIL');assert.equal(r.lineEndingsOnly,true);assert.equal(r.jsonStructureSame,true);assert.equal(r.workingWasModified,false);assert.deepEqual(r.packageVersions,[]);assert.deepEqual(changed,Buffer.from(lock.toString().replace(/\n/g,'\r\n')));
});
test('BOM difference is separate from line endings',()=>{const r=compareLocks(lock,Buffer.concat([Buffer.from([239,187,191]),lock]));assert.equal(r.rawStatus,'FAIL');assert.equal(r.lineEndingsOnly,false);assert.equal(r.working.bom,true);assert.equal(r.jsonStructureSame,true);});
for(const field of ['version','integrity','resolved'])test('lock '+field+' drift cannot hide behind CRLF',()=>{
 const value=JSON.parse(lock);value.packages['node_modules/example'][field]='different';const r=compareLocks(lock,Buffer.from(JSON.stringify(value,null,2).replace(/\n/g,'\r\n')));assert.equal(r.lineEndingsOnly,false);assert.equal(r.jsonStructureSame,false);assert.equal(r[field==='version'?'packageVersions':field].length,1);
});
test('lockfile version, structure and encoding are independently checked',()=>{const v=JSON.parse(lock);v.lockfileVersion=2;assert.equal(compareLocks(lock,Buffer.from(JSON.stringify(v))).lockfileVersionSame,false);assert.throws(()=>lockBytes(Buffer.from([0xff])),/encoded data/);assert.throws(()=>lockBytes(Buffer.from('{}')),/LOCK_SCHEMA/);});
function pe({direct=true,delay=true}={}){
 const b=Buffer.alloc(2048),base=64,opt=88,s=328;b.write('MZ');b.writeUInt32LE(base,60);b.writeUInt32LE(0x4550,base);b.writeUInt16LE(0x8664,base+4);b.writeUInt16LE(1,base+6);b.writeUInt16LE(240,base+20);b.writeUInt16LE(0x20b,opt);b.writeBigUInt64LE(0x140000000n,opt+24);b.writeUInt32LE(512,opt+60);b.writeUInt32LE(16,opt+108);b.writeUInt32LE(0x1000,s+12);b.writeUInt32LE(1536,s+16);b.writeUInt32LE(512,s+20);
 if(direct){b.writeUInt32LE(0x1000,opt+120);b.writeUInt32LE(40,opt+124);b.writeUInt32LE(0x1180,512);b.writeUInt32LE(0x1100,524);b.write('normal-fixture.dll\0',768);b.writeBigUInt64LE(0x1200n,896);b.write('LoadLibraryW\0',1026);}
 if(delay){b.writeUInt32LE(0x1080,opt+112+104);b.writeUInt32LE(64,opt+112+108);b.writeUInt32LE(1,640);b.writeUInt32LE(0x1140,644);b.writeUInt32LE(0x11a0,656);b.write('delayed-fixture.dll\0',832);b.writeBigUInt64LE(0x1240n,928);b.write('SetDllDirectoryW\0',1090);}
 return b;
}
test('normal PE includes separate direct and delay-load dependencies without loading it',()=>{const r=parsePE(pe());assert.equal(r.status,'PASS');assert.equal(r.architecture,'x64');assert.equal(r.direct[0].name,'normal-fixture.dll');assert.equal(r.delayed[0].name,'delayed-fixture.dll');assert.deepEqual(r.dynamicSearchAPIs,['LoadLibraryW','SetDllDirectoryW']);assert.equal(r.loaderBehavior,'UNKNOWN');assert.equal(r.certificateTable.signatureVerified,false);});
test('same delay-only counterexample is captured while direct list stays empty',()=>{const r=parsePE(pe({direct:false}));assert.deepEqual(r.direct,[]);assert.deepEqual(r.delayed.map(d=>d.name),['delayed-fixture.dll']);});
test('PE module names include valid DRV/CPL modules without accepting a path',()=>{
 const b=pe({direct:false});for(const name of ['winspool.drv','bthprops.cpl']){b.fill(0,832,864);b.write(name+'\0',832);assert.equal(parsePE(b).delayed[0].name,name);}
 b.fill(0,832,864);b.write('../outside.dll\0',832);assert.throws(()=>parsePE(b),/PE_DLL_NAME/);
});
test('truncated PE, invalid RVA, descriptor and directory corruption reject',()=>{
 assert.throws(()=>parsePE(Buffer.from('MZ')),/PE_RANGE/);
 for(const mutate of [b=>b.writeUInt32LE(0xfffffff0,644),b=>b.writeUInt32LE(2,640),b=>b.writeUInt32LE(16,88+112+108),b=>b.writeUInt32LE(0,88+112+104)]){const b=pe();mutate(b);assert.throws(()=>parsePE(b),/PE_/);}
});
function temporary(fn){const d=fs.mkdtempSync(path.join(os.tmpdir(),'memo-env-evidence-'));try{return fn(d);}finally{fs.rmSync(d,{recursive:true,force:true});}}
test('transitive candidates are collected and absence in selected dirs remains UNKNOWN',()=>temporary(dir=>{
 const root=path.join(dir,'root.bin');fs.writeFileSync(root,pe());fs.writeFileSync(path.join(dir,'normal-fixture.dll'),pe({direct:false,delay:false}));
 const r=inspectPEGraph([root],[dir]);assert.equal(r.status,'UNKNOWN');assert.equal(r.nodes.length,2);assert.ok(r.edges.some(e=>e.name==='delayed-fixture.dll'&&e.reason==='NOT_FOUND_IN_INSPECTED_DIRECTORIES_NOT_GLOBAL_ABSENCE'));assert.equal(r.launchSuccess,'UNKNOWN');assert.equal(r.executionAuthorized,false);
}));
test('multiple candidates do not silently select one DLL',()=>temporary(dir=>{
 const second=path.join(dir,'second');fs.mkdirSync(second);const root=path.join(dir,'root.bin');fs.writeFileSync(root,pe({delay:false}));for(const p of [dir,second])fs.writeFileSync(path.join(p,'normal-fixture.dll'),pe({direct:false,delay:false}));const r=inspectPEGraph([root],[second]);assert.equal(r.edges[0].candidates.length,2);assert.equal(r.edges[0].status,'UNKNOWN');
}));
test('node/depth/read budgets keep incomplete graph UNKNOWN',()=>temporary(dir=>{const root=path.join(dir,'root.bin');fs.writeFileSync(root,pe());fs.writeFileSync(path.join(dir,'normal-fixture.dll'),pe());for(const options of [{maxNodes:1},{maxDepth:0},{maxBytes:1}]){const r=inspectPEGraph([root],[dir],options);assert.equal(r.limited,true);assert.equal(r.status,'UNKNOWN');}assert.throws(()=>inspectPEGraph([],[],{maxNodes:0}),/GRAPH_LIMITS/);}));
test('byte budget includes hashing IO and measured consumption matches actual reads',()=>temporary(dir=>{
 const root=path.join(dir,'root.bin');fs.writeFileSync(root,pe({direct:false,delay:false}));const original=fs.readSync;let actual=0;
 fs.readSync=function(...args){const n=original.apply(this,args);actual+=n;return n;};
 try{const stopped=inspectPEGraph([root],[dir],{maxBytes:1});assert.equal(actual,0,'no hashing read before budget gate');assert.equal(stopped.readBytes,actual);actual=0;const normal=inspectPEGraph([root],[dir],{maxBytes:2048});assert.equal(actual,2048);assert.equal(normal.readBytes,actual);assert.equal(normal.nodes[0].pe.status,'PASS');}finally{fs.readSync=original;}
}));
test('missing root is BLOCKED; no input is UNKNOWN, never PASS',()=>temporary(dir=>{assert.equal(inspectPEGraph([path.join(dir,'missing')],[]).status,'BLOCKED');assert.equal(inspectPEGraph([],[]).status,'UNKNOWN');}));
