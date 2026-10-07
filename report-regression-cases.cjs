"use strict";
const {createChartBlock,serializeChartBlock}=require('./chart-block-utils.js');
const {serializeImageBlock}=require('./attachment-utils.js');
const {withSources}=require('./source-utils.js');
const sources=[{id:'s1',title:'検証用の架空画像資料',url:'https://example.com/fixed-images'},{id:'s2',title:'検証用の架空数値資料',url:'https://example.com/fixed-values'}];
function buildRegressionCases(ids){
  const finish=(id,parts,numbers,extra={})=>({id,title:id+' 資料整理プロジェクト追加検証',body:withSources(['検証用の架空資料 [@s1] [@s2]',...parts].join('\n\n'),sources),expectedTexts:[],numbers,sourceCount:2,sourceUrls:sources.map(s=>s.url),boundaryUrl:null,...extra});
  const definitions=[
    ['L01',Array(50).fill(1234567890)],
    ['L02',Array.from({length:50},(_,i)=>[-1234567890,0,1234567890][i%3])],
    ['L03',Array(50).fill(1234567890),Array(50).fill(1234567890),Array.from({length:50},(_,i)=>i%2?0:-1234567890)],
    ['L04',[10,12,9,18,22,15,28,31,25,34,39,42]]
  ];
  const lines=definitions.map(([id,...values])=>{
    const base=createChartBlock(id);
    const chart={...base,chartType:'line',title:id+' 数値ラベル検証',items:values[0].map((_,i)=>({id:id+'-item-'+i,label:id+'項目'+String(i+1).padStart(2,'0')})),series:values.map((v,i)=>({id:id+'-series-'+i,name:id+'系列'+(i+1),color:['#4455cc','#cc5544','#227744'][i],values:v})),appearance:{...base.appearance,showValues:true,showPoints:true,showLegend:true,showDataTable:true},citationIds:['s2']};
    return finish(id,[serializeChartBlock(chart)],['図1'],{lineRegression:true,expectOmission:id!=='L04'});
  });
  const keys=['landscape','portrait','square','boundary','photo','transparent'];
  const image=(id,key)=>serializeImageBlock([{id:ids[key],figureMetadata:{caption:id+' '+key+'資料情報',citationIds:['s1']}}],id+' '+key+'全体確認','center','normal',id);
  const parts=keys.map((key,i)=>image('I01F'+(i+1),key));
  for(const [index,pair] of [['landscape','photo'],['portrait','transparent']].entries())parts.push(serializeImageBlock(pair.map((key,i)=>({id:ids[key],comparisonLabel:(i?'RIGHT ':'LEFT ')+key,figureMetadata:{citationIds:['s1']}})),`I01C${index+1} 左右対応`,'center','comparison','I01C'+(index+1)));
  return [...lines,finish('I01',parts,['図1','図2','図3','図4','図5','図6','図7','図8'],{imageRegression:true})];
}
module.exports={buildRegressionCases};
