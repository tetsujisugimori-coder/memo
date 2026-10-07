"use strict";
const {serializeImageBlock}=require('./attachment-utils.js');
const {createTableBlock,serializeTableBlock}=require('./table-block-utils.js');
const {createChartBlock,serializeChartBlock}=require('./chart-block-utils.js');
const {createGeometryBlock,serializeGeometryBlock}=require('./geometry-block-utils.js');
const {serializeTimelineBlock}=require('./timeline-block-utils.js');
const {withSources}=require('./source-utils.js');
const assets=[['landscape',1600,900],['portrait',900,1600],['square',1000,1000],['boundary',800,3200]];
// Hand-authored expectations: never calculated by the Report numbering renderer.
const numbers={R01:[],R02:['図1','図2','図3','図4','図5'],R03:['表1','表2','図1','図2','図3'],R04:['図1','図1','図1','図2','図3'],R05:['図1','表1','図2','図3','図4','表2','図5','図1','図6'],R06:['図1','図2','図3','表1']};
function buildSamples(ids) {
  const rid=id=>Array.from(id).map(c=>c.codePointAt(0).toString(16)).join('-');
  const paragraph='資料整理プロジェクトでは、受け取った資料の識別、配置、確認、保存を順番に進める。担当者は画像と説明の対応を確かめ、表の空欄と数値を区別して記録する。共有資料を何度参照しても出典を追跡できるよう、本文と図表の関係を確認する。ここに記す内容は検証のための架空の作業であり、歴史的事実を説明するものではない。短い記録と長い記録を混在させ、ページが変わっても文章の順序と文字が維持されることを確認する。';
  const sources=n=>Array.from({length:n},(_,i)=>({id:`s${i+1}`,title:`検証用の架空資料${i+1}`,url:`https://example.com/source-${i+1}`}));
  const prose=(count,prefix)=>Array.from({length:count},(_,i)=>`${prefix}段落${String(i+1).padStart(2,'0')} ${paragraph.repeat(i%3===0?1:2)} [@s${i%3+1}]`);
  const long='画像の枠線と目盛りを使って縦横比と配置を確認し、説明と出典の対応を記録する。'.repeat(5);
  const figure=(id,key='landscape',caption=id)=>serializeImageBlock([{id:ids[key],figureMetadata:{caption:`${id}資料情報`,citationIds:['s1','s2']}}],caption,'center','normal',rid(id));
  const comparison=(id,mixed=false)=>serializeImageBlock([{id:ids.landscape,comparisonLabel:`${id}左・受領時`,figureMetadata:{citationIds:['s2']}},{id:ids[mixed?'portrait':'landscape'],comparisonLabel:`${id}右・整理後`,figureMetadata:{citationIds:['s3','s4']}}],id+' '+long,'center','comparison',rid(id));
  const table=(id,cols=4,rows=12,empty=false)=>serializeTableBlock({...createTableBlock(id),caption:id,rows:[Array.from({length:cols},(_,c)=>`${id}列${c+1}長い日本語の確認項目名`),...Array.from({length:rows},(_,r)=>Array.from({length:cols},(_,c)=>empty&&c===1&&r%2===0?'':`${id}R${r+1}C${c+1}`))],citationIds:['s2']});
  const chart=(id,type='bar')=>{const values=type==='bar'?[-40,0,80,20,-20]:type==='pie'?[60,25,10,4,1]:[10,12,9,18,22,15,28,31,25,34,39,42];const base=createChartBlock(id);return serializeChartBlock({...base,chartType:type,title:id,unit:'件',items:values.map((_,i)=>({id:`${id}-i${i}`,label:`${id}項目${i+1}資料分類の長い日本語名称`})),series:[{id:`${id}-s`,name:'整理件数',color:'#4455cc',values}],appearance:{...base.appearance,showLegend:true,pieSeriesId:`${id}-s`},citationIds:['s1']});};
  const diagram=(id,n=3)=>serializeGeometryBlock({...createGeometryBlock(id),version:2,caption:id,points:Array.from({length:n},(_,i)=>({id:`p${i}`,x:10,y:8+i*7})),objects:Array.from({length:n-1},(_,i)=>({id:`e${i}`,type:'segment',pointIds:[`p${i}`,`p${i+1}`]})),annotations:Array.from({length:n},(_,i)=>({id:`a${i}`,type:'vertex-label',pointId:`p${i}`,label:n===3?`工程${i+1}`:`要素${i+1}：受領資料の分類と保存確認`,offsetX:5,offsetY:0})),diagram:{description:`${id}接続順序 [@s2]`,citationIds:['s1']}});
  const timeline=(id,n,fig)=>serializeTimelineBlock({version:1,id:rid(id),title:id,items:Array.from({length:n},(_,i)=>({id:`${rid(id)}-e${i}`,dateLabel:`2025-${String(i%12+1).padStart(2,'0')}-01`,title:`${id}工程${i+1}`,body:`${id}説明${i+1} ${paragraph.slice(0,80)} [@s2]`,...(i===0&&fig?{figureId:rid(fig)}:{}),citationIds:['s1']}))});
  const r1=Array.from({length:12},(_,i)=>`${'#'.repeat(i%3+1)} R01第${i+1}節\n\nR01節${i+1}短文 ${paragraph.slice(0,80)} [@s${i%3+1}]\n\nR01節${i+1}長文 ${paragraph.repeat(3).slice(0,420)}\n\n- 短い確認項目\n- 保存後に順序を確認`).join('\n\n');
  const r5=prose(9,'R05');
  const boundaryUrl='https://example.com/'+ 'u'.repeat(181);
  const definitions=[
    ['R01',3,[r1,'> R01引用：保存と表示の結果を照合する。']],
    ['R02',4,[figure('R02横'),figure('R02縦','portrait','R02縦 '+long),figure('R02正方形','square'),comparison('R02横比較'),comparison('R02混在比較',true)]],
    ['R03',3,[table('R03通常'),table('R03横長',10,24),chart('R03棒'),chart('R03折線','line'),chart('R03円','pie')]],
    ['R04',3,[figure('R04参照','square'),timeline('R04短期',5,'R04参照'),timeline('R04長期',18,'R04参照'),diagram('R04単純'),diagram('R04複雑',12)]],
    ['R05',5,[r5[0],figure('R05図版1'),table('R05表1'),r5[1],chart('R05棒'),figure('R05図版2','portrait'),r5[2],comparison('R05比較',true),table('R05表2',10,24),...r5.slice(3,6),chart('R05折線','line'),timeline('R05工程',5,'R05図版1'),...r5.slice(6),diagram('R05構造'), '共有資料の追加参照 [@s4] [@s5]']],
    ['R06',3,['# R06境界見出し '+ '長い見出しの折り返しを確認する。'.repeat(7),...prose(8,'R06境界直前'),figure('R06巨大','boundary','R06説明 '+long.repeat(2)),chart('R06境界棒'),diagram('R06境界構造',12),table('R06空欄',4,12,true),`長いURL [境界URL](${boundaryUrl})`]]
  ];
  return definitions.map(([id,n,parts])=>({id,title:`${id} 資料整理プロジェクト`,body:withSources([`${id}検証用の架空資料を参照する。 `+sources(n).map(s=>`[@${s.id}]`).join(' '),...parts].join('\n\n'),sources(n)),expectedTexts:parts.filter(p=>!p.startsWith('<!--')&&!p.startsWith('長いURL')).flatMap(p=>p.split('\n').map(line=>line.replace(/^(?:#{1,6}|-|>) /,'').replace(/\s*\[@s\d+\]/g,'').trim()).filter(Boolean)),numbers:numbers[id],sourceCount:n,sourceUrls:sources(n).map(s=>s.url),boundaryUrl:id==='R06'?boundaryUrl:null}));
}
module.exports={assets,buildSamples,numbers};
