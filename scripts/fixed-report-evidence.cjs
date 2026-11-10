'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const out=path.resolve(process.env.REPORT_FIXED_OUT),r=JSON.parse(fs.readFileSync(path.join(out,'results.json'))),ids=['R01','R02','R03','R04','R05','R06','L01','L02','L03','L04','I01'];
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(r.sha,head,'results must bind tested HEAD');assert.equal(r.engine,'webkit');assert.equal(r.platform,'linux');assert.ok(r.browser);
assert.deepEqual(r.cases.map(c=>c.id),ids);
const pdf=JSON.parse(fs.readFileSync(path.join(out,'pdf-results.json')));
assert.equal(pdf.sha,head);assert.equal(pdf.engine,r.engine);assert.equal(pdf.browser,r.browser);assert.deepEqual(pdf.cases.map(c=>c.id),ids);
for(const [index,c] of r.cases.entries()){
 assert.equal(c.save,'PASS');assert.equal(c.preview,'PASS');assert.ok(!c.failure);assert.deepEqual(c.errors,[]);
 assert.equal(c.import,c.id==='R01'?'対象外：正式編集操作で直接検証':'PASS');
 const pc=pdf.cases[index];for(const [key,value] of Object.entries(c))assert.deepEqual(pc[key],value,'inspection must preserve source '+c.id+'/'+key);
 assert.equal(pc.imageInspection,'PASS');assert.ok(pc.imageRegionChecks);assert.ok(!pc.imageFailure&&!pc.pdfFailure);
}
execFileSync(process.env.PYTHON||'python',['scripts/fixed-report-artifacts.py',out,process.env.TRACK_A_TRACE||'off'],{stdio:'inherit'});
const files=[];function walk(dir){for(const f of fs.readdirSync(dir)){const p=path.join(dir,f);if(fs.statSync(p).isDirectory())walk(p);else if(f!=='manifest.json')files.push({path:path.relative(out,p),bytes:fs.statSync(p).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')});}}walk(out);
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,platform:process.platform,playwright:require('playwright/package.json').version,trace:process.env.TRACK_A_TRACE,case_count:11,files},null,2));
