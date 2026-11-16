'use strict';
// At most one explicitly authorized direct-Ollama generation. Never retries.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {fixture,probe,observe}=require('./ai-stage1-validation.cjs');
const MODEL='phi4-mini:latest';
const ANCHOR='910cace4e733d41f0a7e6eab6bdd0c2346fabd29';
const SOURCE_FILES=['app.js','ai-prompts.js','ai-provider.js','ai-context.js',
  'ai-selection-snapshot.js','ollama-adapter.js','feature-palette.js'];
const root=path.resolve(__dirname,'..');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');

function requestFixture(model=MODEL) {
  if(model!==MODEL)throw Error('model_not_fixed');
  const f=fixture('A',[],'ja');
  const roles=f.messages.map(m=>m.role);
  const characters=f.messages.reduce((n,m)=>n+m.content.length,0);
  if(f.purpose!=='translate'||f.referenceMode!=='selected-text'||f.historyMessageCount!==0
      ||roles.join(',')!=='system,user'||characters!==197
      ||!f.messages[1].content.endsWith('[翻訳対象]\nThe blue bird sits by the window.'))
    throw Error('fixture_changed_requires_review');
  const request={model,stream:true,messages:f.messages,options:{}};
  return {request,requestSha256:sha(JSON.stringify(request)),
    messagesSha256:sha(JSON.stringify(f.messages)),roles,characters};
}
function sourceCheck() {
  const result={head:'UNKNOWN',sourceUnchanged:false,worktreeClean:false};
  try {
    result.head=execFileSync('git',['rev-parse','HEAD'],
      {cwd:root,encoding:'utf8',timeout:5000}).trim();
    execFileSync('git',['merge-base','--is-ancestor',ANCHOR,'HEAD'],
      {cwd:root,stdio:'ignore',timeout:5000});
    const committed=execFileSync('git',['diff','--name-only',ANCHOR,'HEAD','--',...SOURCE_FILES],
      {cwd:root,encoding:'utf8',timeout:5000}).trim();
    const dirty=execFileSync('git',['status','--porcelain','--',...SOURCE_FILES],
      {cwd:root,encoding:'utf8',timeout:5000}).trim();
    result.sourceUnchanged=committed==='';
    result.worktreeClean=dirty==='';
  }catch(_){ /* Unverified source must block generation. */ }
  return result;
}
function plan() {
  const f=requestFixture();
  return {stage:'A2-translate-one',mode:'PLAN_ONLY',realInference:'NOT_TESTED',
    model:MODEL,purpose:'translate',referenceMode:'selected-text',language:'ja',
    historyMessageCount:0,sourceText:'The blue bird sits by the window.',
    messageRoles:f.roles,inputCharacters:f.characters,requestSha256:f.requestSha256,
    messagesSha256:f.messagesSha256,options:{},endpoint:'http://127.0.0.1:11434/api/chat',
    maxDirectRequests:1,retries:0,requiresDefaultSystemInstruction:true,
    source:sourceCheck()};
}
function writeNew(dir,name,content) {
  const bytes=Buffer.from(String(content),'utf8');
  fs.writeFileSync(path.join(dir,name),bytes,{flag:'wx'});
  return {name,bytes:bytes.length,sha256:sha(bytes)};
}
async function directOne({model=MODEL,output,execute=false,appObserved=false,
  platform=process.platform,probeFn=probe,observeFn=observe,sourceFn=sourceCheck}={}) {
  if(!execute||!appObserved)throw Error('explicit_execute_and_app_observed_required');
  if(platform!=='win32')throw Error('windows_required');
  const f=requestFixture(model),source=sourceFn();
  if(source.head==='UNKNOWN'||!source.sourceUnchanged||!source.worktreeClean)
    throw Error('fixed_source_required');
  if(typeof output!=='string'||!path.isAbsolute(output))
    throw Error('absolute_output_directory_required');
  const folder=path.resolve(output);
  if(!fs.statSync(folder).isDirectory()||fs.lstatSync(folder).isSymbolicLink())
    throw Error('existing_dedicated_folder_required');
  const capacity=fs.statfsSync(folder);
  if(Number(capacity.bavail)*Number(capacity.bsize)<32*1024*1024)
    throw Error('capacity_required');
  const env=await probeFn();
  if(env.platform!=='win32'||env.service!=='AVAILABLE'||env.endpoint!=='http://127.0.0.1:11434'
      ||!Array.isArray(env.models)||!env.models.includes(model))
    throw Error('local_model_not_ready');
  const dir=fs.mkdtempSync(path.join(folder,'a2-direct-one-'));
  const saved=[writeNew(dir,'request.json',JSON.stringify(f.request,null,2)+'\n')];
  const observed=await observeFn({...fixture('A',[],'ja'),model},'direct',fetch,60000);
  const answer=String(observed.answer||'');
  saved.push(writeNew(dir,'answer-local-only.txt',answer));
  saved.push(writeNew(dir,'diagnostic-metadata.json',JSON.stringify(observed.record||null,null,2)+'\n'));
  const report={stage:'A2-translate-one',source,model,
    requestSha256:f.requestSha256,messagesSha256:f.messagesSha256,
    appObservation:'USER_REPORTED_NOT_INDEPENDENTLY_VERIFIED',
    exactAppPayloadMatch:'UNKNOWN',directClassification:observed.classification||'UNKNOWN',
    answerCharacters:answer.length,answerSha256:sha(answer),
    semanticCorrectness:'PENDING_HUMAN_REVIEW',rootCause:'UNKNOWN',retries:0,artifacts:saved};
  writeNew(dir,'report.json',JSON.stringify(report,null,2)+'\n');
  return {folder:dir,report};
}
async function main(args) {
  const cmd=args[0]||'plan';
  if(cmd==='plan')return console.log(JSON.stringify(plan(),null,2));
  if(cmd==='probe')return console.log(JSON.stringify(await probe(),null,2));
  if(cmd!=='direct-one')throw Error('invalid_command');
  const val=flag=>{const i=args.indexOf(flag);return i===-1?null:args[i+1];};
  const result=await directOne({model:val('--model')||MODEL,output:val('--output'),
    execute:args.includes('--execute'),appObserved:args.includes('--app-observed')});
  console.log(JSON.stringify({folder:result.folder,classification:result.report.directClassification,
    exactAppPayloadMatch:'UNKNOWN',semanticCorrectness:'PENDING_HUMAN_REVIEW'},null,2));
}
module.exports={requestFixture,sourceCheck,plan,directOne};
if(require.main===module)main(process.argv.slice(2)).catch(()=>{
  console.error('BLOCKED: preflight failed. No retry or data overwrite.');
  process.exitCode=1;
});
