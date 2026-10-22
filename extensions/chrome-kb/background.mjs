import {createBatchIconFetcher} from './icon-batch.mjs';
import {createLegacyIconReader} from './icon-snapshots.mjs';
import {createController} from './controller.mjs';
import {ApiError,errorValue} from './api.mjs';
import {fetchCaptureImage} from './capture.mjs';
let accessError = false;
const accessReady = (async () => { try { await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}); } catch { accessError = true; } })();
const handle = createController({storage:chrome.storage.local,permissions:chrome.permissions,readLegacyIcon:createLegacyIconReader(),fetchBatchIcon:createBatchIconFetcher({runtime:chrome.runtime,permissions:chrome.permissions})});
// Freeze only old local cache bytes. Missing icons never cause a source fetch.
const iconsReady=(async()=>{await accessReady;if(!accessError)try{await handle.freezeIcons();}catch{console.warn('旧图标快照未能保存，保留原收藏并显示本机文字图标');}})();
// Register synchronously so Chrome can deliver events after worker restart.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const page=sender.url?.split(/[?#]/,1)[0],popup=page===chrome.runtime.getURL('popup.html');
  if(sender.id!==chrome.runtime.id||(!popup&&page!==chrome.runtime.getURL('newtab.html')))return false;
  if(popup&&!['capture.load','capture.draft','capture.save','capture.image','navigation.get','group.add'].includes(message?.type))return false;
  void (async () => {
    let response;
    try { await iconsReady; if (accessError) throw new ApiError('STORAGE_UNAVAILABLE','无法初始化插件存储，请重新加载扩展'); response = {ok:true,data:message?.type==='capture.image'?await fetchCaptureImage(message,{runtime:chrome.runtime,tabs:chrome.tabs,permissions:chrome.permissions}):await handle(message)}; }
    catch (error) { response = {ok:false,error:errorValue(error)}; }
    if(response.ok&&['audit.start','audit.retry'].includes(message?.type))void pumpAudit();
    if(response.ok&&message?.type==='icons.start')void pumpIcons();
    try { respond(response); } catch { /* The requesting tab may have closed. Never replay its write. */ }
  })();
  return true;
});

const backupAlarm='kb-workspace-backup';
async function startBackup(){
  await iconsReady;if(accessError)return;
  try{if(!await chrome.alarms.get(backupAlarm))await chrome.alarms.create(backupAlarm,{periodInMinutes:0.5});await handle.workspaceTick();await handle.backupTick();}
  catch{console.warn('同步与备份等待下次唤醒重试');}
}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===backupAlarm)void startBackup();if(alarm.name==='kb-site-audit')void pumpAudit();if(alarm.name==='kb-icon-batch')void pumpIcons();});
chrome.runtime.onStartup.addListener(()=>{void startBackup();});
chrome.runtime.onInstalled.addListener(()=>{void startBackup();});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&(changes.navigation||changes.appearance||changes.connection))void(async()=>{await accessReady;if(!accessError)try{if(changes.navigation)await handle.freezeIcons();await handle.workspaceChanged();await handle.backupChanged();}catch{console.warn('备份标记等待下次检查');}})();
});
void startBackup();

// Persisted claims survive suspension; only in-flight pump coordination is local.
const auditAlarm='kb-site-audit';let auditPump=null;
async function pumpAudit(){
 if(auditPump)return auditPump;
 const pending=(async()=>{
  await iconsReady;if(accessError)return;
  try{
   const {job}=await handle({type:'audit.get'});
   if(job?.state!=='running'){await chrome.alarms.clear?.(auditAlarm);return;}
   await chrome.alarms.create(auditAlarm,{periodInMinutes:0.5});
   while(await handle.auditTick()) { /* Each batch is bounded by a 12s deadline. */ }
   if((await handle({type:'audit.get'})).job?.state!=='running')await chrome.alarms.clear?.(auditAlarm);
  }catch{console.warn('网站检查已保留进度，等待下次唤醒继续');}
 })();auditPump=pending;
 try{await pending;}finally{if(auditPump===pending)auditPump=null;}
}
void pumpAudit();

const iconAlarm='kb-icon-batch';let iconPump=null;
async function pumpIcons(){
 if(iconPump)return iconPump;
 const pending=(async()=>{
  await iconsReady;if(accessError)return;
  try{
   const {job}=await handle({type:'icons.get'});
   if(job?.state!=='running'){await chrome.alarms.clear?.(iconAlarm);return;}
   await chrome.alarms.create(iconAlarm,{periodInMinutes:0.5});
   while(await handle.iconBatchTick()){}
   if((await handle({type:'icons.get'})).job?.state!=='running')await chrome.alarms.clear?.(iconAlarm);
  }catch{console.warn('批量图标获取已保留进度，等待下次唤醒');}
 })();iconPump=pending;try{await pending;}finally{if(iconPump===pending)iconPump=null;}
}
void pumpIcons();
