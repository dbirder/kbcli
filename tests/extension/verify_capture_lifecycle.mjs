import assert from 'node:assert/strict';
// Synthetic loopback fixture only. Success must close real UI, not a mock close.
export async function verifyCaptureLifecycle({page:p,baseURL,screenshotDirectory}){
 assert.match(baseURL,/^http:\/\/127\.0\.0\.1:\d+$/);
 await p.cdp('Network.setCacheDisabled',{cacheDisabled:true});await p.cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await p.goto(baseURL);await p.waitForSelector('.folder-button');
 await p.evaluate(()=>{localStorage.setItem('kb-test-icon-offline','0');localStorage.setItem('kb-test-navigation',JSON.stringify({version:1,revision:crypto.randomUUID(),groups:[{id:'default',name:'常用'},{id:'target',name:'其他分组'}],bookmarks:[{id:'test-site',title:'测试收藏',url:location.origin+'/sample/item',groupId:'default',icon:{mode:'text',text:'旧',color:'#2c756a'}}],preferences:{openInNewTab:true,showKnowledge:false,compact:false}}));localStorage.setItem('kb-test-quickCapture',JSON.stringify({version:1,drafts:[],lastGroup:'default'}));});
 await p.reload();await p.waitForSelector('.folder-button');await p.click('.folder-button[aria-label*="常用"]');
 const wait=(fn,arg)=>p.waitForFunction(fn,arg,{timeout:8000});
 const nav=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('kb-test-navigation')));
 async function editor(title){await p.hover('#folder-sites .site-card');await p.click('#folder-sites button[aria-label^="编辑网站"]');if(title)await p.fill('#site-title',title);await p.click('#edit-site-icon-button');await wait(()=>document.querySelector('#capture-dialog').open&&document.querySelector('#capture-frame').contentDocument?.querySelector('#save-capture:not(:disabled)'));}
 async function closed(){await wait(()=>!document.querySelector('#capture-dialog').open&&!document.querySelector('#capture-frame').getAttribute('src'));}
 await editor('基础表单的未保存名称');
 assert.equal(await p.evaluate(()=>document.querySelector('#capture-frame').contentDocument.querySelector('#capture-title').value),'基础表单的未保存名称');
 await p.evaluate(()=>{const u=new URL(document.querySelector('#capture-frame').src);window.postMessage({type:'kb-capture:saved',channel:u.searchParams.get('channel')},location.origin);});
 assert.equal(await p.evaluate(()=>document.querySelector('#capture-dialog').open),true);
 await p.fill('#capture-title','原地编辑后的收藏');await p.click('label:has(input[value="image"])');await p.fill('#image-url',baseURL+'/assets/icons/icon-128.png');await p.click('#load-image');await wait(()=>document.querySelector('#capture-frame').contentDocument.querySelector('#image-status').textContent.includes('图片已加载'));
 if(screenshotDirectory)await p.screenshot({path:screenshotDirectory+'/chrome-kb-0101-inline-editor.png'});
 await p.keyboard.press('Escape');await closed();assert.equal((await nav()).bookmarks[0].title,'测试收藏');
 await editor();assert.equal(await p.evaluate(()=>document.querySelector('#capture-frame').contentDocument.querySelector('#capture-title').value),'原地编辑后的收藏');
 const image=await p.evaluate(()=>document.querySelector('#capture-frame').contentDocument.querySelector('#preview-icon img').src);
 await p.evaluate(()=>{const w=document.querySelector('#capture-frame').contentWindow,send=w.chrome.runtime.sendMessage;w.__releaseSave=null;w.chrome.runtime.sendMessage=async message=>{if(message.type==='capture.save'){await new Promise(resolve=>w.__releaseSave=resolve);w.chrome.runtime.sendMessage=send;}return send(message);};});await p.click('#save-capture');await wait(()=>document.querySelector('#close-capture-button').disabled);
 await p.mouse.click(10,10);assert.equal(await p.evaluate(()=>document.querySelector('#capture-dialog').open),true);await p.evaluate(()=>document.querySelector('#capture-frame').contentWindow.__releaseSave());await closed();
 assert.equal((await nav()).bookmarks[0].title,'原地编辑后的收藏');assert.equal((await nav()).bookmarks[0].icon.dataURL,image);
 assert.equal(await p.evaluate(()=>document.querySelector('#folder-dialog').open&&!document.querySelector('#site-dialog').open&&!document.querySelector('#capture-frame').getAttribute('src')),true);
 assert.equal(await p.evaluate(()=>document.querySelector('#folder-sites .site-icon img').src),image);
 // A backdrop click first dismisses the child picker, then the editor.
 await editor();await p.click('#group-trigger');await wait(()=>document.querySelector('#capture-frame').contentDocument.querySelector('#group-picker').matches(':popover-open'));
 await p.mouse.click(10,10);await wait(()=>!document.querySelector('#capture-frame').contentDocument.querySelector('#group-picker').matches(':popover-open'));
 assert.equal(await p.evaluate(()=>document.querySelector('#capture-dialog').open),true);await p.mouse.click(10,10);await closed();
 // Failed save stays open and retains the draft for an explicit retry.
 await editor();await p.fill('#capture-title','冲突后明确保存');
 const latest=await p.evaluate(()=>{const n=JSON.parse(localStorage.getItem('kb-test-navigation'));n.revision=crypto.randomUUID();n.bookmarks[0].title='其他标签页的新名称';localStorage.setItem('kb-test-navigation',JSON.stringify(n));return n.revision;});
 await p.click('#save-capture');await wait(()=>!document.querySelector('#capture-frame').contentDocument.querySelector('#form-error').hidden);
 assert.equal(await p.evaluate(()=>document.querySelector('#capture-dialog').open),true);assert.equal((await nav()).revision,latest);
 assert.equal(await p.evaluate(()=>document.querySelector('#capture-frame').contentDocument.querySelector('#capture-title').value),'冲突后明确保存');await p.click('#save-capture');await closed();
 assert.equal((await nav()).bookmarks[0].title,'冲突后明确保存');
 // The toolbar editor is represented by a genuinely script-opened window. Its
 // success path must close that window only after the saved record is visible.
 await p.click('[data-close="folder-dialog"]');
 await p.evaluate(url=>{const b=document.createElement('button');b.id='test-launch-capture';b.textContent='打开隔离收藏弹窗';b.style.cssText='position:fixed;top:80px;left:20px;z-index:9999;background:white;color:black;padding:12px';b.addEventListener('click',()=>{window.__captureChild=window.open(url,'_blank');});document.body.append(b);},baseURL+'/popup.html');
 let pending=p.waitForEvent('popup');await p.click('#test-launch-capture');let popup=await pending;await popup.waitForSelector('#save-capture:not(:disabled)');await popup.fill('#capture-title','');await popup.click('#save-capture');
 assert.equal(await p.evaluate(()=>window.__captureChild.closed),false);
 await popup.fill('#capture-title','保存后自动关闭');await popup.click('label:has(input[value="text"])');await popup.fill('#icon-text','关');await popup.click('#save-capture');await wait(()=>window.__captureChild.closed);
 assert.equal((await nav()).bookmarks.length,2);assert.ok((await nav()).bookmarks.some(b=>b.title==='保存后自动关闭'&&b.url.endsWith('/sample/current?keep=1#part')));
 pending=p.waitForEvent('popup');await p.click('#test-launch-capture');popup=await pending;await popup.waitForSelector('#save-capture:not(:disabled)');await popup.fill('#capture-title','弹窗失败时不关闭');
 await p.evaluate(()=>{const n=JSON.parse(localStorage.getItem('kb-test-navigation'));n.revision=crypto.randomUUID();n.bookmarks[1].title='并发修改保留';localStorage.setItem('kb-test-navigation',JSON.stringify(n));});
 await popup.click('#save-capture');await popup.waitForFunction(()=>!document.querySelector('#form-error').hidden,undefined,{timeout:8000});assert.equal(await p.evaluate(()=>window.__captureChild.closed),false);
 await popup.click('#save-capture');await wait(()=>window.__captureChild.closed);assert.equal((await nav()).bookmarks.length,2);
 await p.evaluate(()=>document.querySelector('#test-launch-capture').remove());
 return {toolbar:'real window closes on successful create/edit, remains open on invalid or conflicted save',inline:'same tab, initial inputs and draft retained, success closes editor and refreshes card',cancel:'Escape and backdrop, picker closes first',busy:'backdrop cannot dismiss pending save',messages:'foreign-source close message ignored',total:2};
}
