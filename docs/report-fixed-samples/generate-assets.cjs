// Developer-only deterministic synthetic assets. Never executed by regression tests.
// Original rulers are retained; overlays are idempotent. No external image/font service.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch();const page=await browser.newPage();const manifest={license:'CC0-1.0; project-authored deterministic synthetic test materials; no third-party photographs',assets:{}};
 const entries=[['landscape',1600,900],['portrait',900,1600],['square',1000,1000],['boundary',800,3200],['photo',1400,1000],['transparent',1000,800]];
 for(const [index,[id,width,height]] of entries.entries()){
  const file=path.join(__dirname,'assets',id+'.png');const previous=index<4?'data:image/png;base64,'+fs.readFileSync(file).toString('base64'):null;
  const result=await page.evaluate(async({id,width,height,index,previous})=>{
   const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const c=canvas.getContext('2d');
   if(previous){const i=new Image();i.src=previous;await i.decode();c.drawImage(i,0,0);}
   else if(id==='photo'){
    // Still-life equivalent: continuous tones, shadows, grain, books, glass and fine detail.
    const data=c.createImageData(width,height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){
     const shade=0.35+0.65*Math.max(0,1-Math.hypot((x-350)/1400,(y-180)/1100));const grain=((x*37+y*19+x*y*3)%23)-11;const p=(y*width+x)*4;
     data.data[p]=Math.max(0,Math.min(255,205*shade+grain));data.data[p+1]=Math.max(0,Math.min(255,160*shade+grain));data.data[p+2]=Math.max(0,Math.min(255,115*shade+grain));data.data[p+3]=255;
    }c.putImageData(data,0,0);
    c.fillStyle='#30251c';c.fillRect(0,700,width,300);
    for(let n=0;n<8;n++){c.fillStyle=['#a94225','#364e62','#d5b875'][n%3];c.fillRect(160+n*115,340+n*23,90,390-n*23);c.fillStyle='#efe4ce';for(let k=0;k<10;k++)c.fillRect(169+n*115,390+n*23+k*20,72,2);}
    const g=c.createLinearGradient(850,0,1220,0);g.addColorStop(0,'#121c24');g.addColorStop(.45,'#b2cfcc');g.addColorStop(.52,'#f8ffff');g.addColorStop(.7,'#48736f');g.addColorStop(1,'#121c24');c.fillStyle=g;c.beginPath();c.ellipse(1120,520,110,190,0,0,2*Math.PI);c.fill();
   }else{
    // Alpha=0 background and semi-transparent overlapping colored shapes.
    for(let n=0;n<6;n++){c.fillStyle=['#e4404090','#2277dd80','#44aa6680'][n%3];c.beginPath();c.arc(250+n*100,300+n%2*130,170,0,2*Math.PI);c.fill();}
    c.strokeStyle='#202040';c.lineWidth=8;c.strokeRect(210,210,580,380);
   }
   c.strokeStyle='#102038';c.lineWidth=8;c.strokeRect(4,4,width-8,height-8);
   const size=Math.floor(Math.min(width,height)*.12),colors=['#e82c3a','#158050','#175cdc','#edab16','#9d2dde','#18a5b0'];
   const patches=[['TL',.025,.025],['TR',.975-size/width,.025],['BL',.025,.975-size/height],['BR',.975-size/width,.975-size/height],['CENTER',.5-size/width/2,.5-size/height/2]];
   const marks=[];for(const [n,[name,nx,ny]] of patches.entries()){
    const x=Math.round(nx*width),y=Math.round(ny*height),color=colors[(index+n)%colors.length];c.fillStyle=color;c.fillRect(x,y,size,size);c.strokeStyle='#000000';c.lineWidth=3;c.strokeRect(x,y,size,size);
    c.fillStyle='#ffffff';c.font=`bold ${Math.floor(size*.17)}px monospace`;c.fillText(id.toUpperCase(),x+4,y+size*.25);c.fillText(name,x+4,y+size*.50);c.font=`${Math.floor(size*.12)}px monospace`;c.fillText(`${width}x${height}`,x+4,y+size*.73);c.fillText('UP ^',x+4,y+size*.91);
    marks.push({name,x,y,size,color});
   }
   return {png:canvas.toDataURL('image/png').split(',')[1],marks};
  },{id,width,height,index,previous});
  fs.writeFileSync(file,Buffer.from(result.png,'base64'));manifest.assets[id]={width,height,marks:result.marks};
 }
 fs.writeFileSync(path.join(__dirname,'assets','manifest.json'),JSON.stringify(manifest,null,2)+'\n');await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
