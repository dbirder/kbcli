// Test server only. Never included in the Chrome extension package.
import {createBatchIconFetcher} from '/icon-batch.mjs';
import {createController} from '/controller.mjs';
import {errorValue} from '/api.mjs';
import {fetchCaptureImage} from '/capture.mjs';
import {createLegacyIconReader} from '/icon-snapshots.mjs';
const changes=[], grants=new Set();
const storage={
  async get(key){return {[key]:JSON.parse(localStorage.getItem('kb-test-'+key)||'null')};},
  async set(values){for(const [key,value]of Object.entries(values)){localStorage.setItem('kb-test-'+key,JSON.stringify(value));for(const callback of changes)callback({[key]:{newValue:value}},'local');}},
  async remove(keys){for(const key of [keys].flat()){localStorage.removeItem('kb-test-'+key);for(const callback of changes)callback({[key]:{}},'local');}}
};
window.addEventListener('storage',event=>{if(event.key?.startsWith('kb-test-'))for(const callback of changes)callback({[event.key.slice(8)]:{newValue:JSON.parse(event.newValue||'null')}},'local');});
const permissions={async request({origins}){origins.forEach(o=>grants.add(o));return true;},async contains({origins}){return origins.every(o=>grants.has(o));},async remove({origins}){origins.forEach(o=>grants.delete(o));}};
const saved=(await storage.get('connection')).connection;
if(saved)grants.add(new URL(saved.server).protocol+'//'+new URL(saved.server).hostname+'/*');
globalThis.__kbAuditRedirectTest={enabled:false,calls:0};globalThis.__kbSiteAuditTest={};
let fixtureBatchFetcher;globalThis.__iconBatchTest={failHosts:[],permissionHosts:[],delay:0};
const handle=createController({storage,permissions,fetchBatchIcon:async url=>{localStorage.setItem('kb-test-batch-icon-lookups',String(Number(localStorage.getItem('kb-test-batch-icon-lookups')||0)+1));if(__iconBatchTest.beforeFetch)await __iconBatchTest.beforeFetch();if(__iconBatchTest.delay)await new Promise(r=>setTimeout(r,__iconBatchTest.delay));if(__iconBatchTest.permissionHosts.includes(new URL(url).hostname)&&!await permissions.contains({origins:[new URL(url).protocol+'//'+new URL(url).hostname+'/*']}))throw Object.assign(Error('TEST ONLY host grant required'),{code:'PERMISSION_REQUIRED'});if(__iconBatchTest.failHosts.includes(new URL(url).hostname))throw Error('TEST ONLY icon unavailable');fixtureBatchFetcher??=createBatchIconFetcher({runtime:chrome.runtime,permissions,fetcher:async(url,options)=>fetch(new URL(url).pathname==='/favicon.ico'?location.origin+'/assets/icons/icon-64.png':url,options)});return fixtureBatchFetcher(url);},readLegacyIcon:createLegacyIconReader(),fetcher:async(...args)=>{if(__kbSiteAuditTest.beforeFetch&&String(args[0]).includes('/__test/audit/'))await __kbSiteAuditTest.beforeFetch();if(__kbAuditRedirectTest.enabled&&String(args[0])==='https://labs.google/fx/zh/tools/flow'){__kbAuditRedirectTest.calls++;if(!grants.has('https://flow.google.com/*'))throw new TypeError('TEST ONLY target not granted');const r=new Response('<title>TEST ONLY Flow</title>',{headers:{'Content-Type':'text/html'}});Object.defineProperty(r,'url',{value:'https://flow.google.com/'});return r;}if((globalThis.__kbBackupTest?.offline && String(args[0]).includes("/api/backups/"))||(globalThis.__kbWorkspaceTest?.offline && /\/api\/(workspace|backups)\//.test(String(args[0]))))throw Error("TEST ONLY offline");return fetch(...args);}});
globalThis.__kbBackupTest={offline:false,tick:handle.backupTick};
globalThis.__kbWorkspaceTest={offline:false,tick:handle.workspaceTick};
globalThis.__captureTest={deny:false,metadataDelay:Number(new URL(location.href).searchParams.get('metadata-delay'))||0,metadataPending:false,imageDelay:0,imagePending:0,saveDelay:0,tabURL:new URL(location.href).searchParams.get('tab-url')||location.origin+'/sample/current?keep=1#part',title:'隔离测试网页'};
let fixtureAuditPump=null;
async function pumpFixtureAudit(){if(fixtureAuditPump)return;fixtureAuditPump=(async()=>{while(await handle.auditTick()){} })();try{await fixtureAuditPump;}finally{fixtureAuditPump=null;}}
let fixtureIconPump=null;
async function pumpFixtureIcons(){if(fixtureIconPump)return;fixtureIconPump=(async()=>{while(await handle.iconBatchTick()){} })();try{await fixtureIconPump;}finally{fixtureIconPump=null;}}
async function auditHandle(message){const result=await handle(message);if(['audit.start','audit.retry'].includes(message.type))void pumpFixtureAudit();if(message.type==='icons.start')void pumpFixtureIcons();return result;}
globalThis.chrome={runtime:{getURL(path){return new URL(path==='/_favicon/'?'/assets/icons/icon-64.png':path,location.origin).href;},async sendMessage(message){try{if(message.type==='capture.save'&&__captureTest.saveDelay)await new Promise(r=>setTimeout(r,__captureTest.saveDelay));return {ok:true,data:message.type==='capture.image'?await (async()=>{__captureTest.imagePending++;localStorage.setItem('kb-test-icon-lookups',String(Number(localStorage.getItem('kb-test-icon-lookups')||0)+1));try{if(localStorage.getItem('kb-test-icon-offline')==='1')throw Error('TEST ONLY icon offline');if(__captureTest.imageDelay)await new Promise(r=>setTimeout(r,__captureTest.imageDelay));return await fetchCaptureImage(message,{runtime:chrome.runtime,tabs:chrome.tabs,permissions});}finally{__captureTest.imagePending--;}})():await auditHandle(message)};}catch(error){return {ok:false,error:errorValue(error)};}}},permissions,storage:{local:storage,onChanged:{addListener(callback){changes.push(callback);}}},tabs:{async query(){return [await this.get(91)];},async get(){return {id:91,url:__captureTest.tabURL,title:__captureTest.title};},async create({url}){window.open(url,'_blank');}},scripting:{async executeScript(){__captureTest.metadataPending=true;try{if(__captureTest.metadataDelay)await new Promise(r=>setTimeout(r,__captureTest.metadataDelay));return [{result:{title:__captureTest.title,url:__captureTest.tabURL,iconURL:location.origin+'/assets/icons/icon-64.png'}}];}finally{__captureTest.metadataPending=false;}}}};
const requestPermission=permissions.request;permissions.request=async value=>__captureTest.deny?false:requestPermission(value);
if(new URL(location.href).searchParams.has('icon-cache-test')){
  await navigator.serviceWorker.register('/__icon_test_worker.mjs',{type:'module'});
  await navigator.serviceWorker.ready;
  if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
  const original=chrome.runtime.sendMessage;chrome.runtime.id='kb-icon-fixture';
  chrome.runtime.sendMessage=async message=>{
    if(message.type!=='favicon.result')return original(message);
    return new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=event=>{channel.port1.close();resolve(event.data);};navigator.serviceWorker.controller.postMessage(message,[channel.port2]);});
  };
}
if(location.pathname!=='/popup.html')await handle.freezeIcons();
// Test-only cold-worker latency, scoped to the explicit startup fixture URL.
const startupDelay=Math.min(1500,Math.max(0,Number(new URL(location.href).searchParams.get('__startupDelay'))||0));
if(startupDelay){
  const original=chrome.runtime.sendMessage;
  chrome.runtime.sendMessage=async message=>{if(['appearance.get','navigation.get'].includes(message.type))await new Promise(resolve=>setTimeout(resolve,startupDelay));return original(message);};
}
await import(location.pathname==='/popup.html'?'/popup.mjs':'/app.mjs');

void pumpFixtureAudit();

void pumpFixtureIcons();
