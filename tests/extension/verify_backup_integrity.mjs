import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
// Tests only. The caller supplies a private read-only backup copy. The browser
// talks exclusively to the local fixture using synthetic credentials.
export async function verifyBackupIntegrity({page:p,baseURL,sourceBackup}){
 assert.match(baseURL,/^http:\/\/127\.0\.0\.1:\d+$/);const expected=sourceBackup.payload;
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await p.goto(baseURL);
 const wait=fn=>p.waitForFunction(fn,undefined,{timeout:15000});
 await wait(()=>Boolean(JSON.parse(localStorage.getItem('kb-test-backup'))?.deviceId));
 await p.evaluate(payload=>{
  localStorage.setItem('kb-test-navigation',JSON.stringify({...payload.navigation,version:1,revision:crypto.randomUUID()}));
  localStorage.setItem('kb-test-appearance',JSON.stringify({...payload.appearance,version:1,revision:crypto.randomUUID()}));
  const s=JSON.parse(localStorage.getItem('kb-test-backup'));s.enabled=false;s.deviceName='TEST ONLY 恢复完整性';localStorage.setItem('kb-test-backup',JSON.stringify(s));
  localStorage.setItem('kb-test-workspace',JSON.stringify({version:1,enabled:false}));localStorage.setItem('kb-test-icon-lookups','0');
 },expected);
 await p.reload();await p.waitForSelector('.folder-button');
 const payload=()=>p.evaluate(async()=>{const [{cleanPayload},n,a]=await Promise.all([import('/backup.mjs'),chrome.runtime.sendMessage({type:'navigation.get'}),chrome.runtime.sendMessage({type:'appearance.get'})]);return cleanPayload(n.data,a.data);});
 assert.deepEqual(await payload(),expected);
 const settings=async()=>{await p.click('#settings-button');await wait(()=>document.querySelector('#settings-dialog').open&&getComputedStyle(document.querySelector('#settings-dialog')).opacity==='1');};
 const closeSettings=async()=>{await p.click('[data-close="settings-dialog"]');await wait(()=>!document.querySelector('#settings-dialog').open&&getComputedStyle(document.querySelector('#settings-dialog')).display==='none');};
 await settings();await p.fill('#server-input',baseURL);await p.fill('#token-input','ui-test-user');await p.click('#connect-button');await wait(()=>!document.querySelector('#settings-dialog').open&&getComputedStyle(document.querySelector('#settings-dialog')).display==='none');
 await settings();await p.click('#backup-now');await wait(()=>Boolean(JSON.parse(localStorage.getItem('kb-test-backup'))?.last?.backupId));
 const initial=await p.evaluate(()=>({backup:JSON.parse(localStorage.getItem('kb-test-backup')),connection:JSON.parse(localStorage.getItem('kb-test-connection'))}));
 assert.equal(initial.connection.server,baseURL);assert.equal(initial.backup.enabled,false);
 const serverCopy=await p.evaluate(async({deviceId,backupId})=>{const r=await fetch('/api/backups/chrome/'+deviceId+'/'+backupId,{headers:{Authorization:'Bearer ui-test-user'}});if(!r.ok)throw Error('Fixture backup read failed');return (await r.json()).backup.payload;},{deviceId:initial.backup.deviceId,backupId:initial.backup.last.backupId});
 assert.deepEqual(serverCopy,expected);
 // Simulated loss is confined to this fixture origin. Never touches the real
 // extension profile: no groups, bookmarks or embedded images remain here.
 await p.evaluate(source=>{
  const n={version:1,revision:crypto.randomUUID(),groups:[{id:'default',name:'TEST ONLY 已清空'}],bookmarks:[],preferences:Object.fromEntries(Object.entries(source.navigation.preferences).map(([k,v])=>[k,!v]))};
  const a={...source.appearance,version:1,revision:crypto.randomUUID(),theme:source.appearance.theme==='night'?'mist':'night',wallpaper:null,dim:75-source.appearance.dim};
  localStorage.setItem('kb-test-navigation',JSON.stringify(n));localStorage.setItem('kb-test-appearance',JSON.stringify(a));
 },expected);
 await p.reload();await p.waitForSelector('.folder-button');const empty=await payload();assert.equal(empty.navigation.bookmarks.length,0);assert.equal(empty.navigation.groups.length,1);
 async function preview(){await p.click('#backup-list-button');await p.waitForSelector('.backup-row button');await p.click('.backup-row button');await wait(()=>document.querySelector('#restore-dialog').open&&getComputedStyle(document.querySelector('#restore-dialog')).opacity==='1');}
 await settings();await preview();await p.click('[aria-label="关闭恢复窗口"]');await wait(()=>!document.querySelector('#restore-dialog').open);assert.deepEqual(await payload(),empty);
 await preview();await p.click('#restore-confirm');await wait(()=>!document.querySelector('#restore-dialog').open);assert.deepEqual(await payload(),expected);
 await closeSettings();await p.click('#all-groups-button');
 await wait(()=>[...document.querySelectorAll('#site-groups .site-icon img')].every(i=>i.complete&&i.naturalWidth>0));
 const visible=await p.evaluate(()=>({cards:document.querySelectorAll('#site-groups .site-card').length,decodedImages:[...document.querySelectorAll('#site-groups .site-icon img')].filter(i=>i.complete&&i.naturalWidth>0&&i.src.startsWith('data:image/webp;base64,')).length,lookups:Number(localStorage.getItem('kb-test-icon-lookups')||0)}));
 const imageCount=expected.navigation.bookmarks.filter(s=>s.icon?.dataURL).length;
 assert.equal(visible.cards,expected.navigation.bookmarks.length);assert.equal(visible.decodedImages,imageCount);assert.equal(visible.lookups,0);
 // A browser reload must preserve the same restored payload and all icon bytes.
 await p.reload();await p.waitForSelector('.folder-button');assert.deepEqual(await payload(),expected);
 await settings();await p.click('#backup-undo');await wait(()=>JSON.parse(localStorage.getItem('kb-test-navigation')).bookmarks.length===0);assert.deepEqual(await payload(),empty);
 await preview();await p.click('#restore-confirm');await wait(()=>!document.querySelector('#restore-dialog').open);assert.deepEqual(await payload(),expected);
 const after=await p.evaluate(()=>({backup:JSON.parse(localStorage.getItem('kb-test-backup')),connection:JSON.parse(localStorage.getItem('kb-test-connection'))}));assert.equal(after.backup.deviceId,initial.backup.deviceId);assert.deepEqual(after.connection,initial.connection);
 assert.equal(await p.evaluate(()=>Number(localStorage.getItem('kb-test-icon-lookups')||0)),0);await closeSettings();
 return {groups:expected.navigation.groups.length,bookmarks:expected.navigation.bookmarks.length,icons:expected.navigation.bookmarks.reduce((r,s)=>(r[s.icon?.mode||'missing']=(r[s.icon?.mode||'missing']||0)+1,r),{}),decodedImages:visible.decodedImages,payloadSHA256:digest(expected),serverRoundtrip:'exact match',emptyWorkspaceRestore:'exact match including IDs, group order, bookmark order, URLs, preferences, appearance and every icon byte',reload:'exact match',cancel:'empty test data unchanged',undo:'returned exactly to empty test data',secondRestore:'exact match',deviceAndTestConnectionPreserved:true,iconSourceRequests:0};
}
