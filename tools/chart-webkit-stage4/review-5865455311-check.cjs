'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createState}=require('./safety.cjs'),{createPreflush}=require('./preflush.cjs'),{scan,verifyManifest}=require('./seal.cjs');
test('preflush must wait for asynchronous send completion before proceeding',()=>{
  const state=createState('B');let callback,proceeded=0;const p=createPreflush({state,send:(_,cb)=>{callback=cb;},stop:()=>{},proceed:()=>proceeded++});
  p.request('f1');p.receive({requestId:'f1',ok:true});assert.equal(proceeded,0);callback(Error('send failed'));assert.equal(proceeded,0);assert.equal(state.result().procedure,'FAIL');
});
test('successful callback and response may arrive in either order',()=>{
  for(const responseFirst of [true,false]){const state=createState('B');let callback,proceeded=0;const p=createPreflush({state,send:(_,cb)=>{callback=cb;},stop:()=>{},proceed:()=>proceeded++});p.request('f1');if(responseFirst)p.receive({requestId:'f1',ok:true});callback(null);if(!responseFirst)p.receive({requestId:'f1',ok:true});assert.equal(proceeded,1);assert.equal(state.result().preflush,true);}
});
test('async failure and responses during stopping cannot proceed',()=>{
  const state=createState('B');let callback,proceeded=0;const p=createPreflush({state,send:(_,cb)=>{callback=cb;},stop:()=>{},proceed:()=>proceeded++});p.request('f1');callback(Error('late failure'));p.receive({requestId:'f1',ok:true});assert.equal(proceeded,0);assert.equal(state.result().procedure,'FAIL');
});
test('response during stopping is rejected',()=>{const state=createState('B');let p,stops=0,proceeded=0;p=createPreflush({state,send:()=>{},stop:()=>{if(++stops===1)p.receive({requestId:'f1',ok:true});},proceed:()=>proceeded++});p.request('f1');p.timeout();assert.equal(proceeded,0);assert.equal(state.result().procedure,'FAIL');});
test('limited screen pass still denies publication',()=>{const dir=fs.mkdtempSync(path.join(process.cwd(),'stage4-review-'));try{fs.writeFileSync(path.join(dir,'dummy.log'),'ordinary dummy');const result=verifyManifest(dir,scan(dir));assert.equal(result.integrity,'PASS');assert.equal(result.screen,'PASS');assert.equal(result.publicUpload,'DENY');}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('matching hash and secret screen failure must deny public upload',()=>{
  const dir=fs.mkdtempSync(path.join(process.cwd(),'stage4-review-'));try{fs.writeFileSync(path.join(dir,'dummy.log'),'test@example.test');const manifest=scan(dir);const result=verifyManifest(dir,manifest);assert.equal(result.integrity,'PASS');assert.equal(result.screen,'FAIL');assert.equal(result.publicUpload,'DENY');assert.equal(result.privateStorage,'BLOCKED');assert.equal(result.durableStorage,'BLOCKED');assert.equal('ok' in result,false);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('missing, malformed, changed, or missing files do not pass integrity',()=>{const dir=fs.mkdtempSync(path.join(process.cwd(),'stage4-review-'));try{const file=path.join(dir,'dummy.log');fs.writeFileSync(file,'dummy');const manifest=scan(dir);assert.equal(verifyManifest(dir,null).integrity,'FAIL');assert.equal(verifyManifest(dir,{files:[{path:'dummy.log',bytes:5,sha256:'bad'}]}).integrity,'FAIL');assert.equal(verifyManifest(dir,{files:[{...manifest.files[0],bytes:4}]}).integrity,'FAIL');fs.writeFileSync(file,'other');assert.equal(verifyManifest(dir,manifest).integrity,'FAIL');fs.unlinkSync(file);assert.notEqual(verifyManifest(dir,manifest).integrity,'PASS');}finally{fs.rmSync(dir,{recursive:true,force:true});}});
