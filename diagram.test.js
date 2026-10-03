"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("./geometry-block-utils.js");
const m = require("./geometry-editor-utils.js");
const old = require("./docs/diagram-v1/fixtures/geometry-v1.cjs");
const oldBackup = require("./docs/diagram-v1/fixtures/backup-v4.cjs");
const { withSources, extractCitations, referencedSources } = require("./source-utils.js");
const { serializeTimelineBlock } = require("./timeline-block-utils.js");
const { serializeLocalNote, parseLocalNote } = require("./local-markdown.js");
const { buildMemoExportBundle } = require("./attachment-utils.js");
const { buildMarkdownBundleImport } = require("./markdown-bundle-utils.js");
const { buildPortableBackupFiles, parsePortableBackup } = require("./backup-bundle-utils.js");
const { buildManifest } = require("./local-sync-utils.js");
const { normalizeTagDefinitions } = require("./tags.js");
const diagram = { description: "三角形の辺を比較する模式図。\n日本語 <script> & \"引用\" 😀 [@s2]", createdForReport: true, citationIds: ["s1", "missing", "s2"] };
let geometry = g.createGeometryBlock("same-id");
for (const [x,y] of [[15,80],[50,15],[85,80]]) geometry = m.addPoint(geometry,{x,y});
geometry = m.addPolygon(geometry,geometry.points.map(p=>p.id));
geometry = g.normalizeGeometryBlock({...geometry,version:2,caption:"三角形の辺の比較",diagram});
const marker = g.serializeGeometryBlock(geometry);
const blocks = text => g.splitGeometryBlocks(text).filter(s=>s.type === "geometry");
const entry = f => ({name:f.name,data:new TextEncoder().encode(f.content)});
const sources = [{id:"s1",title:"検証用A"},{id:"s2",title:"検証用B"}];
const body = withSources("本文 [@s1]\n"+marker,sources);

test("Diagramの全情報と図形はUTF-8直列化・再読込で保持される",()=>{
  assert.deepEqual(g.parseGeometryBlockLine(marker),geometry);
  const value=g.normalizeGeometryBlock({...geometry,diagram:{...diagram,citationIds:["s1","s1","missing"]}});
  assert.deepEqual(value.diagram.citationIds,["s1","missing"]);
  assert.equal(g.parseGeometryBlockLine(g.serializeGeometryBlock(value)).diagram.description,diagram.description);
});
test("旧Geometryへ読込で図版情報を付けず、新旧混在も本文を変更しない",()=>{
  const legacy=g.serializeGeometryBlock(g.createGeometryBlock("legacy"));
  const text=legacy+"\r\n"+marker;
  assert.equal(blocks(text)[0].geometry.version,1);
  assert.equal(blocks(text)[0].geometry.diagram,undefined);
  assert.equal(g.splitGeometryBlocks(text).map(s=>s.type==="text"?s.text:s.raw).join(""),text);
});
test("空欄・作成図未指定は非表示データとして安全に往復する",()=>{
  const value=g.normalizeGeometryBlock({...geometry,diagram:{}});
  assert.deepEqual(value.diagram,{description:"",createdForReport:false,citationIds:[]});
  assert.deepEqual(g.parseGeometryBlockLine(g.serializeGeometryBlock(value)),value);
});
test("長文は保持し、上限超過・不正・未知図版情報は元本文のまま残す",()=>{
  const value={...geometry,diagram:{...diagram,description:"長".repeat(16000)}};
  assert.equal(g.parseGeometryBlockLine(g.serializeGeometryBlock(value)).diagram.description.length,16000);
  for(const override of [{version:3},{diagram:null},{diagram:{createdForReport:"true"}},
    {diagram:{citationIds:["bad id"]}},{diagram:{future:"data"}},{diagram:{description:"長".repeat(16001)}}]){
    const raw="<!-- memo-nexus:geometry-block:"+Buffer.from(JSON.stringify({...geometry,...override})).toString("hex")+" -->";
    assert.equal(g.parseGeometryBlockLine(raw),null);
    assert.equal(g.splitGeometryBlocks(raw)[0].text,raw);
  }
});
test("コード中のGeometryマーカー・補足引用は解釈しない",()=>{
  for(const delimiter of ["~~~",String.fromCharCode(96).repeat(3)]){
    const code=delimiter+"\n"+marker+"\n"+delimiter;
    assert.equal(blocks(code).length,0);
    assert.deepEqual(extractCitations(code),[]);
  }
  const value={...geometry,diagram:{...diagram,description:String.fromCharCode(96)+"[@code]"+String.fromCharCode(96)+" [@s2]"}};
  assert.deepEqual(extractCitations(g.serializeGeometryBlock(value)),["s2","s1","missing","s2"]);
});
test("本文・Timeline・Diagramの削除保護とSource一覧を共有する",()=>{
  const timeline=serializeTimelineBlock({id:"timeline",items:[{id:"item",body:"[@s1]",citationIds:["s2"]}]});
  const text=body+"\n"+timeline;
  assert.deepEqual(extractCitations(text),["s1","s2","s1","missing","s2","s1","s2"]);
  assert.deepEqual(referencedSources(text,sources).map(s=>s.id),["s1","s2"]);
});
test("作図・図形削除・複製・図形内Undo/Redoで図版情報を保持する",()=>{
  const changed=m.movePoint(geometry,geometry.points[0].id,20,75);
  assert.deepEqual(changed.diagram,diagram);
  assert.deepEqual(m.addPoint(changed,{x:60,y:60}).diagram,diagram);
  assert.deepEqual(m.deleteSelection(changed,{kind:"object",id:changed.objects[0].id}).diagram,diagram);
  const copy=g.cloneGeometryBlock(changed);
  assert.notEqual(copy.id,changed.id);
  assert.deepEqual(copy.diagram,diagram);
  assert.notEqual(copy.points[0].id,changed.points[0].id);
  const history=m.createHistory(geometry);history.push(changed);
  assert.deepEqual(history.undo(),geometry);assert.deepEqual(history.redo(),changed);
});
test("同一ID・同一マーカーの編集・削除はstart/endで選択した出現だけを変更する",()=>{
  const text=marker+"\n"+marker+"\n"+marker;
  const selected=blocks(text)[1];
  const changed=g.replaceGeometryBlock(text,selected,{...geometry,caption:"2番目"});
  assert.deepEqual(blocks(changed).map(s=>s.geometry.caption),[geometry.caption,"2番目",geometry.caption]);
  assert.equal(blocks(g.replaceGeometryBlock(text,selected,null)).length,2);
  assert.throws(()=>g.replaceGeometryBlock("前"+text,selected,geometry));
});
test("実旧parserはv1追加情報を削除するがv2は拒否し元マーカーを保護する",()=>{
  const unsafe="<!-- memo-nexus:geometry-block:"+Buffer.from(JSON.stringify({...geometry,version:1})).toString("hex")+" -->";
  assert.equal(old.parseGeometryBlockLine(unsafe).diagram,undefined);
  assert.equal(old.parseGeometryBlockLine(marker),null);
  assert.equal(old.splitGeometryBlocks(marker)[0].text,marker);
  assert.ok(old.parseGeometryBlockLine(g.serializeGeometryBlock(g.createGeometryBlock("old"))));
});
test("ローカルMarkdownとMarkdown ZIPの実保存経路で図形と情報を保持する",()=>{
  assert.equal(parseLocalNote(serializeLocalNote({id:"note",title:"図"},body)).body,body);
  const files=buildMemoExportBundle({markdownPath:"図.md",markdownContent:body,attachments:[]}).files;
  const restored=buildMarkdownBundleImport(files.map(entry))[0];
  assert.deepEqual(blocks(restored.body)[0].geometry,geometry);
  assert.deepEqual(extractCitations(restored.body),extractCitations(body));
});
for(const version of [1,2,3,4,5])test("完全バックアップv"+version+"を本文変更なしで復元しv5へ移行する",()=>{
  const manifest=buildManifest({savedAt:"2026-10-03T00:00:00Z"});
  const files=buildPortableBackupFiles({manifest,normalizeTagDefinitions,notePlans:[{fileName:"note.md",markdown:serializeLocalNote({id:"note",title:"図"},body)}]});
  files[0].content=JSON.stringify({...manifest,version,formatVersion:version});
  const parsed=parsePortableBackup(files.map(entry),{parseNote:parseLocalNote,normalizeTagDefinitions});
  assert.equal(parsed.manifest.version,5);assert.equal(parsed.sourceVersion,version);
  assert.deepEqual(blocks(parsed.notes[0].note.body)[0].geometry,geometry);
});
test("旧バックアップreaderはv5を拒否する",()=>{
  const manifest=buildManifest({savedAt:"2026-10-03T00:00:00Z"});
  assert.throws(()=>oldBackup.parsePortableBackup([entry({name:"manifest.json",content:JSON.stringify(manifest)})]),/新しいMemo-Nexus形式/);
});
