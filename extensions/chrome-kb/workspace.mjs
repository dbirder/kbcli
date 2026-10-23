import {ApiError,createClient,permissionOrigin} from './api.mjs';
import {cleanPayload,restorePayload} from './backup.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail=()=>{throw new ApiError('RESPONSE_INVALID','共享数据校验失败，保留本机数据');};
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
export async function workspaceHash(payload){return 'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(ordered(payload))))),b=>b.toString(16).padStart(2,'0')).join('');}
function pristine(p){const n=p.navigation,a=p.appearance;return (n.groups.length===0||(n.groups.length===1&&n.groups[0].id==='default'&&n.groups[0].name==='常用'))&&!n.bookmarks.length&&n.preferences.openInNewTab&&n.preferences.showKnowledge&&!n.preferences.compact&&a.theme==='mist'&&a.dim===24&&a.blur===0&&a.position==='center'&&a.showClock&&a.engine==='bing'&&a.wallpaper===null;}
function validRevision(r){if(!r||!uuid.test(r.revision)||!uuid.test(r.device_id)||!/^sha256:[0-9a-f]{64}$/.test(r.content_hash)||(r.parent_revision!==null&&!uuid.test(r.parent_revision)))fail();return r;}
const summarize=p=>({groups:p.navigation.groups.map(g=>g.name),bookmarks:p.navigation.bookmarks.map(b=>({id:b.id,title:b.title,url:b.url,groupId:b.groupId,groupName:p.navigation.groups.find(g=>g.id===b.groupId)?.name||''})),preferences:p.navigation.preferences,appearance:{...p.appearance,wallpaper:p.appearance.wallpaper?.name||null}});
export function createWorkspace({storage,permissions,navigation,appearance,localLane,identity,fetcher=fetch,now=()=>Date.now(),revision=()=>crypto.randomUUID()}){
 let tail=Promise.resolve();const serial=run=>{const previous=tail,pending=(async()=>{try{await previous;}catch{}return run();})();tail=pending;void(async()=>{try{await pending;}catch{}})();return pending;};
 const get=async key=>(await storage.get(key))[key];
 const readState=async()=>{let s=await get('workspace');if(!s){s={version:1,enabled:true};await storage.set({workspace:s});}return s;};
 const current=async()=>{const values={navigation:await navigation({type:'navigation.get'}),appearance:await appearance({type:'appearance.get'})};return {...values,payload:cleanPayload(values.navigation,values.appearance)};};
 const capture=()=>localLane(current);
 async function connection(expected,versioned=false){const c=await get('connection');if(!c)throw new ApiError('NOT_CONFIGURED','请先连接 NAS');if(versioned&&(typeof expected!=='string'||expected!==c.revision))throw new ApiError('CONNECTION_CHANGED','连接已变化，请重新查看共享版本');if(!await permissions.contains({origins:[permissionOrigin(c.server)]}))throw new ApiError('PERMISSION_REQUIRED','请重新授权 NAS 访问');return c;}
 async function ensure(c){if((await get('connection'))?.revision!==c.revision)throw new ApiError('CONNECTION_CHANGED','连接已变化，请重新查看共享版本');}
 const save=async(s,c)=>{await ensure(c);await storage.set({workspace:s});return s;};
 async function status(){const s=await readState(),c=await get('connection'),v=await capture(),hash=await workspaceHash(v.payload),same=s.server===c?.server;
  return {enabled:s.enabled,connected:Boolean(c),phase:!s.enabled?'disabled':!c?'not_configured':same&&s.conflict?'conflict':same&&s.error?'retrying':same&&s.baseRevision&&s.baseHash===hash?'synced':'pending',conflict:same?s.conflict:null,pendingChanges:!same||s.baseHash!==hash,baseRevision:same?s.baseRevision:null,lastSyncAt:same?s.lastSyncAt:null,nextAttempt:same?s.nextAttempt:null,error:same?s.error:null};
 }
 async function readRemote(c,pending,known=null){const query=new URLSearchParams();if(pending)query.set('request_id',pending.id);if(known)query.set('known_revision',known);const value=await createClient(c,fetcher)('/api/workspace/chrome'+(query.size?'?'+query:''));await ensure(c);if(!Object.hasOwn(value,'head'))fail();if(value.head!==null){validRevision(value.head);if(value.head.payload){restorePayload(value.head.payload,revision);if(await workspaceHash(value.head.payload)!==value.head.content_hash)fail();}else if(value.unchanged!==true||value.head.revision!==known)fail();}if(value.acknowledged)validRevision(value.acknowledged);return value;}
 async function protect(c,v,id,name){const response=await createClient(c,fetcher)('/api/backups/chrome',{method:'POST',body:{device_id:id.deviceId,backup_id:id.backupId,device_name:name,payload:v.payload}});await ensure(c);if(!response.saved||response.backup?.backup_id!==id.backupId||response.backup?.device_id!==id.deviceId)fail();}
 async function apply(c,s,remote,v,id){
  const hash=await workspaceHash(v.payload);let incoming=s.incoming;
  if(incoming?.revision!==remote.revision||incoming?.hash!==hash)incoming={revision:remote.revision,hash,backupId:crypto.randomUUID(),deviceName:id.deviceName};
  s=await save({...s,incoming},c);await protect(c,v,{deviceId:id.deviceId,backupId:incoming.backupId},incoming.deviceName||id.deviceName);
  await localLane(async()=>{await ensure(c);const latest=await current();if(latest.navigation.revision!==v.navigation.revision||latest.appearance.revision!==v.appearance.revision)throw new ApiError('LOCAL_CHANGED','本机修改已保留，下次重新检查');
   await storage.set({...restorePayload(remote.payload,revision),workspace:{...s,baseRevision:remote.revision,baseHash:remote.content_hash,pending:null,incoming:null,conflict:null,error:null,attempts:0,nextAttempt:0,lastSyncAt:now()}});
  });
 }
 async function publish(c,s,v,id,base=s.baseRevision??null){
  const hash=await workspaceHash(v.payload);let pending=s.pending;
  if(pending?.hash!==hash||pending?.base!==base)pending={id:crypto.randomUUID(),hash,base,deviceName:id.deviceName};
  s=await save({...s,pending},c);
  try{
   const response=await createClient(c,fetcher)('/api/workspace/chrome',{method:'POST',body:{device_id:id.deviceId,device_name:pending.deviceName,request_id:pending.id,base_revision:pending.base,payload:v.payload}});await ensure(c);const r=validRevision(response.revision);if(!response.saved||r.revision!==pending.id||r.content_hash!==pending.hash||r.device_id!==id.deviceId||r.parent_revision!==pending.base)fail();
   await save({...s,baseRevision:r.revision,baseHash:r.content_hash,pending:null,incoming:null,conflict:null,error:null,attempts:0,nextAttempt:0,lastSyncAt:now()},c);
  }catch(error){if(error.code==='WORKSPACE_CHANGED'){await save({...s,pending:null,conflict:{kind:'data',detectedAt:now(),backupId:pending.id},error:null},c);return false;}throw error;}
  return true;
 }
 async function tick(force=false){
  let s=await readState(),c;if(!s.enabled)return status();
  try{
   c=await connection();if(s.server!==c.server)s=await save({version:1,enabled:s.enabled,server:c.server},c);
   if(s.connectionRevision!==c.revision)s=await save({...s,connectionRevision:c.revision,nextAttempt:0,attempts:0,error:null},c);
   if(s.conflict&&!(force&&s.conflict.kind==='history'))return status();if(s.conflict)s=await save({...s,conflict:null},c);
   if(!force&&s.nextAttempt>now())return status();
   const id=await identity(),remote=await readRemote(c,s.pending,s.baseRevision);
   if(remote.head&&remote.head.revision===s.baseRevision&&s.baseHash&&remote.head.content_hash!==s.baseHash)fail();
   if(remote.acknowledged&&s.pending){const ack=remote.acknowledged;if(ack.revision!==s.pending.id||ack.content_hash!==s.pending.hash||ack.device_id!==id.deviceId||ack.parent_revision!==s.pending.base)fail();s=await save({...s,baseRevision:ack.revision,baseHash:ack.content_hash,pending:null},c);}
   const v=await capture(),hash=await workspaceHash(v.payload),head=remote.head;
   if(head?.content_hash===hash){await save({...s,baseRevision:head.revision,baseHash:hash,pending:null,incoming:null,error:null,attempts:0,nextAttempt:0,lastSyncAt:now()},c);return status();}
   if(!head&&!s.baseRevision&&pristine(v.payload)){await save({...s,baseHash:hash,error:null,attempts:0,nextAttempt:0},c);return status();}
   if(head&&head.revision!==s.baseRevision&&(s.baseHash===hash||(!s.baseHash&&pristine(v.payload)))){await apply(c,s,head,v,id);return status();}
   if(!force&&s.notBefore>now())return status();
   await publish(c,s,v,id);return status();
  }catch(error){if(c&&(await get('connection'))?.revision!==c.revision)return status();s=await readState();
   if(error.code==='NOT_CONFIGURED')return status();
   if(error.code==='WORKSPACE_FORK'){s={...s,conflict:{kind:'history',detectedAt:now()}};}
   s={...s,error:{code:error.code||'NETWORK_ERROR',message:error.code==='LOCAL_CHANGED'?'本机有新修改，将重新检查':error.code==='HTTP_404'?'NAS 尚未提供共享同步，请升级 kbcli 至 0.1.4':error.message||'暂时无法同步，数据保留在本机'},attempts:(s.attempts||0)+1,nextAttempt:now()+Math.min(1800000,30000*2**Math.min(s.attempts||0,6))};
   await storage.set({workspace:s});if(force)throw error;return status();
  }
 }
 async function preview(m){const c=await connection(m.revision,true),s=await readState();if(s.server!==c.server||!s.conflict||s.conflict.kind==='history')throw new ApiError('NO_CONFLICT','请重新检查同步状态');const {head}=await readRemote(c),v=await capture();return {remoteRevision:head?.revision??null,localHash:await workspaceHash(v.payload),navigationRevision:v.navigation.revision,appearanceRevision:v.appearance.revision,local:summarize(v.payload),remote:head?{...summarize(head.payload),deviceName:head.device_name,savedAt:head.saved_at}:null};}
 async function resolve(m){
  if(m.confirm!==true||!['local','remote'].includes(m.choice))throw new ApiError('CONFIRM_REQUIRED','请预览双方内容后确认');const c=await connection(m.revision,true),s=await readState();if(s.server!==c.server||s.conflict?.kind!=='data')throw new ApiError('NO_CONFLICT','冲突已变化，请重新检查');
  const {head}=await readRemote(c);if((head?.revision??null)!==m.remoteRevision)throw new ApiError('REMOTE_CHANGED','共享版本又有更新，请重新预览');const v=await capture();if(v.navigation.revision!==m.navigationRevision||v.appearance.revision!==m.appearanceRevision||await workspaceHash(v.payload)!==m.localHash)throw new ApiError('LOCAL_CHANGED','本机内容已变化，请重新预览');const id=await identity();
  if(m.choice==='remote'){if(!head)throw new ApiError('REMOTE_EMPTY','共享版本为空，请明确发布本机版本');await apply(c,s,head,v,id);}
  else if(!await publish(c,s,v,id,head?.revision??null))throw new ApiError('REMOTE_CHANGED','共享版本又有更新，双方已保留，请重新预览');
  return status();
 }
 return {tick:()=>serial(()=>tick()),changed:()=>serial(async()=>{const s=await readState();await storage.set({workspace:{...s,notBefore:now()+30000}});}),handle:m=>serial(async()=>{
  switch(m.type){case 'workspace.status':return status();case 'workspace.now':return tick(true);case 'workspace.configure':{if(typeof m.enabled!=='boolean')fail();const s=await readState();await storage.set({workspace:{...s,enabled:m.enabled,nextAttempt:0}});return status();}case 'workspace.preview':return preview(m);case 'workspace.resolve':return resolve(m);default:throw new ApiError('MESSAGE_INVALID','不支持的共享同步操作');}
 })};
}
