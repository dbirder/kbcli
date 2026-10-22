import {ApiError,createClient,permissionOrigin} from './api.mjs';
import {validateNavigation,exportNavigation} from './navigation.mjs';
import {validateAppearance} from './appearance.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail=()=>{throw new ApiError('BACKUP_INVALID','备份数据无效，当前收藏和设置已保留');};
export function cleanPayload(navigation,appearance){
  validateNavigation(navigation);validateAppearance(appearance);
  const nav=exportNavigation(navigation);
  return {navigation:{groups:nav.groups,bookmarks:nav.bookmarks,preferences:Object.fromEntries(['openInNewTab','showKnowledge','compact'].map(k=>[k,navigation.preferences[k]]))},appearance:Object.fromEntries(['theme','dim','blur','position','showClock','engine','wallpaper'].map(k=>[k,structuredClone(appearance[k])]))};
}
export function restorePayload(payload,revision){
  if(!payload?.navigation||!payload?.appearance)fail();
  const navigation=validateNavigation({...payload.navigation,version:1,revision:revision()});
  const appearance=validateAppearance({...payload.appearance,version:1,revision:revision()});
  // Copy known fields only, even if a future/corrupt server sends extra properties.
  const clean=cleanPayload(navigation,appearance);
  return {navigation:{...clean.navigation,version:1,revision:navigation.revision},appearance:{...clean.appearance,version:1,revision:appearance.revision}};
}
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
export function createBackups({storage,permissions,navigation,appearance,localLane,fetcher=fetch,now=()=>Date.now(),revision=()=>crypto.randomUUID()}){
  let tail=Promise.resolve(); // In-flight serialization only; retry and identity live in storage.
  const serial=run=>{const previous=tail;const task=(async()=>{try{await previous;}catch{}return run();})();tail=task;void(async()=>{try{await task;}catch{}})();return task;};
  const get=async key=>(await storage.get(key))[key];
  async function state(){let s=await get('backup');if(!s){s={version:1,deviceId:crypto.randomUUID(),deviceName:'我的浏览器',enabled:true};await storage.set({backup:s});}if(!uuid.test(s.deviceId))fail();return s;}
  async function connection(expected,versioned=false){const c=await get('connection');if(!c)throw new ApiError('NOT_CONFIGURED','连接 NAS 后会自动补传');if(versioned&&(typeof expected!=='string'||c.revision!==expected))throw new ApiError('CONNECTION_CHANGED','NAS 连接已改变，请重新打开备份列表');if(!await permissions.contains({origins:[permissionOrigin(c.server)]}))throw new ApiError('PERMISSION_REQUIRED','请在连接设置中重新授权 NAS');return c;}
  async function ensure(c){if((await get('connection'))?.revision!==c.revision)throw new ApiError('CONNECTION_CHANGED','NAS 连接已改变，请重新打开备份列表');}
  async function current(){return {navigation:await navigation({type:'navigation.get'}),appearance:await appearance({type:'appearance.get'})};}
  async function capture(){return localLane(async()=>{const values=await current();return {values,payload:cleanPayload(values.navigation,values.appearance)};});}
  async function status(){const s=await state(),c=await get('connection'),{payload}=await capture();const fingerprint=await digest(payload);return {...s,connected:Boolean(c),pendingChanges:s.last?.server!==c?.server||s.last?.fingerprint!==fingerprint,localUndo:Boolean(await get('backupUndo')),last:s.last?.server===c?.server?s.last:null};}
  async function tick(force=false){
    let s=await state();if(!s.enabled&&!force)return status();
    let c;
    try{
      c=await connection();const {payload}=await capture(),fingerprint=await digest(payload);
      if(s.last?.fingerprint===fingerprint&&s.last?.server===c.server){if(s.error||s.pending){s={...s,error:null,pending:null};await storage.set({backup:s});}return status();}
      if(!force&&s.notBefore>now())return status();
      let pending=s.pending;
      if(pending?.fingerprint!==fingerprint||pending?.connectionRevision!==c.revision){pending={fingerprint,backupId:crypto.randomUUID(),deviceName:s.deviceName,connectionRevision:c.revision,attempts:0,nextAt:0};s={...s,pending};await storage.set({backup:s});}
      if(!force&&pending.nextAt>now())return status();
      const value=await createClient(c,fetcher)('/api/backups/chrome',{method:'POST',body:{device_id:s.deviceId,backup_id:pending.backupId,device_name:pending.deviceName,payload}});
      if(value.saved!==true||value.backup?.backup_id!==pending.backupId||value.backup?.device_id!==s.deviceId)throw new ApiError('RESPONSE_INVALID','NAS 未确认备份，稍后将安全重试');
      await ensure(c);s={...s,last:{server:c.server,fingerprint,backupId:pending.backupId,savedAt:value.backup.saved_at},pending:null,error:null,notBefore:0};await storage.set({backup:s});return status();
    }catch(error){
      // A replay uses the persisted id and immutable payload fingerprint; task writes are never retried here.
      if(c&&(await get('connection'))?.revision!==c.revision)return status();
      s=await state();if(s.pending)s.pending={...s.pending,attempts:(s.pending.attempts||0)+1,nextAt:now()+Math.min(1800000,30000*2**Math.min(s.pending.attempts||0,6))};
      s.error={code:error.code||'NETWORK_ERROR',message:error.code==='NOT_CONFIGURED'?'连接 NAS 后会自动补传':'备份尚未确认，保留本机数据并等待重试',at:now()};await storage.set({backup:s});if(force)throw error;return status();
    }
  }
  function identifiers(m){if(!uuid.test(m.deviceId)||!uuid.test(m.backupId))fail();return '/api/backups/chrome/'+m.deviceId+'/'+m.backupId;}
  async function preview(m){const c=await connection(m.revision,true),value=await createClient(c,fetcher)(identifiers(m));await ensure(c);if(value.backup?.device_id!==m.deviceId||value.backup?.backup_id!==m.backupId)fail();const restored=restorePayload(value.backup.payload,revision);const local=await capture();return {backup:{deviceId:m.deviceId,backupId:m.backupId,name:value.backup.device_name,savedAt:value.backup.saved_at,groups:restored.navigation.groups.length,bookmarks:restored.navigation.bookmarks.length,theme:restored.appearance.theme},navigationRevision:local.values.navigation.revision,appearanceRevision:local.values.appearance.revision};}
  async function restore(m){
    if(m.confirm!==true)throw new ApiError('CONFIRM_REQUIRED','请先预览并确认恢复');
    const c=await connection(m.revision,true),value=await createClient(c,fetcher)(identifiers(m));await ensure(c);if(value.backup?.device_id!==m.deviceId||value.backup?.backup_id!==m.backupId)fail();const restored=restorePayload(value.backup.payload,revision);
    return localLane(async()=>{await ensure(c);const local=await current();if(local.navigation.revision!==m.navigationRevision||local.appearance.revision!==m.appearanceRevision)throw new ApiError('LOCAL_CHANGED','本机收藏或设置已变化，请重新预览后恢复');
      // Persist rollback first. If quota fails, do not change the current workspace.
      await storage.set({backupUndo:{savedAt:now(),payload:cleanPayload(local.navigation,local.appearance)}});
      await storage.set(restored);return {restored:true};});
  }
  return {
    changed:()=>serial(async()=>{const s=await state();await storage.set({backup:{...s,notBefore:now()+30000}});}),
    tick:()=>serial(()=>tick()),
    handle:m=>serial(async()=>{
      switch(m.type){
        case 'backup.status':return status();
        case 'backup.now':return tick(true);
        case 'backup.configure':{const s=await state();if(typeof m.enabled!=='boolean'||typeof m.deviceName!=='string'||!m.deviceName.trim()||m.deviceName.trim().length>80)fail();await storage.set({backup:{...s,enabled:m.enabled,deviceName:m.deviceName.trim()}});return status();}
        case 'backup.list':{const c=await connection(m.revision,true),value=await createClient(c,fetcher)('/api/backups/chrome?limit=100');await ensure(c);if(!Array.isArray(value.backups))fail();return value;}
        case 'backup.preview':return preview(m);
        case 'backup.restore':return restore(m);
        case 'backup.undo':return localLane(async()=>{const undo=await get('backupUndo');if(!undo)throw new ApiError('NO_UNDO','没有可撤销的恢复');const local=await current();if(local.navigation.revision!==m.navigationRevision||local.appearance.revision!==m.appearanceRevision)throw new ApiError('LOCAL_CHANGED','本机数据已变化，请刷新后再撤销');const restored=restorePayload(undo.payload,revision);await storage.set({backupUndo:{savedAt:now(),payload:cleanPayload(local.navigation,local.appearance)}});await storage.set(restored);return {restored:true};});
        default:throw new ApiError('MESSAGE_INVALID','不支持的备份操作');
      }
    }),
  };
}
