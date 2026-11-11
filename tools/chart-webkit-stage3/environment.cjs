'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const output=process.argv[2];if(!output)throw Error('output path required');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const disk=fs.statfsSync(process.cwd()),manifest=JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve('playwright-core')),'browsers.json'),'utf8'));
const data={utc:new Date().toISOString(),commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),sourceStatus:git('status','--porcelain=v1','--untracked-files=all'),node:process.version,platform:process.platform,osRelease:os.release(),arch:process.arch,freeBytes:disk.bavail*disk.bsize,playwright:require('playwright/package.json').version,browserManifest:manifest.browsers.filter(x=>['webkit','chromium'].includes(x.name)),runner:{os:process.env.RUNNER_OS||'UNKNOWN',imageOS:process.env.ImageOS||'UNKNOWN',imageVersion:process.env.ImageVersion||'UNKNOWN',runId:process.env.GITHUB_RUN_ID||'UNKNOWN'},actualChromium:'NOT_TESTED'};
fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n',{flag:'wx'});
