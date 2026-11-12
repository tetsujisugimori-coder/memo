'use strict';
const {webkit} = require('playwright');
(async()=>{
  const browser=await webkit.launch({headless:true});
  const page=await browser.newPage();
  await page.goto('data:text/html,<div class="chart-block-editor"><input></div>');
  await page.locator('input').fill('140');
  await new Promise(r=>setTimeout(r,1300));
  process.send({type:'ready',browserVersion:browser.version()});
  process.on('message',async m=>{
    if(m?.type!=='stage4-last')return;
    await page.locator('input').fill('Infinity');
    process.send({type:'last-input',requestId:m.requestId,value:await page.locator('input').inputValue()});
  });
})().catch(e=>{console.error(e);process.exitCode=1;});
