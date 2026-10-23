import assert from 'node:assert/strict';
export async function verifySiteAudit({page:p,baseURL,screenshotDirectory}){
 assert.match(baseURL,/^http:\/\/127\.0\.0\.1:\d+$/);
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await p.goto(baseURL);await p.waitForSelector('#collection-tools-trigger');
 await p.evaluate(()=>{
  const origin=location.origin,types=['ok','blocked','missing','server','challenge','slow'];
  const n={version:1,revision:crypto.randomUUID(),groups:[{id:'default',name:'合成测试收藏'}],bookmarks:types.map((type,i)=>({id:type,title:['正常网站','访问受限','页面不存在','服务器异常','安全验证页','较慢的网站'][i],url:origin+'/__test/audit/'+type,groupId:'default',icon:{mode:'text',text:'测',color:'#357260'}})),preferences:{openInNewTab:true,showKnowledge:false,compact:false}};
  localStorage.setItem('kb-test-navigation',JSON.stringify(n));localStorage.setItem('kb-test-icon-lookups','0');
 });
 await p.reload();await p.waitForSelector('.folder-button');
 const wait=fn=>p.waitForFunction(fn,undefined,{timeout:15000});
 await p.click('#collection-tools-trigger');await p.click('#audit-sites-button');await p.click('#audit-start');await wait(()=>JSON.parse(localStorage.getItem('kb-test-siteAudit'))?.state==='completed');
 let state=await p.evaluate(()=>({job:JSON.parse(localStorage.getItem('kb-test-siteAudit')),checks:[...document.querySelectorAll('#audit-list input')].map(e=>({checked:e.checked,disabled:e.disabled})),icons:localStorage.getItem('kb-test-icon-lookups')}));
 assert.deepEqual(state.job.rows.map(r=>r.status),['ok','restricted','httpError','httpError','restricted','ok']);assert.equal(state.checks.length,4);assert.ok(state.checks.every(c=>!c.checked)&&state.checks.filter(c=>c.disabled).length===2);assert.equal(state.icons,'0');
 if(screenshotDirectory)await p.screenshot({path:screenshotDirectory+'/audit-desktop.png'});
 // Selection alone never deletes; confirmation cancellation also keeps all data.
 await p.click('[data-audit-id="missing"] input');await p.click('#audit-review-delete');await p.click('[aria-label="取消删除"]');assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('kb-test-navigation')).bookmarks.length),6);
 await p.click('#audit-review-delete');await p.click('#audit-confirm-delete');await wait(()=>JSON.parse(localStorage.getItem('kb-test-navigation')).bookmarks.length===5);
 await wait(()=>!document.querySelector('#audit-undo').hidden);await p.click('#audit-undo');await wait(()=>JSON.parse(localStorage.getItem('kb-test-navigation')).bookmarks.length===6);
 await p.click('[data-close="audit-dialog"]');await p.click('.folder-button');assert.equal(await p.evaluate(()=>document.querySelectorAll('#folder-sites .audit-site-status:not(:empty)').length),6);await p.click('[data-close="folder-dialog"]');
 // Reopening and page reload only read persisted results, never start another scan.
 const id=state.job.id;await p.reload();await p.waitForSelector('#collection-tools-trigger');await p.click('#collection-tools-trigger');await p.click('#audit-sites-button');assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('kb-test-siteAudit')).id),id);
 // Background continues after closing the panel. Stop retains partial results.
 await p.click('#audit-start');await wait(()=>JSON.parse(localStorage.getItem('kb-test-siteAudit')).state==='running');await p.click('[data-close="audit-dialog"]');await wait(()=>JSON.parse(localStorage.getItem('kb-test-siteAudit')).state==='completed');await p.click('#collection-tools-trigger');await p.click('#audit-sites-button');
 await p.evaluate(()=>{__kbSiteAuditTest.pending=[];__kbSiteAuditTest.beforeFetch=()=>new Promise(resolve=>__kbSiteAuditTest.pending.push(resolve));});await p.click('#audit-start');await wait(()=>!document.querySelector('#audit-stop').hidden);await p.click('#audit-stop');await wait(()=>JSON.parse(localStorage.getItem('kb-test-siteAudit')).state==='stopped');await p.evaluate(()=>{delete __kbSiteAuditTest.beforeFetch;__kbSiteAuditTest.pending.forEach(resolve=>resolve());});
 assert.ok(await p.evaluate(()=>JSON.parse(localStorage.getItem('kb-test-siteAudit')).rows.some(r=>r.status==='cancelled')));
 // A changed bookmark URL makes its old result non-selectable and visible as stale.
 await p.click('#audit-start');await wait(()=>JSON.parse(localStorage.getItem('kb-test-siteAudit')).state==='completed');
 await p.evaluate(async()=>{const n=(await chrome.runtime.sendMessage({type:'navigation.get'})).data,s=n.bookmarks.find(b=>b.id==='missing');await chrome.runtime.sendMessage({type:'bookmark.update',revision:n.revision,...s,url:location.origin+'/__test/audit/ok?changed=1'});});
 await wait(()=>document.querySelector('[data-audit-id="missing"] .audit-state')?.textContent==='待重查');assert.equal(await p.evaluate(()=>document.querySelector('[data-audit-id="missing"] input').disabled),true);
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 if(screenshotDirectory)await p.screenshot({path:screenshotDirectory+'/audit-mobile.png'});
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 return {sites:6,defaultSelected:0,statuses:state.job.rows.map(r=>r.status),delete:'review, cancel, confirm and undo',persistence:'same report after reload, no automatic scan',background:'continues after close, explicit stop',stale:'changed URL cannot be deleted',icons:'zero lookups'};
}
