'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const classify=require('./classify.cjs');
test('sealing hashes original bytes and refuses a detected token',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'chart-stage2-seal-'));const body='synthetic evidence\n';fs.writeFileSync(path.join(root,'result.log'),body);
  let result=spawnSync(process.execPath,[path.join(__dirname,'seal.cjs'),root],{encoding:'utf8'});assert.equal(result.status,0);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'SHA256-manifest.json'),'utf8'));assert.equal(manifest.files[0].sha256,crypto.createHash('sha256').update(body).digest('hex'));
  const unsafe=fs.mkdtempSync(path.join(os.tmpdir(),'chart-stage2-seal-'));fs.writeFileSync(path.join(unsafe,'test.log'),'gh'+'p_'+'x'.repeat(36));
  result=spawnSync(process.execPath,[path.join(__dirname,'seal.cjs'),unsafe],{encoding:'utf8'});assert.equal(result.status,1);assert.equal(JSON.parse(fs.readFileSync(path.join(unsafe,'SHA256-manifest.json'),'utf8')).unsafe,1);
});
test('timeout, spawn and test failure remain distinct',()=>{
  assert.equal(classify({reason:'outer_timeout',code:null}),'outer_timeout');assert.equal(classify({spawnError:'x'}),'spawn_failure');assert.equal(classify({code:1}),'test_or_diagnostic_failure');assert.equal(classify({code:0}),'passed');
});
