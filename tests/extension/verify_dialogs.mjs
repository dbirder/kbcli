// Browser regression against serve_fixture.py. Only synthetic local data is modified.
import assert from 'node:assert/strict';
export async function verifyDialogs({page,baseURL,forceFallback=false,screenshotPath}) {
  assert.match(baseURL,/^http:\/\/127\.0\.0\.1:\d+$/);
  const rawClick=async(x,y)=>{await page.cdp('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await page.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});};
  const fill=(selector,value)=>page.evaluate(({selector,value})=>{const input=document.querySelector(selector);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}, {selector,value});
  const click=selector=>page.evaluate(selector=>{const button=document.querySelector(selector);button.focus();button.click();},selector);
  const ready=id=>page.waitForFunction(id=>document.getElementById(id).open&&getComputedStyle(document.getElementById(id)).opacity==='1',id);
  const closed=id=>page.waitForFunction(id=>!document.getElementById(id).open&&getComputedStyle(document.getElementById(id)).display==='none',id);
  // All dialogs leave a backdrop at the upper-left, on desktop and narrow screens.
  const outside=async id=>{await rawClick(2,2);await closed(id);};
  await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await page.goto(baseURL);await page.waitForFunction(()=>document.querySelectorAll('.folder-button').length>0);
  if(forceFallback)await page.evaluate(async()=>{const {bindLightDismiss}=await import('/ui.mjs');for(const dialog of document.querySelectorAll('dialog')){bindLightDismiss(dialog,{nativeSupported:false});dialog.setAttribute('closedby','closerequest');}});
  if(!await page.evaluate(()=>JSON.parse(localStorage.getItem('kb-test-connection')||'null'))){await click('#settings-button');await ready('settings-dialog');await fill('#server-input',baseURL);await fill('#token-input','ui-test-user');await click('#connect-button');await closed('settings-dialog');await page.waitForFunction(()=>!document.querySelector('#pending-badge').hidden);}
  const geometry=()=>page.evaluate(()=>{const r=id=>{const n=document.getElementById(id).getBoundingClientRect();return {x:n.x,y:n.y,width:n.width,height:n.height};};return {home:r('home-main'),clock:r('clock'),folders:r('site-groups')};});
  const before=await geometry();await click('#knowledge-toggle');await ready('knowledge-panel');assert.deepEqual(await geometry(),before);
  assert.equal(await page.evaluate(()=>document.querySelector('#knowledge-panel').matches(':modal')),true);
  if(screenshotPath)await page.screenshot({path:screenshotPath});
  await click('#add-button');await ready('task-dialog');await outside('task-dialog');assert.equal(await page.evaluate(()=>document.querySelector('#knowledge-panel').open),true);
  await click('#knowledge-settings');await ready('settings-dialog');await fill('#token-input','test-secret-not-saved');await outside('settings-dialog');assert.equal(await page.evaluate(()=>document.querySelector('#token-input').value),'');assert.equal(await page.evaluate(()=>document.querySelector('#knowledge-panel').open),true);
  await outside('knowledge-panel');assert.equal(await page.evaluate(()=>document.activeElement.id),'knowledge-toggle');assert.deepEqual(await geometry(),before);
  await click('#add-site-button');await ready('site-dialog');await fill('#site-title','只编辑，不提交');await click('#site-title');assert.equal(await page.evaluate(()=>document.querySelector('#site-dialog').open),true);
  const inside=await page.evaluate(()=>{const r=document.querySelector('#site-title').getBoundingClientRect();return {x:r.left+20,y:r.top+15};});await page.cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:inside.x,y:inside.y,button:'left',clickCount:1});await page.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2,button:'left',buttons:1});await page.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:2,y:2,button:'left',clickCount:1});assert.equal(await page.evaluate(()=>document.querySelector('#site-dialog').open),true);await outside('site-dialog');
  await click('#new-group-button');await ready('group-dialog');await outside('group-dialog');
  await click('.folder-button');await ready('folder-dialog');await click('#folder-add');await ready('site-dialog');await outside('site-dialog');assert.equal(await page.evaluate(()=>document.querySelector('#folder-dialog').open),true);await outside('folder-dialog');
  await page.evaluate(()=>{window.__dialogVerification='standard passed';});
  // Pause an actual fixture write to prove that cancel guards cover light-dismiss.
  await click('#knowledge-toggle');await ready('knowledge-panel');await click('#add-button');await ready('task-dialog');
  await page.evaluate(()=>{const original=chrome.runtime.sendMessage;window.__releaseWrite=null;chrome.runtime.sendMessage=async message=>{if(message.type==='create'){await new Promise(resolve=>{window.__releaseWrite=resolve;});chrome.runtime.sendMessage=original;}return original(message);};});
  await fill('#task-title','弹窗关闭保护实测'+(forceFallback?'兼容':'原生'));await click('#save-task-button');await page.waitForFunction(()=>typeof window.__releaseWrite==='function');await rawClick(2,2);assert.equal(await page.evaluate(()=>document.querySelector('#task-dialog').open),true);await page.evaluate(()=>{window.__releaseWrite();});await closed('task-dialog');await outside('knowledge-panel');
  // A connection request must retain the token until it completes or is explicitly dismissed.
  await click('#settings-button');await ready('settings-dialog');await fill('#token-input','ui-test-user');await page.evaluate(()=>{const original=chrome.runtime.sendMessage;window.__releaseConnection=null;chrome.runtime.sendMessage=async message=>{if(message.type==='connect'){await new Promise(resolve=>{window.__releaseConnection=resolve;});chrome.runtime.sendMessage=original;}return original(message);};});await click('#connect-button');await page.waitForFunction(()=>typeof window.__releaseConnection==='function');await rawClick(2,2);assert.equal(await page.evaluate(()=>document.querySelector('#settings-dialog').open),true);assert.equal(await page.evaluate(()=>document.querySelector('#token-input').value),'ui-test-user');await page.evaluate(()=>{window.__releaseConnection();});await closed('settings-dialog');assert.equal(await page.evaluate(()=>document.querySelector('#token-input').value),'');
  await page.evaluate(()=>{window.__dialogVerification='busy guards passed';});
  // Narrow-screen drawers still leave a tappable exterior without moving the home.
  await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});const mobileBefore=await geometry();await click('#knowledge-toggle');await ready('knowledge-panel');assert.deepEqual(await geometry(),mobileBefore);await outside('knowledge-panel');await click('#settings-button');await ready('settings-dialog');await outside('settings-dialog');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  return {mode:forceFallback?'Chrome 120 fallback':'native closedby',dialogs:6,nested:'only top closes',guards:'save and connection protected; token cleared on dismissal',layout:'home, clock and folder geometry unchanged on desktop and 390px',drag:'inside-to-outside selection preserved'};
}
