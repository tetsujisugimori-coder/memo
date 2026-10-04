"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const s = require("./source-utils.js");
const f = require("./figure-metadata-utils.js");
const a = require("./attachment-utils.js");
const t = require("./table-block-utils.js");
const c = require("./chart-block-utils.js");
const g = require("./geometry-block-utils.js");
const timeline = require("./timeline-block-utils.js");
const oldFigure = require("./docs/report-preview-v1/fixtures/figure-metadata-utils-main.cjs");
const oldTable = require("./docs/report-preview-v1/fixtures/table-block-utils-main.cjs");
const oldChart = require("./docs/report-preview-v1/fixtures/chart-block-utils-main.cjs");
const oldBackup = require("./docs/report-preview-v1/fixtures/backup-bundle-utils-main.cjs");
const {serializeLocalNote, parseLocalNote} = require("./local-markdown.js");
const {buildMarkdownBundleImport} = require("./markdown-bundle-utils.js");
const {buildPortableBackupFiles, parsePortableBackup, BACKUP_VERSION} = require("./backup-bundle-utils.js");
const {buildManifest} = require("./local-sync-utils.js");
const {normalizeTagDefinitions} = require("./tags.js");
const sources = [{id:"s1",title:"検証用A"},{id:"s2",title:"検証用B"},{id:"unused",title:"未参照"}];
const metadata = {caption:"画像の説明",sourceName:"従来資料名",sourceUrl:"https://example.org/legacy",dateLabel:"2026年",sourceType:"primary",license:"検証",note:"従来補足",citationIds:["s2","missing","s1"]};
const image = a.serializeImageBlock([{id:"image-a",figureMetadata:metadata}],"全体説明","center","normal","figure-a");
const table = {...t.createTableBlock("same-table"),rows:[["項目","値"],["A","12"]],citationIds:["s1","s2"]};
const chart = {...c.createChartBlock("same-chart"),citationIds:["s2","s1"]};
const imageBlocks = body=>a.splitImageBlocks(body).filter(b=>b.type==="image");
const entry = file=>({name:file.name,data:new TextEncoder().encode(file.content)});
const marker = (kind,value)=>'<!-- memo-nexus:'+kind+':'+Buffer.from(JSON.stringify(value)).toString("hex")+' -->';

test("Source配列は重複・不正IDを除外し、順と未登録の安定IDを保持する",()=>{
  assert.deepEqual(s.normalizeCitationIds(["s2","s1","s2","missing","bad id",null,1,{}]),["s2","s1","missing"]);
  for(const value of [undefined,null,{},"s1",42]) assert.deepEqual(s.normalizeCitationIds(value),[]);
});
test("Figure資料情報のv2往復と解除は従来の全項目を保持する",()=>{
  assert.deepEqual(f.parseFigureMetadata(f.serializeFigureMetadata(metadata)),metadata);
  const {citationIds,...legacy}=metadata;
  assert.deepEqual(f.parseFigureMetadata(f.serializeFigureMetadata(legacy)),legacy);
  assert.equal(f.serializeFigureMetadata({citationIds:[]}),"");
  assert.deepEqual(f.parseFigureMetadata(f.serializeFigureMetadata({citationIds:["s1","s1"]})).citationIds,["s1"]);
  assert.equal(f.parseFigureMetadata(f.serializeFigureMetadata(legacy)).citationIds,undefined);
});
test("実旧Figure parserはv1追加項目を落とすがv2は拒否する",()=>{
  assert.equal(oldFigure.parseFigureMetadata(marker("figure-metadata",{version:1,...metadata})).citationIds,undefined);
  assert.equal(oldFigure.parseFigureMetadata(f.serializeFigureMetadata(metadata)),null);
  assert.deepEqual(oldFigure.parseFigureMetadata(f.serializeFigureMetadata({...metadata,citationIds:[]})),f.normalizeFigureMetadata({...metadata,citationIds:[]}));
});
for(const [kind,utils,old,value,versionKey] of [["table-block",t,oldTable,table,"version"],["chart-block",c,oldChart,chart,"schemaVersion"]]){
  const parse = kind==="table-block" ? "parseTableBlockLine" : "parseChartBlockLine";
  const serialize = kind==="table-block" ? "serializeTableBlock" : "serializeChartBlock";
  test(kind+"の任意Source・未知項目は実旧parserでも保存・再読込で保持される",()=>{
    const current=utils[parse](utils[serialize](value));
    assert.equal(current[versionKey],1);
    assert.deepEqual(old[parse](old[serialize](old[parse](utils[serialize](value)))).citationIds,value.citationIds);
    const future={...value,[versionKey]:99,future:{data:"keep"}};
    assert.deepEqual(utils[parse](utils[serialize](future)).future,future.future);
    assert.equal(utils[parse](utils[serialize](future))[versionKey],99);
  });
  test(kind+"の空・重複・不正・欠落Sourceの正規化",()=>{
    assert.deepEqual(utils[parse](utils[serialize]({...value,citationIds:["missing","s1","s1",false,"bad id"]})).citationIds,["missing","s1"]);
    assert.deepEqual(utils[parse](utils[serialize]({...value,citationIds:null})).citationIds,[]);
    const legacy={...value};delete legacy.citationIds;
    assert.equal(Object.hasOwn(utils[parse](utils[serialize](legacy)),"citationIds"),false);
    assert.equal(utils[parse]('<!-- memo-nexus:'+kind+':ff -->'),null);
  });
  test(kind+"の同一ID・同一全文コピーは選択した出現だけ変更・削除する",()=>{
    const split=kind==="table-block" ? "splitTableBlocks":"splitChartBlocks";
    const replace=kind==="table-block" ? "replaceTableBlock":"replaceChartBlock";
    const type=kind==="table-block" ? "table":"chart";
    const raw=utils[serialize](value),body=raw+"\n"+raw+"\n"+raw;
    const blocks=utils[split](body).filter(b=>b.type===type),selected=blocks[1];
    const changed=utils[replace](body,selected,{...value,citationIds:["missing"]});
    assert.deepEqual(utils[split](changed).filter(b=>b.type===type).map(b=>b[type].citationIds),[value.citationIds,["missing"],value.citationIds]);
    assert.equal(utils[split](utils[replace](body,selected,null)).filter(b=>b.type===type).length,2);
    assert.throws(()=>utils[replace]("前"+body,selected,value));
  });
}
test("Comparisonの入替・通常表示・片方削除・再追加では画像にSourceが追従する",()=>{
  const values=[{id:"a",figureMetadata:metadata},{id:"b",figureMetadata:{citationIds:["s1"]}}];
  const raw=a.serializeImageBlock(values,"比較","center","comparison","stable-figure");
  const first=imageBlocks(raw)[0];
  const swapped=a.replaceImageBlock(raw,first,[...first.images].reverse(),first.caption);
  assert.deepEqual(imageBlocks(swapped)[0].images.map(i=>i.figureMetadata.citationIds),[["s1"],metadata.citationIds]);
  const normal=a.replaceImageBlock(raw,first,first.images,first.caption,first.alignment,"normal");
  assert.deepEqual(imageBlocks(normal)[0].images,first.images);
  const removed=a.replaceImageBlock(raw,first,[first.images[1]],first.caption);
  const next=imageBlocks(removed)[0];
  assert.equal(next.displayMode,"normal");
  const added=a.replaceImageBlock(removed,next,[...next.images,{id:"new",alt:"新画像"}],next.caption);
  assert.equal(imageBlocks(added)[0].images[1].figureMetadata,undefined);
  assert.deepEqual(imageBlocks(added)[0].images[0].figureMetadata.citationIds,["s1"]);
});
for(const payload of [{version:3,...metadata},{version:2,...metadata,citationIds:"s1"},{version:2,...metadata,citationIds:["bad id"]},{version:2,...metadata,future:"keep"}]) test("不正・未知Figure情報を画像とともに原文保存 "+JSON.stringify(payload).slice(0,60),()=>{
  const opaque=marker("figure-metadata",payload);
  assert.equal(f.parseFigureMetadata(opaque),null);
  const raw=a.serializeImageBlock([{id:"a",figureMetadataRaw:opaque},{id:"b"}],"説明","center","comparison");
  const block=imageBlocks(raw)[0];
  assert.equal(block.images[0].figureMetadataRaw,opaque);
  const swapped=a.replaceImageBlock(raw,block,[...block.images].reverse(),block.caption);
  assert.equal(imageBlocks(swapped)[0].images[1].figureMetadataRaw,opaque);
  assert.equal(imageBlocks(swapped)[0].caption,"説明");
});
test("初出は表示順、Timeline本文→参照Figure→選択Source、重複Source一覧は1件",()=>{
  const tl=timeline.serializeTimelineBlock({id:"tl",items:[{id:"item",body:"[@s1]",figureId:"figure-a",citationIds:["s2"]}]});
  const diagram=g.serializeGeometryBlock(g.normalizeGeometryBlock({...g.createGeometryBlock("diagram"),version:2,diagram:{description:"[@s2]",citationIds:["s1"]}}));
  const body=s.withSources(tl+"\n"+image+"\n"+t.serializeTableBlock(table)+"\n"+c.serializeChartBlock(chart)+"\n"+diagram,sources);
  assert.deepEqual(s.extractCitations(body),["s1","s2","missing","s1","s2","s2","missing","s1","s1","s2","s2","s1","s2","s1"]);
  assert.deepEqual(s.referencedSources(body,sources).map(x=>x.id),["s1","s2"]);
  const changed=a.replaceImageBlock(body,imageBlocks(body)[0],[{id:"image-a",figureMetadata:{citationIds:["s2"]}}],"");
  assert.deepEqual(s.extractCitations(changed).slice(0,3),["s1","s2","s2"]);
});
test("重複Figure IDはTimeline参照先不在となり、コピーへ誤接続しない",()=>{
  const tl=timeline.serializeTimelineBlock({id:"tl",items:[{id:"i",figureId:"figure-a"}]});
  assert.deepEqual(s.extractCitations(tl+"\n"+image+"\n"+image),[...metadata.citationIds,...metadata.citationIds]);
  assert.deepEqual(s.extractCitations(tl),[]);
  const normalized=a.removeDuplicateFigureIds(tl+"\n"+image+"\n"+image).body;
  assert.equal(imageBlocks(normalized).some(b=>b.figureId),false);
});
test("各参照元だけでも削除保護に含み、現在本文から消えれば保護を解除する",()=>{
  const values=[image,a.serializeImageBlock([{id:"a",figureMetadata:{citationIds:["s1"]}},{id:"b"}],"","center","comparison"),t.serializeTableBlock(table),c.serializeChartBlock(chart),"本文 [@s1]",timeline.serializeTimelineBlock({id:"tl",items:[{id:"i",citationIds:["s1"]}]}),g.serializeGeometryBlock({...g.createGeometryBlock("g"),version:2,diagram:{citationIds:["s1"]}})];
  for(const value of values){assert.ok(s.extractCitations(value).includes("s1"));assert.deepEqual(s.extractCitations(value.replace(value,"")),[]);}
});
test("コードと無効Citation、plain資料情報やセルを引用として扱わない",()=>{
  for(const fence of [String.fromCharCode(96).repeat(3),"~~~"]){
    const body=[fence+"markdown",image,t.serializeTableBlock(table),c.serializeChartBlock(chart),"[@s1]",fence].join("\n");
    assert.deepEqual(s.extractCitations(body),[]);
  }
  assert.deepEqual(s.extractCitations(String.fromCharCode(96)+"[@s1]"+String.fromCharCode(96)+" [@bad id] [@]"),[]);
  assert.deepEqual(s.extractCitations(a.serializeImageBlock([{id:"a",figureMetadata:{caption:"[@s1]",sourceName:"[@s2]"}}],"[@s1]")),[]);
  assert.deepEqual(s.extractCitations(t.serializeTableBlock({...table,citationIds:[],rows:[["[@s1]"]]})),[]);
});
test("Table→Chartは作成時のみSource配列を独立コピーし、既存Chartへ追従しない",()=>{
  const result=c.tableToChartDraft(table,"new-chart",{items:["i"],series:["series"]});
  assert.equal(result.ok,true);assert.deepEqual(result.chart.citationIds,table.citationIds);
  assert.notEqual(result.chart.citationIds,table.citationIds);
  result.chart.citationIds.push("missing");assert.deepEqual(table.citationIds,["s1","s2"]);
  assert.deepEqual(c.moveChartItem(result.chart,0,1).citationIds,["s1","s2","missing"]);
  assert.deepEqual(c.moveChartSeries(result.chart,0,1).citationIds,["s1","s2","missing"]);
  assert.deepEqual(t.addTableRow(table,1).citationIds,table.citationIds);
  assert.deepEqual(t.addTableColumn(table,1).citationIds,table.citationIds);
});
test("ローカルMarkdownとMarkdown ZIPはattachment IDのみ変更、Source IDと情報は保持",()=>{
  const body=s.withSources(image+"\n"+t.serializeTableBlock(table)+"\n"+c.serializeChartBlock(chart),sources);
  assert.equal(parseLocalNote(serializeLocalNote({id:"n",title:"検証用"},body)).body,body);
  const files=a.buildMemoExportBundle({markdownPath:"検証.md",markdownContent:body,attachments:[{id:"image-a",kind:"image",fileName:"検証.png",blob:new Blob(["png"],{type:"image/png"})}]}).files;
  const entries=files.map(file=>file.blob ? {name:file.name,data:new Uint8Array([1])}:entry(file));
  const restored=buildMarkdownBundleImport(entries,()=>"new-attachment")[0];
  assert.equal(imageBlocks(restored.body)[0].images[0].id,"new-attachment");
  assert.deepEqual(imageBlocks(restored.body)[0].images[0].figureMetadata,metadata);
  assert.deepEqual(s.parseSourceDocument(restored.body).sources,s.normalizeSources(sources));
  assert.deepEqual(s.extractCitations(restored.body),s.extractCitations(body));
});
for(const version of [1,2,3,4,5,6])test("完全バックアップv"+version+"を本文変更なしでv6へ移行",()=>{
  const body=s.withSources(image+"\n"+t.serializeTableBlock(table)+"\n"+c.serializeChartBlock(chart),sources);
  const manifest=buildManifest({savedAt:"2026-10-04T00:00:00Z"});
  const files=buildPortableBackupFiles({manifest,normalizeTagDefinitions,notePlans:[{fileName:"note.md",markdown:serializeLocalNote({id:"n",title:"検証用"},body)}]});
  files[0].content=JSON.stringify({...manifest,version,formatVersion:version});
  const result=parsePortableBackup(files.map(entry),{parseNote:parseLocalNote,normalizeTagDefinitions});
  assert.equal(BACKUP_VERSION,6);assert.equal(result.manifest.version,6);assert.equal(result.notes[0].note.body,body);
});
test("実旧完全バックアップreaderはv6を拒否し、不正・未来manifestも拒否",()=>{
  const manifest=buildManifest({savedAt:"2026-10-04T00:00:00Z"});
  assert.throws(()=>oldBackup.parseManifest([entry({name:"manifest.json",content:JSON.stringify(manifest)})]),/新しいMemo-Nexus形式/);
  for(const version of [0,7,99]) assert.throws(()=>parsePortableBackup([entry({name:"manifest.json",content:JSON.stringify({...manifest,version})})]));
});

test("異なる種類や短い閉じフェンス、コード内Sourceマーカーを引用登録しない",()=>{
  const tick=String.fromCharCode(96);
  for(const fence of [tick.repeat(4),"~~~~"]){
    const other=fence[0]===tick?"~~~":tick.repeat(3);
    const body=[fence,"[@s1]",other,image,fence.slice(0,3),t.serializeTableBlock(table),fence].join("\n");
    assert.deepEqual(s.extractCitations(body),[]);
    const code=[fence,s.serializeSources(sources),fence].join("\n");
    assert.deepEqual(s.parseSourceDocument(code),{body:code,sources:[]});
  }
});

test("既知と未知の資料情報が重複する不正Image Blockを再保存で削らない",()=>{
  const opaque=marker("figure-metadata",{version:3,...metadata});
  const body=['<!-- memo-nexus:image-block -->','![画像](attachment://a)',f.serializeFigureMetadata(metadata),opaque,'<!-- /memo-nexus:image-block -->'].join("\n");
  assert.equal(a.splitImageBlocks(body).filter(b=>b.type==="text").map(b=>b.text).join("").includes(f.serializeFigureMetadata(metadata)),true);
  assert.equal(a.splitImageBlocks(body).filter(b=>b.type==="text").map(b=>b.text).join("").includes(opaque),true);
  assert.equal(a.splitImageBlocks(body).some(b=>b.raw===body),false);
});

test("Markdown ZIPの異なるメモでSource IDが同じでも他メモのレコードへ統合しない",()=>{
  const first=s.withSources(t.serializeTableBlock({...table,citationIds:["shared"]}),[{id:"shared",title:"検証メモA"}]);
  const second=s.withSources(c.serializeChartBlock({...chart,citationIds:["shared","missing"]}),[{id:"shared",title:"検証メモB"}]);
  const imported=buildMarkdownBundleImport([entry({name:"a.md",content:first}),entry({name:"b.md",content:second})]);
  assert.deepEqual(imported.map(n=>s.parseSourceDocument(n.body).sources[0].title),["検証メモA","検証メモB"]);
  assert.deepEqual(imported.map(n=>s.extractCitations(n.body)),[["shared"],["shared","missing"]]);
  assert.equal(s.parseSourceDocument(imported[1].body).sources.some(x=>x.id==="missing"),false);
});
