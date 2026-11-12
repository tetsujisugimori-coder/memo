'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('timeout path must not retain the legacy success predicate',()=>{
  const s=fs.readFileSync(path.join(__dirname,'controller.cjs'),'utf8');
  assert.doesNotMatch(s,/done&&!overflow&&stage==='sigterm'&&after\.length===0/);
});
test('controller refuses execution before spawning any child',()=>{
  const s=fs.readFileSync(path.join(__dirname,'controller.cjs'),'utf8');assert.ok(s.indexOf("throw Error('BLOCKED:")<s.indexOf('const child=fork('));
  const r=spawnSync(process.execPath,[path.join(__dirname,'controller.cjs'),'A','unused'],{encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/BLOCKED/);assert.equal(fs.existsSync('unused'),false);
});
test('malformed JSON evidence must fail closed without deleting the original',()=>{
  const dir=fs.mkdtempSync(path.join(process.cwd(),'stage4-red-'));const source=path.join(dir,'broken.json');fs.writeFileSync(source,'{broken');
  try{const r=spawnSync(process.execPath,[path.join(__dirname,'seal.cjs'),dir],{encoding:'utf8'});assert.notEqual(r.status,0);assert.equal(fs.readFileSync(source,'utf8'),'{broken');}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
