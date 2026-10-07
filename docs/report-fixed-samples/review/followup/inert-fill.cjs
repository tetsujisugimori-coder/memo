const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch(),page=await browser.newPage();
 await page.setContent('<div inert><textarea id="editor">old body</textarea></div>');
 await page.locator('#editor').fill('new body');
 console.log(JSON.stringify({inert:true,actual:await page.locator('#editor').inputValue()}));
 await page.evaluate(()=>document.querySelector('div').inert=false);
 await page.locator('#editor').fill('new body');
 console.log(JSON.stringify({inert:false,actual:await page.locator('#editor').inputValue()}));
 await browser.close();
})();
