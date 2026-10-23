import assert from 'node:assert/strict';
export async function verifyRestrictedRetry({page:p,baseURL,screenshotDirectory}){
 assert.match(baseURL,/^http:\/\/127\.0\.0\.1:\d+$/);await p.cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await p.goto(baseURL);await p.waitForSelector('#collection-tools-trigger');
 await p.evaluate(async()=>{
  const n=(await chrome.runtime.sendMessage({type:'navigation.get'})).data;
  await chrome.runtime.sendMessage({type:'bookmark.add',revision:n.revision,title:'TEST ONLY 跳转授权',url:'https://labs.google/fx/zh/tools/flow',groupId:'default'});__kbAuditRedirectTest.enabled=true;
 });await p.click('#collection-tools-trigger');await p.click('#audit-sites-button');await p.click('#audit-start');
 const wait=fn=>p.waitForFunction(fn,undefined,{timeout:10000});await wait(()=>JSON.parse(localStorage.getItem('kb-test-siteAudit'))?.state==='completed');
 const state=await p.evaluate(()=>{const job=JSON.parse(localStorage.getItem('kb-test-siteAudit'));return {row:job.rows.find(r=>r.title==='TEST ONLY 跳转授权'),jobId:job.id,nav:JSON.parse(localStorage.getItem('kb-test-navigation'))};});
 assert.equal(state.row.status,'restricted');assert.equal(state.row.permissionTarget,'https://flow.google.com/');assert.equal(await p.evaluate(id=>document.querySelector(`[data-audit-id="${id}"] input`).disabled,state.row.id),true);
 assert.match(await p.evaluate(()=>document.querySelector('#audit-counts').textContent),/待复核/);
 const retry=`[data-audit-id="${state.row.id}"] .audit-retry`;
 if(screenshotDirectory)await p.screenshot({path:screenshotDirectory+'/restricted-review.png'});
 await p.evaluate(()=>{__captureTest.deny=true;});await p.click(retry);await wait(()=>!document.querySelector('#audit-error').hidden);assert.equal(await p.evaluate(()=>__kbAuditRedirectTest.calls),1);
 await p.evaluate(()=>{__captureTest.deny=false;});await p.click(retry);await wait(()=>JSON.parse(localStorage.getItem('kb-test-siteAudit')).rows.find(r=>r.title==='TEST ONLY 跳转授权').status==='redirect');
 assert.equal(await p.evaluate(()=>__kbAuditRedirectTest.calls),2);assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('kb-test-navigation'))),state.nav);
 assert.equal(await p.evaluate(id=>document.querySelector(`[data-audit-id="${id}"] input`).disabled,state.row.id),true);assert.equal(await p.evaluate(()=>document.querySelectorAll('.audit-retry').length),0);
 return {ungranted:'restricted, never selectable for deletion',denied:'no retry',granted:'only selected original URL retried, redirect still needs review',bookmarks:'unchanged'};
}

export async function verifyIconAuthorization({page:p,baseURL}){
 await p.goto(baseURL);await p.waitForSelector('#collection-tools-trigger');
 await p.evaluate(async()=>{const {fallbackBookmarkIcon}=await import('/bookmark-icon.mjs');const site={id:'permission',title:'TEST ONLY 图标授权',url:'https://permission.example/private?token=secret',groupId:'default'};site.icon=fallbackBookmarkIcon(site.title,site.url);localStorage.setItem('kb-test-navigation',JSON.stringify({version:1,revision:crypto.randomUUID(),groups:[{id:'default',name:'合成收藏'}],bookmarks:[site],preferences:{openInNewTab:true,showKnowledge:false,compact:false}}));});
 await p.reload();await p.waitForSelector('#collection-tools-trigger');await p.evaluate(()=>{__iconBatchTest.permissionHosts=['permission.example'];});
 const wait=fn=>p.waitForFunction(fn,undefined,{timeout:10000});await p.click('#collection-tools-trigger');await p.click('#icon-batch-button');await p.click('#icon-batch-start');await wait(()=>!document.querySelector('#icon-batch-authorize').hidden);
 const before=await p.evaluate(()=>JSON.parse(localStorage.getItem('kb-test-navigation')));assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('kb-test-iconBatch')).rows[0].needsPermission),true);
 await p.evaluate(()=>{__captureTest.deny=true;});await p.click('#icon-batch-authorize');await wait(()=>!document.querySelector('#icon-batch-error').hidden);assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('kb-test-navigation'))),before);
 await p.evaluate(()=>{__captureTest.deny=false;});await p.click('#icon-batch-authorize');await wait(()=>JSON.parse(localStorage.getItem('kb-test-iconBatch')).rows[0].status==='updated');assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('kb-test-navigation')).bookmarks[0].icon.mode),'auto');
 return {fallbackAuthorization:'explicit per-failed-host grant, deny preserves icon, accept saves result'};
}
