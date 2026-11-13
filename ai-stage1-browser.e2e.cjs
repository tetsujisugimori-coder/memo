'use strict';
// Real app/DOM/HTTP, synthetic service only. No real Ollama, credentials, user profile or model downloads.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const playwright = require('playwright');
const {fixture,observe,PLAN} = require('./scripts/ai-stage1-validation.cjs');
const {importDiagnostics,auditApplication} = require('./scripts/ai-stage1-audit.cjs');
const engine = process.env.MEMO_NEXUS_E2E_BROWSER || 'chromium';
if (!['chromium','webkit'].includes(engine)) throw Error('unsupported_engine');
const root = __dirname, digest = b => crypto.createHash('sha256').update(b).digest('hex');
const files = ['index.html','app.js','style.css','ai-provider.js','ai-context.js','ai-prompts.js','ai-diagnostics.js','ollama-adapter.js','scripts/ai-stage1-validation.cjs','scripts/ai-stage1-audit.cjs','ai-stage1-browser.e2e.cjs'];
const hashes = () => Object.fromEntries(files.map(f => [f,digest(fs.readFileSync(path.join(root,f)))]));
const output = path.resolve(process.env.MEMO_AI_STAGE1_OUTPUT || path.join(os.tmpdir(),'memo-ai-stage1',`${process.platform}-${engine}`),`run-${crypto.randomUUID()}`);
const text = 'SYNTHETIC_ANSWER_5', thinking = 'SYNTHETIC_PRIVATE_THINKING';
const event = (content=text,done=true,thought='') => JSON.stringify({message:{content,thinking:thought},done})+'\n';
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function main() {
  fs.mkdirSync(output,{recursive:true});
  const report = {result:'INCOMPLETE',platform:process.platform,engine,browserVersion:'NOT_STARTED',transport:'SYNTHETIC_HTTP_SERVICE',realOllama:'NOT_TESTED',semanticCorrectness:'NOT_TESTED',humanVisibility:'NOT_TESTED',rootCause:'UNKNOWN',cases:[],source:hashes(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()};
  const requests=[], held=[], failures=[]; let mode='normal', server, context, browser, stage='listen';
  let clipboardCleared=false;
  async function scenario(name,fn) { stage=name;await fn();report.cases.push({name,result:'PASS'});console.log(`PASS ${name}`); }
  try {
    server=http.createServer((req,res)=>{
      const url=new URL(req.url,'http://localhost');
      if (req.method==='GET' && url.pathname==='/api/tags') {
        res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({models:[{name:'fixture-model',size:1},{name:'fixture-alt',size:1}]}));
      }
      if (req.method==='POST' && url.pathname==='/api/chat') {
        let body='';req.on('data',b=>{body+=b;if(Buffer.byteLength(body)>65536) req.destroy();});
        req.on('end',()=>{try {
          const request=JSON.parse(body);requests.push(request);
          if(requests.length>40) {res.writeHead(429);return res.end();}
          res.setHeader('Content-Type','application/x-ndjson');res.setHeader('Cache-Control','no-store');
          if(mode==='hold') {res.write(event('SYNTHETIC_OLD_PARTIAL',false));held.push(res);return;}
          if(mode==='empty') return res.end(event(''));
          if(mode==='thinking') return res.end(event('',true,thinking));
          if(mode==='missing-done') return res.end(event(text,false));
          if(mode==='http-error') {res.writeHead(500);return res.end('{}');}
          if(mode==='malformed') return res.end('{broken\n');
          res.write(event('SYNTHETIC_',false));setTimeout(()=>res.end(event('ANSWER_5',true,thinking)),15);
        } catch(_) {res.writeHead(400);res.end();}});return;
      }
      if(req.method!=='GET') {res.writeHead(405);return res.end();}
      let file;try {file=path.resolve(root,decodeURIComponent(url.pathname==='/'?'index.html':url.pathname.slice(1)));} catch(_) {res.writeHead(400);return res.end();}
      if(!file.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.ico','.woff','.woff2'].includes(path.extname(file))) {res.writeHead(403);return res.end();}
      fs.readFile(file,(e,b)=>{if(e){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(b);});
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const origin=`http://127.0.0.1:${server.address().port}`;
    stage='browser-launch';
    browser=await playwright[engine].launch({headless:true,...(process.env.MEMO_AI_CHROMIUM_EXECUTABLE && engine==='chromium'?{executablePath:process.env.MEMO_AI_CHROMIUM_EXECUTABLE}:{})});
    report.browserVersion=browser.version();
    context=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce',serviceWorkers:'block'});
    // Only the fresh context's clipboard is intercepted, not diagnostics, fetch, storage or app functions.
    await context.addInitScript(()=>{globalThis.__memoTestClipboard=null;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async v=>{globalThis.__memoTestClipboard=v;}}});});
    await context.route('**/*',route=>{
      if(new URL(route.request().url()).origin===origin) return route.continue();
      return route.fulfill({status:200,contentType:route.request().url().includes('.css')?'text/css':'application/javascript',body:''});
    });
    const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',()=>failures.push('PAGE_ERROR'));
    stage='app-startup';await page.goto(origin);await page.locator('#appStartupGuard').waitFor({state:'hidden'});
    await page.locator('#editor').fill('The blue bird sits by the window.');
    const noteBefore=await page.locator('#editor').inputValue();
    async function settings(model='fixture-model') {
      await page.locator('#settingsBtn').click();await page.locator('#settingsDialog').waitFor({state:'visible'});
      await page.locator('#aiEnabledInput').check();await page.locator('#aiBaseUrlInput').fill(origin);
      await page.locator('#aiCheckConnectionBtn').click();
      await page.waitForFunction(()=>document.querySelector('#aiModelSelect option[value="fixture-alt"]'));
      await page.locator('#aiModelSelect').selectOption(model);await page.locator('#aiSaveSettingsBtn').click();await page.locator('#closeSettingsBtn').click();
    }
    async function fresh(group='C',language='ja') {
      if(await page.locator('#closeAiPanelBtn').isVisible()) await page.locator('#closeAiPanelBtn').click();
      await page.locator('#editor').focus();await page.locator('#editor').press('ControlOrMeta+a');
      await page.locator('#aiRobotBtn').click();
      await page.locator('#aiPurposeSelect').selectOption(['A','B'].includes(group)?'translate':'question');
      await page.locator('#aiTargetSelect').selectOption(['A','B'].includes(group)?'selected-text':'none');
      if(['A','B'].includes(group)) await page.locator('#aiTranslationSelect').selectOption(language);
      await page.locator('#aiDiagnosticsPanel').evaluate(e=>{e.open=true;});
      await page.locator('#aiDiagnosticsClear').click();
    }
    async function copy() {
      await page.evaluate(()=>{globalThis.__memoTestClipboard=null;});await page.locator('#aiDiagnosticsCopy').click();
      await page.waitForFunction(()=>typeof globalThis.__memoTestClipboard==='string');
      const raw=await page.evaluate(()=>globalThis.__memoTestClipboard);importDiagnostics(raw);return raw;
    }
    async function send(question=true) {
      const n=requests.length;if(question) await page.locator('#aiInstructionInput').fill('2+3はいくつですか');
      await page.locator('#aiSendBtn').click();
      for(let i=0;i<150&&requests.length===n;i++) await sleep(20);
      assert.equal(requests.length,n+1,'one request per explicit send');return requests.at(-1);
    }
    async function complete(state='completed') {await page.waitForFunction(s=>document.querySelector('#aiGenerationStatus').dataset.state===s,state);}
    async function visible() {
      await page.locator('#aiAnswer').scrollIntoViewIfNeeded();
      return page.locator('#aiAnswer').evaluate(e=>{const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+Math.min(r.height/2,12);let shown=r.width>0&&r.height>0&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight;
        for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p);shown&&=s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0;}
        const hit=document.elementFromPoint(x,y);return shown&&Boolean(hit&&(hit===e||e.contains(hit)));});
    }
    await scenario('settings-through-ui',()=>settings());
    let previous='',history=[],observations=[];
    for(const [i,group] of PLAN.entries()) {
      await scenario(`ABCD-${String(i+1).padStart(2,'0')}-${group}`,async()=>{
        if(group!==previous||['A','C'].includes(group)){await fresh(group);history=[];observations=[];}previous=group;
        const expected=fixture(group,history,'ja');const request=await send(expected.purpose==='question');await complete();
        assert.deepEqual(request,{model:'fixture-model',stream:true,messages:expected.messages,options:{}},'full synthetic message identity');
        const raw=await copy(),records=importDiagnostics(raw),r=records.at(-1);
        assert.equal(records.length,observations.length+1);assert.equal(await page.locator('#aiAnswer').textContent(),text);
        let directRequest;const direct=await observe({...expected,model:request.model},'direct',async(_url,options)=>{directRequest=JSON.parse(options.body);return new Response(event(text,true,thinking));});
        assert.deepEqual(directRequest,request);assert.equal(direct.classification,'TEXT_OBSERVED');assert.equal(direct.record.bodyCharacters,r.bodyCharacters);
        const requestSha256=digest(JSON.stringify(request));
        observations.push({trialId:`${group}_${i+1}`,requestId:r.requestId,requestSha256,directRequestSha256:digest(JSON.stringify(directRequest)),model:request.model,purpose:expected.purpose,translationLanguage:'ja',referenceMode:expected.referenceMode,historyMessageCount:history.length,sentMessageCount:request.messages.length,inputCharacters:request.messages.reduce((n,m)=>n+m.content.length,0),messageRoles:request.messages.map(m=>m.role),bodyCharacters:direct.record.bodyCharacters,thinkingCharacters:direct.record.thinkingCharacters,doneCount:direct.record.doneCount,domCharacters:text.length,visible:await visible(),expectedResult:'COMPLETED_WITH_TEXT'});
        const audited=auditApplication(raw,observations);assert.equal(audited.evidence,'CONSISTENT_METADATA');
        report.cases.push({name:`metadata-${group}-${i+1}`,result:'CONSISTENT_METADATA',record:r,requestSha256,directRequestSha256:requestSha256,visible:observations.at(-1).visible,domCharacters:text.length});
        if(expected.userInstruction) history.push({role:'user',content:expected.userInstruction});history.push({role:'assistant',content:text});
      });
    }
    await scenario('language-ja-en-ja',async()=>{
      await fresh('B');for(const language of ['ja','en','ja']){await page.locator('#aiTranslationSelect').selectOption(language);await send(false);await complete();const r=importDiagnostics(await copy()).at(-1);assert.equal(r.translationLanguage,language);assert.equal(r.uiTranslationLanguage,language);}
    });
    await scenario('alternate-synthetic-model',async()=>{await settings('fixture-alt');await fresh();const q=await send();await complete();const r=importDiagnostics(await copy()).at(-1);assert.equal(q.model,'fixture-alt');assert.equal(r.model,'fixture-alt');});
    await scenario('diagnostics-off-on-same-answer',async()=>{
      await fresh();await page.locator('#aiDiagnosticsEnabled').uncheck();await send();await complete();assert.equal(await page.locator('#aiAnswer').textContent(),text);assert.deepEqual(importDiagnostics(await copy()),[]);
      await page.locator('#aiDiagnosticsEnabled').check();await send();await complete();assert.equal(await page.locator('#aiAnswer').textContent(),text);assert.equal(importDiagnostics(await copy()).length,1);
    });
    for(const [fixtureMode,result] of [['empty','COMPLETED_EMPTY'],['thinking','COMPLETED_EMPTY'],['missing-done','STREAM_ENDED_WITHOUT_DONE'],['malformed','ERROR'],['http-error','ERROR']]) {
      await scenario(`negative-${fixtureMode}`,async()=>{await fresh();mode=fixtureMode;await send();await complete(result==='ERROR'?'error':'completed');const raw=await copy(),r=importDiagnostics(raw).at(-1);assert.equal(r.result,result);assert.equal(auditApplication(raw,[]).evidence,'INCOMPLETE');assert.ok(!raw.includes(thinking));mode='normal';});
    }
    await scenario('stop-during-real-http-stream',async()=>{
      await fresh();mode='hold';await send();await page.waitForFunction(()=>document.querySelector('#aiAnswer').textContent==='SYNTHETIC_OLD_PARTIAL');
      await page.locator('#aiStopBtn').click();await complete('stopped');const r=importDiagnostics(await copy()).at(-1);assert.equal(r.errorType,'aborted');assert.equal(r.result,'INTERRUPTED');assert.equal(r.streamStarted,true);assert.equal(r.bodyCharacters,21);held.splice(0).forEach(r=>r.destroy());mode='normal';
    });
    await scenario('close-completion-and-new-conversation',async()=>{
      await fresh();mode='hold';await send();await page.waitForFunction(()=>document.querySelector('#aiAnswer').textContent==='SYNTHETIC_OLD_PARTIAL');
      await page.locator('#closeAiPanelBtn').click();assert.equal(await page.locator('#aiPanel').getAttribute('aria-hidden'),'true');
      held.splice(0).forEach(r=>r.end(event('SYNTHETIC_LATE',true)));await complete();mode='normal';
      await page.locator('#aiRobotBtn').click();assert.equal(await page.locator('#aiAnswer').textContent(),'回答はここに表示されます。');await send();await complete();const rows=importDiagnostics(await copy());assert.equal(rows.length,2);assert.equal(rows[1].historyMessageCount,0);assert.equal(await page.locator('#aiAnswer').textContent(),text);
    });
    await scenario('delayed-old-response-never-enters-new-ui',async()=>{
      await fresh();mode='hold';await send();await page.waitForFunction(()=>document.querySelector('#aiAnswer').textContent==='SYNTHETIC_OLD_PARTIAL');
      await page.locator('#closeAiPanelBtn').click();await page.locator('#aiRobotBtn').click();mode='normal';await send();await complete();
      held.splice(0).forEach(r=>r.end(event('SYNTHETIC_LATE',true)));
      let records;for(let i=0;i<100;i++){records=importDiagnostics(await copy());if(records.length===2&&records.every(r=>r.finalized)) break;await sleep(20);}
      assert.equal(records.length,2);assert.ok(records.every(r=>r.finalized));assert.equal(records[0].staleResponse,true);assert.equal(records[0].result,'INTERRUPTED');assert.notEqual(records[0].requestId,records[1].requestId);assert.equal(await page.locator('#aiAnswer').textContent(),text);
    });
    await scenario('editor-content-and-page-errors',async()=>{assert.equal(await page.locator('#editor').inputValue(),noteBefore);assert.deepEqual(failures,[]);assert.deepEqual(hashes(),report.source);});
    report.result='PASS';report.requests=requests.length;assert.ok(requests.length<=40);report.scope='Synthetic transport app automation and metadata consistency only';
    await page.evaluate(()=>{globalThis.__memoTestClipboard=null;});clipboardCleared=true;
  } catch (error) {
    report.failedStage=stage;report.reason='EXECUTION_OR_ASSERTION_FAILED';
    report.errorKind=['AssertionError','TimeoutError'].includes(error.name)?error.name:'RUNTIME';
    if(error.name==='AssertionError') report.assertion={operator:error.operator,actualType:typeof error.actual,expectedType:typeof error.expected};
    report.cases.push({name:stage,result:'FAIL'});process.exitCode=1;
  }
  finally {
    held.forEach(r=>r.destroy());if(context) await context.close().catch(()=>{});if(browser) await browser.close().catch(()=>{});
    if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
    report.clipboardCleared=clipboardCleared;const b=JSON.stringify(report,null,2)+'\n';fs.writeFileSync(path.join(output,'report.json'),b,{flag:'wx'});
    fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify([{file:'report.json',bytes:Buffer.byteLength(b),sha256:digest(b)}],null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({result:report.result,failedStage:report.failedStage,cases:report.cases.length,output}));
  }
}
main().catch(()=>{console.error('BLOCKED: browser harness did not finish; no automatic retry.');process.exitCode=1;});
