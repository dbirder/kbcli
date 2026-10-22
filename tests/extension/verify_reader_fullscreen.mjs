import assert from 'node:assert/strict';
export async function verifyReaderFullscreen({page:p,screenshotDirectory}){
 const article='button[aria-label="阅读文章：从收集到沉淀：我的知识库工作流"]';
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await p.click(article);await p.waitForFunction(()=>document.querySelector('#document-content table')&&getComputedStyle(document.querySelector('#document-dialog')).opacity==='1');
 const state=()=>p.evaluate(()=>{const d=document.querySelector('#document-dialog'),r=d.getBoundingClientRect(),b=document.querySelector('#reader-expand');return {x:r.x,y:r.y,width:r.width,height:r.height,open:d.open,pressed:b.getAttribute('aria-pressed'),label:b.getAttribute('aria-label'),scroll:document.querySelector('#document-scroll').scrollTop};});
 const original=await state();assert.equal(original.width,860);assert.equal(original.pressed,'false');
 await p.evaluate(()=>{const s=document.querySelector('#document-scroll');s.scrollTop=600;const top=s.getBoundingClientRect().top;const el=[...document.querySelectorAll('#document-content h2,#document-content h3,#document-content p,#document-content li,#document-content pre,#document-content table')].find(el=>{const r=el.getBoundingClientRect();return r.bottom>top+24&&r.top<top+s.clientHeight;});el.dataset.qaAnchor='';window.__anchorOffset=el.getBoundingClientRect().top-top;});
 await p.click('#reader-expand');const expanded=await state();assert.deepEqual([expanded.x,expanded.y,expanded.width,expanded.height],[0,0,1440,1000]);assert.equal(expanded.pressed,'true');assert.equal(expanded.label,'恢复阅读窗口');
 const drift=()=>p.evaluate(()=>document.querySelector('[data-qa-anchor]').getBoundingClientRect().top-document.querySelector('#document-scroll').getBoundingClientRect().top-window.__anchorOffset);assert.ok(Math.abs(await drift())<2);
 await p.screenshot({path:screenshotDirectory+'/fullscreen.png'});
 await p.click('#reader-expand');assert.equal((await state()).width,860);assert.ok(Math.abs(await drift())<2);
 // Keyboard activation toggles the same button; Escape restores before a second Escape dismisses.
 await p.focus('#reader-expand');await p.keyboard.press('Enter');assert.equal((await state()).pressed,'true');await p.keyboard.press('Escape');assert.equal((await state()).open,true);assert.equal((await state()).pressed,'false');assert.equal(await p.evaluate(()=>document.activeElement.id),'reader-expand');
 await p.click('#reader-expand');await p.click('#document-dialog .close-button');await p.waitForFunction(()=>!document.querySelector('#document-dialog').open);assert.equal((await state()).pressed,'false');
 await p.click(article);await p.waitForFunction(()=>document.querySelector('#document-content h2'));assert.equal((await state()).width,860);
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await p.click('#reader-expand');let mobile=await state();assert.deepEqual([mobile.x,mobile.y,mobile.width,mobile.height],[0,0,390,844]);assert.ok(await p.evaluate(()=>document.querySelector('#document-scroll').scrollWidth<=document.querySelector('#document-scroll').clientWidth));
 await p.screenshot({path:screenshotDirectory+'/mobile.png'});await p.click('#reader-expand');assert.equal((await state()).width,370);
 await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('#document-dialog').open);assert.equal(await p.evaluate(()=>document.querySelector('#knowledge-panel').open),true);
 return {desktop:'860px ↔ 1440×1000 viewport',position:'visible paragraph anchor drift <2px in both directions',keyboard:'Enter toggles; Escape restores; next Escape closes',reset:'close from expanded mode resets next article to normal',mobile:'390×844 full viewport; restores 370px; no horizontal overflow'};
}
