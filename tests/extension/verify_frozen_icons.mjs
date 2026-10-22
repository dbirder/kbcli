import assert from 'node:assert/strict';
export async function verifyFrozenIcons({page:p,secondPage:q,baseURL}){
 assert.match(baseURL,/^http:\/\/127\.0\.0\.1:\d+$/);
 for(const page of [p,q]){await page.cdp('Network.setCacheDisabled',{cacheDisabled:true});await page.cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});}
 await p.goto(baseURL);await p.waitForSelector('.folder-button');
 // Seed a readable pre-0.11 cache and an uncached old site. No production data.
 await p.evaluate(async()=>{
  const origin='https://cached.example',source='chrome',base='https://kb-favicon-cache.invalid/',cache=await caches.open('kb-favicons-v1');
  const key=base+'data?'+new URLSearchParams({origin,source,ticket:'old',epoch:'1'});
  await cache.put(key,await fetch('/assets/icons/icon-128.png'));await cache.put(base+'index?'+new URLSearchParams({origin,source}),Response.json({missing:false,epoch:1,body:key}));
  const n={version:1,revision:crypto.randomUUID(),groups:[{id:'default',name:'常用'}],bookmarks:[{id:'cached',title:'旧缓存图片',url:origin+'/private?q=1',groupId:'default'},{id:'missing',title:'缺失图片',url:'https://missing.example/',groupId:'default'},{id:'manual',title:'手动文字',url:'https://manual.example/',groupId:'default',icon:{mode:'text',text:'定',color:'#2c756a'}}],preferences:{openInNewTab:true,showKnowledge:false,compact:false}};
  localStorage.setItem('kb-test-navigation',JSON.stringify(n));localStorage.setItem('kb-test-icon-lookups','0');localStorage.setItem('kb-test-icon-offline','0');
 });
 const wait=fn=>p.waitForFunction(fn,undefined,{timeout:10000}),nav=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('kb-test-navigation'))),lookups=()=>p.evaluate(()=>Number(localStorage.getItem('kb-test-icon-lookups')||0));
 async function reload(){await p.reload();await p.waitForSelector('.folder-button');}
 async function assertLocal(page){const state=await page.evaluate(()=>({images:[...document.querySelectorAll('.mini-icon img,.site-icon img')].map(e=>e.src),routes:performance.getEntriesByType('resource').map(e=>e.name).filter(u=>/\/_favicon\/|\/_kb-favicon\//.test(u))}));assert.ok(state.images.every(u=>u.startsWith('data:image/webp;base64,')));assert.deepEqual(state.routes,[]);}
 await reload();let n=await nav();assert.equal(n.bookmarks[0].icon.mode,'auto');assert.ok(n.bookmarks[0].icon.dataURL.startsWith('data:image/webp;base64,'));assert.equal(n.bookmarks[1].icon.mode,'text');assert.equal(n.bookmarks[2].icon.text,'定');
 const initial=structuredClone(n);await assertLocal(p);assert.equal(await lookups(),0);
 for(let i=0;i<2;i++){await reload();await p.click('.folder-button');await assertLocal(p);assert.equal(await lookups(),0);assert.deepEqual((await nav()).bookmarks,initial.bookmarks);await p.click('[data-close="folder-dialog"]');}
 await q.goto(baseURL);await q.waitForSelector('.folder-button');await assertLocal(q);assert.equal(await lookups(),0);
 // Classic creation captures once; renaming later must preserve the same image.
 await p.click('#add-site-button');await p.fill('#site-title','创建时固定');await p.fill('#site-url','https://created.example/path?q=1#part');await p.click('#save-site-button');await wait(()=>!document.querySelector('#site-dialog').open);
 n=await nav();const created=n.bookmarks.find(b=>b.title==='创建时固定'),image=created.icon.dataURL;assert.ok(image);assert.equal(await lookups(),1);
 await reload();await q.reload();await q.waitForSelector('.folder-button');assert.equal(await lookups(),1);await assertLocal(p);
 await p.click('.folder-button');await p.hover(`#folder-sites [data-site-id="${created.id}"]`);await p.click(`#folder-sites [data-site-id="${created.id}"] button[aria-label^="编辑网站"]`);await p.fill('#site-title','改名不改图片');await p.click('#save-site-button');await wait(()=>!document.querySelector('#site-dialog').open);
 assert.equal((await nav()).bookmarks.find(b=>b.id===created.id).icon.dataURL,image);assert.equal(await lookups(),1);
 await p.hover(`#folder-sites [data-site-id="${created.id}"]`);await p.click(`#folder-sites [data-site-id="${created.id}"] button[aria-label^="编辑网站"]`);await p.click('#edit-site-icon-button');await wait(()=>document.querySelector('#capture-frame').contentDocument?.querySelector('#save-capture:not(:disabled)'));
 assert.equal(await lookups(),1);await p.click('#reload-icon');await wait(()=>document.querySelector('#capture-frame').contentDocument.querySelector('#image-status').textContent.includes('图片已加载'));assert.equal(await lookups(),2);
 await p.click('#save-capture');await wait(()=>!document.querySelector('#capture-dialog').open&&!document.querySelector('#capture-frame').getAttribute('src'));
 const fixedImage=(await nav()).bookmarks.find(b=>b.id===created.id).icon.dataURL;
 await p.hover(`#folder-sites [data-site-id="${created.id}"]`);await p.click(`#folder-sites [data-site-id="${created.id}"] button[aria-label^="编辑网站"]`);await p.fill('#site-url','https://changed.example/path?q=2');await p.click('#edit-site-icon-button');
 await wait(()=>document.querySelector('#capture-frame').contentDocument?.querySelector('#capture-url')?.value==='https://changed.example/path?q=2');
 assert.equal(await p.evaluate(()=>document.querySelector('#capture-frame').contentDocument.querySelector('#preview-icon img').src),fixedImage);
 await p.click('#save-capture');await wait(()=>!document.querySelector('#capture-dialog').open&&!document.querySelector('#capture-frame').getAttribute('src'));assert.equal(await lookups(),2);assert.equal((await nav()).bookmarks.find(b=>b.id===created.id).icon.dataURL,fixedImage);
 await p.click('[data-close="folder-dialog"]');
 // Offline reload cannot retry a source or replace any fixed image.
 await p.evaluate(()=>localStorage.setItem('kb-test-icon-offline','1'));const fixed=structuredClone((await nav()).bookmarks);
 await reload();await q.reload();await q.waitForSelector('.folder-button');await assertLocal(p);await assertLocal(q);assert.equal(await lookups(),2);assert.deepEqual((await nav()).bookmarks,fixed);
 await p.click('#add-site-button');await p.fill('#site-title','创建失败固定文字');await p.fill('#site-url','https://failed.example/');await p.click('#save-site-button');await wait(()=>!document.querySelector('#site-dialog').open);
 assert.equal((await nav()).bookmarks.find(b=>b.title==='创建失败固定文字').icon.mode,'text');assert.equal(await lookups(),3);await reload();assert.equal(await lookups(),3);
 // Toolbar creation also captures at most once on failure, closes after save,
 // and reopening an already saved URL does not perform another lookup.
 await p.evaluate(url=>{const b=document.createElement('button');b.id='test-launch-capture';b.textContent='打开测试收藏';b.style.cssText='position:fixed;top:80px;left:20px;z-index:9999;background:white;color:black;padding:12px';b.addEventListener('click',()=>{window.__captureChild=window.open(url,'_blank');});document.body.append(b);},baseURL+'/popup.html');
 let pending=p.waitForEvent('popup');await p.click('#test-launch-capture');let popup=await pending;await popup.waitForSelector('#save-capture:not(:disabled)');await popup.fill('#capture-title','快捷创建固定文字');await popup.click('#save-capture');await wait(()=>window.__captureChild.closed);assert.equal(await lookups(),4);
 pending=p.waitForEvent('popup');await p.click('#test-launch-capture');popup=await pending;await popup.waitForSelector('#save-capture:not(:disabled)');assert.equal(await lookups(),4);await popup.fill('#capture-title','快捷编辑不请求图片');await popup.click('#save-capture');await wait(()=>window.__captureChild.closed);assert.equal(await lookups(),4);
 await reload();await q.reload();await q.waitForSelector('.folder-button');await assertLocal(p);await assertLocal(q);assert.equal(await lookups(),4);
 return {oldCache:'readable image frozen locally; missing image fixed as text',newTabs:'zero source/legacy-route requests on reopen, refresh, folder expansion or offline reload',creation:'one lookup per classic/toolbar create; failed icons never retry after save',editing:'rename and editor opening make zero lookups; explicit refresh alone adds one',total:(await nav()).bookmarks.length,lookups:4};
}
