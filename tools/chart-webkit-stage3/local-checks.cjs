'use strict';
// One bounded local Step 1 check set; output directory must not already exist.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os'),{spawnSync,execFileSync}=require('node:child_process');
const root=path.resolve(process.argv[2]||'');if(!process.argv[2])throw Error('output required');fs.mkdirSync(root);fs.mkdirSync(path.join(root,'raw'));
const names=['ledger','recorder','termination','browser-failure','preload','synthetic-analyze','descendant'];const args=['--test',...names.map(x=>path.join(__dirname,`${x}-check.cjs`))];
function sourceHashes(){return fs.readdirSync(__dirname).filter(x=>x.endsWith('.cjs')).sort().map(name=>({name,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,name))).digest('hex')}));}
const before=sourceHashes(),startUtc=new Date().toISOString(),commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const child=spawnSync(process.execPath,args,{encoding:'utf8',timeout:600000,maxBuffer:10000000,env:{...process.env,CHART_STAGE3_EVIDENCE:path.join(root,'raw')}});
fs.writeFileSync(path.join(root,'checks.stdout.log'),child.stdout||'',{flag:'wx'});fs.writeFileSync(path.join(root,'checks.stderr.log'),child.stderr||'',{flag:'wx'});
const after=sourceHashes(),result={startUtc,endUtc:new Date().toISOString(),baseCommit:commit,platform:process.platform,osRelease:os.release(),node:process.version,playwright:require('playwright/package.json').version,command:[process.execPath,...args],status:child.status,signal:child.signal,error:child.error?String(child.error):null,sourceBefore:before,sourceAfter:after,sourceUnchanged:JSON.stringify(before)===JSON.stringify(after),descendantsOnTimeout:child.error?'UNKNOWN':'NOT_APPLICABLE'};
fs.writeFileSync(path.join(root,'outcome.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:result.status,signal:result.signal,sourceUnchanged:result.sourceUnchanged}));if(result.status!==0||!result.sourceUnchanged)process.exitCode=1;
