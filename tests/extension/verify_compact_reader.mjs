import assert from 'node:assert/strict';
export async function verifyCompactReader({page:p,screenshotDirectory}){
 const article='button[aria-label="阅读文章：从收集到沉淀：我的知识库工作流"]';
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await p.click('#knowledge-toggle');await p.click('#knowledge-tab');await p.waitForSelector(article);
 const rows=await p.evaluate(()=>[...document.querySelectorAll('.document-button')].map(el=>{const r=el.getBoundingClientRect();return {x:r.x,width:r.width};}));assert.ok(rows.length>1);assert.ok(rows.every(row=>row.x===rows[0].x&&row.width===rows[0].width));
 await p.click(article);await p.waitForFunction(()=>document.querySelector('#reader-outline:not([hidden])')&&document.querySelector('#document-content h2'));
 assert.equal(await p.evaluate(()=>document.querySelector('#reader-outline').open),false);
 const before=await p.evaluate(()=>{const r=document.querySelector('#document-content').getBoundingClientRect();return {x:r.x,width:r.width,dialog:document.querySelector('#document-dialog').getBoundingClientRect().width};});assert.equal(before.dialog,860);
 await p.click('#reader-outline summary');assert.equal(await p.evaluate(()=>document.querySelector('#reader-outline').open),true);
 await p.keyboard.press('Space');assert.equal(await p.evaluate(()=>document.querySelector('#reader-outline').open),false);await p.keyboard.press('Space');assert.equal(await p.evaluate(()=>document.querySelector('#reader-outline').open),true);
 await p.screenshot({path:screenshotDirectory+'/outline-open.png'});
 const after=await p.evaluate(()=>{const r=document.querySelector('#document-content').getBoundingClientRect();return {x:r.x,width:r.width};});assert.deepEqual(after,{x:before.x,width:before.width});
 await p.click('#article-outline button:first-child');await p.waitForFunction(()=>!document.querySelector('#reader-outline').open);
 const target=await p.evaluate(()=>{const r=document.activeElement.getBoundingClientRect(),s=document.querySelector('#document-scroll').getBoundingClientRect();return {tag:document.activeElement.tagName,visible:r.top>=s.top&&r.bottom<=s.bottom};});assert.equal(target.tag,'H2');assert.ok(target.visible);
 await p.click('.reader-size[data-size="18"]');await p.waitForFunction(()=>getComputedStyle(document.querySelector('.markdown-body')).fontSize==='18px');
 await p.click('#document-dialog .close-button');await p.waitForFunction(()=>!document.querySelector('#document-dialog').open);
 await p.click(article);await p.waitForFunction(()=>document.querySelector('#document-content h2'));assert.equal(await p.evaluate(()=>document.querySelector('#reader-outline').open),false);
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await p.click('#reader-outline summary');
 assert.equal(await p.evaluate(()=>getComputedStyle(document.querySelector('#article-outline')).display),'block');assert.ok(await p.evaluate(()=>document.querySelector('#document-scroll').scrollWidth<=document.querySelector('#document-scroll').clientWidth));
 await p.screenshot({path:screenshotDirectory+'/mobile-outline.png'});
 await p.click('#article-outline button:first-child');assert.ok(await p.evaluate(()=>/^H[23]$/.test(document.activeElement.tagName)));
 return {list:'single column aligned rows',reader:before,outline:'collapsed by default; Space toggles; selection collapses and focuses visible heading; body width stable',mobile:'390px directory available, no horizontal overflow',font:'18px persisted reader preference remains functional'};
}
