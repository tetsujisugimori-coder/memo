'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
test('analysis detects sequence gap and verifies raw bytes',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'chart-stage2-analysis-'));fs.mkdirSync(path.join(root,'run','process'),{recursive:true});
  const payload={documentId:'doc',timeOrigin:1000,events:[{seq:1,t:1,kind:'focusin'},{seq:3,t:3,kind:'input',target:{value:'Infinity',row:{chartItemIndex:'1'},data:{chartSeriesIndex:'0'}}},{seq:4,t:4,kind:'click',target:{row:{chartItemIndex:'1'}},state:{}}]};
  const raw=JSON.stringify({pageId:1,type:'batch',payload})+'\n'+JSON.stringify({pageId:1,type:'batch',payload:{documentId:'doc2',timeOrigin:2000,events:[{seq:1,t:1,kind:'click',target:{row:{chartItemIndex:'1'}},state:{}}]}})+'\n';const log='run/process/events.jsonl';fs.writeFileSync(path.join(root,log),raw);fs.writeFileSync(path.join(root,'plan.json'),'{}');
  const item={path:log,bytes:Buffer.byteLength(raw),sha256:crypto.createHash('sha256').update(raw).digest('hex')};fs.writeFileSync(path.join(root,'SHA256-manifest.json'),JSON.stringify({unsafe:0,unscanned:0,files:[item]}));
  const run=()=>spawnSync(process.execPath,[path.join(__dirname,'analyze.cjs'),root],{encoding:'utf8'});let result=run();assert.equal(result.status,0);let out=JSON.parse(result.stdout);assert.equal(out.documents[0].gaps,1);assert.equal(out.documents[0].targetWindows.length,1);assert.equal(out.documents[0].itemMoveClickWindows[0].anyInfinityInputInLimitedWindow,true);assert.equal(out.documents[1].itemMoveClickWindows[0].anyInfinityInputInLimitedWindow,false);assert.equal(out.documents[0].tail,'UNKNOWN');
  fs.appendFileSync(path.join(root,log),'x');result=run();assert.equal(result.status,1);out=JSON.parse(result.stdout);assert.deepEqual(out.hash.mismatches,[log]);
});
