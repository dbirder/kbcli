import {ApiError, createClient, errorValue, normalizeServer, permissionOrigin, validateTask} from './api.mjs';
import {createIconBatch} from './icon-batch.mjs';
import {createSiteAudit} from './site-audit.mjs';
import {createWorkspace} from './workspace.mjs';
import {createBackups} from './backup.mjs';
import {createNavigationStore} from './navigation.mjs';
import {createAppearanceStore} from './appearance.mjs';
import {createCaptureStore} from './capture.mjs';
import {fallbackBookmarkIcon,validateBookmarkIcon,MAX_ICONS_BYTES} from './bookmark-icon.mjs';
const resources = {tasks: '/api/tasks', status: '/api/status', autosync: '/api/autosync'};
// Only in-flight coordination lives in memory; all user data is read from storage.
function serialLane() {
  let tail = Promise.resolve();
  return run => {
    const previous = tail;
    const pending = (async () => { try { await previous; } catch {} return run(); })();
    tail = pending;
    // Handle a rejected last item even when no later request arrives.
    void (async () => { try { await pending; } catch {} })();
    return pending;
  };
}
function validateResource(key, value) {
  if (key === 'tasks' && (!Array.isArray(value.tasks) || value.tasks.some(t => !t || typeof t.title !== 'string' || !['todo','doing','done','cancelled'].includes(t.status) || !/^[0-9a-f-]{36}$/i.test(t.id || '') || !/^sha256:[0-9a-f]{64}$/.test(t.file_hash || '') || (t.tags != null && (!Array.isArray(t.tags) || t.tags.some(tag => typeof tag !== 'string')))))) throw new ApiError('RESPONSE_INVALID','服务返回的待办格式无效，正在保留上次缓存');
  if (key === 'status' && !['human','ai'].includes(value.role)) throw new ApiError('RESPONSE_INVALID','服务返回的身份信息无效，请检查 NAS 服务版本');
  return value;
}
export function createController({storage, permissions, fetcher = fetch, now = () => Date.now(), revision = () => crypto.randomUUID(),readLegacyIcon=async()=>null,fetchBatchIcon=async()=>{throw new ApiError('ICON_FETCH_FAILED','图标获取环境不可用');}}) {
  const navigation = createNavigationStore({storage,revision});
  const appearance = createAppearanceStore({storage,revision});
  const localLane = serialLane(), nasLane = serialLane();
  const capture=createCaptureStore({storage,navigation,now});
  const iconBatch=createIconBatch({storage,navigation,localLane,fetchIcon:fetchBatchIcon,now,revision});
  const audit=createSiteAudit({storage,permissions,navigation,localLane,fetcher,now,revision});
  let pendingSnapshot = null;
  const client = config => createClient(config, fetcher);
  const config = async () => (await storage.get('connection')).connection;
  const publicConfig = c => c ? {server: c.server, revision: c.revision, configured: true} : {configured: false};
  const requireConfig = async expected => {
    const c = await config();
    if (!c) throw new ApiError('NOT_CONFIGURED', '请先连接 NAS');
    if (typeof expected !== 'string' || c.revision !== expected) throw new ApiError('CONNECTION_CHANGED', '连接设置已在其他标签页改变，请刷新后操作');
    if (!await permissions.contains({origins: [permissionOrigin(c.server)]})) throw new ApiError('PERMISSION_REQUIRED', '请在连接设置中重新授权访问 NAS');
    return c;
  };
  async function ensureCurrent(c) {
    if ((await config())?.revision !== c.revision) throw new ApiError('CONNECTION_CHANGED', '连接设置已改变，请刷新核对原连接中的内容');
  }
  async function snapshot() {
    const c = await config();
    if (!c) return {connection: publicConfig(c), resources: {}, writable: false};
    const old = (await storage.get('snapshot')).snapshot;
    const cache = old?.revision === c.revision ? old.resources : {};
    const result = {};
    let allowed = false;
    try { await requireConfig(c.revision); allowed = true; } catch (error) {
      for (const key of Object.keys(resources)) result[key] = {...cache[key], stale: true, error: errorValue(error)};
    }
    if (allowed) {
      await Promise.all(Object.entries(resources).map(async ([key, path]) => {
        try { result[key] = {data: validateResource(key,await client(c)(path)), fetchedAt: now(), stale: false}; }
        catch (error) { result[key] = {...cache[key], stale: true, error: errorValue(error)}; }
      }));
    }
    await ensureCurrent(c);
    await storage.set({snapshot: {revision: c.revision, resources: result}});
    return {connection: publicConfig(c), resources: result,
      writable: !result.tasks.stale && !result.status.stale && result.status.data?.role === 'human'};
  }
  async function dispatch(message) {
    switch (message.type) {
      case 'connection': return publicConfig(await config());
      case 'connect': {
        const server = normalizeServer(message.server), old = await config();
        if ((message.revision ?? null) !== (old?.revision ?? null)) throw new ApiError('CONNECTION_CHANGED','连接设置已在其他标签页改变，请重新打开设置核对');
        const token = String(message.token || '').trim() || (old?.server === server ? old.token : '');
        if (!token) throw new ApiError('TOKEN_REQUIRED', '请输入用户令牌；更换服务地址时需重新填写');
        if (!await permissions.contains({origins: [permissionOrigin(server)]})) throw new ApiError('PERMISSION_REQUIRED', '请允许插件访问该 NAS 地址');
        const probe = await client({server, token})('/api/status');
        if (probe.role !== 'human') throw new ApiError(probe.role === 'ai' ? 'USER_TOKEN_REQUIRED' : 'UPGRADE_REQUIRED', probe.role === 'ai' ? '这是 agent 令牌，请使用 NAS 服务的用户令牌' : '请将 kbcli 服务升级至 0.1.2 或以上');
        const c = {server, token, revision: revision()};
        await localLane(async()=>{
          if ((await config())?.revision !== old?.revision) throw new ApiError('CONNECTION_CHANGED','连接设置已改变，请重新核对');
          await storage.set({connection: c}); await storage.remove('snapshot');
        });
        if (old && permissionOrigin(old.server) !== permissionOrigin(server)) await permissions.remove({origins: [permissionOrigin(old.server)]});
        return publicConfig(c);
      }
      case 'disconnect': {
        const c = await config();
        if ((message.revision ?? null) !== (c?.revision ?? null)) throw new ApiError('CONNECTION_CHANGED','连接设置已在其他标签页改变，请重新打开设置核对');
        await localLane(async()=>{
          if ((await config())?.revision !== c?.revision) throw new ApiError('CONNECTION_CHANGED','连接设置已改变，请重新核对');
          await storage.remove(['connection', 'snapshot']);
        });
        if (c) await permissions.remove({origins: [permissionOrigin(c.server)]});
        return {configured: false};
      }
      case 'snapshot': return snapshot();
      case 'knowledge.list': case 'knowledge.read': {
        const c = await requireConfig(message.revision);
        let path;
        if (message.type === 'knowledge.list') {
          if (typeof message.query !== 'string' || message.query.length > 300) throw new ApiError('QUERY_INVALID','检索词不能超过 300 个字符');
          path = message.query.trim() ? '/api/search?q='+encodeURIComponent(message.query.trim())+'&limit=20' : '/api/recent?limit=20';
        } else {
          if (typeof message.path !== 'string' || !message.path.endsWith('.md') || message.path.length > 4096 || message.path.startsWith('/') || message.path.includes('\\') || message.path.split('/').some(p=>p==='..'||p==='.'||!p)) throw new ApiError('PATH_INVALID','知识文件路径无效');
          path = '/api/read?path='+encodeURIComponent(message.path);
        }
        const result = await client(c)(path); await ensureCurrent(c);
        if (message.type === 'knowledge.list' && !Array.isArray(message.query.trim() ? result.results : result.records)) throw new ApiError('RESPONSE_INVALID','知识列表格式无效');
        if (message.type === 'knowledge.read' && typeof result.content !== 'string') throw new ApiError('RESPONSE_INVALID','知识内容格式无效');
        return result;
      }
      case 'create': case 'update': case 'complete': {
        const c = await requireConfig(message.revision);
        const known = (await storage.get('snapshot')).snapshot;
        if (known?.revision !== c.revision || known.resources.status?.data?.role !== 'human' || known.resources.status?.stale || known.resources.tasks?.stale)
          throw new ApiError('REFRESH_REQUIRED', '请先成功刷新数据，再修改待办');
        let path = '/api/tasks', method = 'POST', body;
        if (message.type === 'create') {
          const task = validateTask(message.task); body = {title: task.title, due: task.due, tags: task.tags};
        } else {
          if (!/^[0-9a-f-]{36}$/i.test(message.id || '') || !/^sha256:[0-9a-f]{64}$/.test(message.hash || '')) throw new ApiError('TASK_INVALID', '待办版本信息无效，请刷新');
          path += '/' + encodeURIComponent(message.id); method = 'PATCH';
          const changes = message.type === 'complete' ? {status: 'done'} : message.changes;
          if (!changes || Object.keys(changes).some(key => !['title', 'due', 'tags', 'status'].includes(key)) || (message.type === 'update' && changes.status === 'done')) throw new ApiError('TASK_INVALID', '待办修改字段无效');
          body = {expect_hash: message.hash, changes};
        }
        // Never replay a write after a timeout. Existing cache becomes read-only until refreshed.
        const stale = structuredClone(known);
        stale.resources.tasks.stale = true;
        await storage.set({snapshot: stale});
        try {
          const saved = await client(c)(path, {method, body});
          if (!/^sha256:[0-9a-f]{64}$/.test(saved.file_hash || '')) throw new ApiError('RESPONSE_INVALID','服务未返回有效的保存版本，请刷新核对，不要重复提交',{writeUncertain:true});
          await ensureCurrent(c);
          let fresh;
          try { fresh = await snapshot(); }
          catch { fresh = {connection: publicConfig(c), resources: stale.resources, writable: false}; }
          return {saved, snapshot: fresh};
        } catch (error) {
          throw error;
        }
      }
      default: throw new ApiError('MESSAGE_INVALID', '不支持的插件操作');
    }
  }
  const backups=createBackups({storage,permissions,navigation,appearance,localLane,fetcher,now,revision});
  const workspace=createWorkspace({storage,permissions,navigation,appearance,localLane,fetcher,now,revision,identity:async()=>{
    let saved=(await storage.get('backup')).backup;
    if(!saved){await backups.handle({type:'backup.status'});saved=(await storage.get('backup')).backup;}
    return {deviceId:saved.deviceId,deviceName:saved.deviceName};
  }});
  const handle = async message => {
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') throw new ApiError('MESSAGE_INVALID','不支持的插件操作');
    if(message.type.startsWith('icons.'))return iconBatch.handle(message);
    if(message.type.startsWith('audit.'))return audit.handle(message);
    if(message.type.startsWith('capture.'))return localLane(()=>capture(message));
    if (message.type.startsWith('workspace.')) return workspace.handle(message);
    if (message.type.startsWith('backup.')) return backups.handle(message);
    if (message.type.startsWith('appearance.')) return localLane(() => appearance(message));
    if (/^(navigation\.|bookmark\.|group\.|preferences\.)/.test(message.type)) return localLane(() => navigation(message));
    if (message.type !== 'snapshot') return nasLane(() => dispatch(message));
    if (!pendingSnapshot) {
      const pending = nasLane(() => dispatch(message)); pendingSnapshot = pending;
      void (async () => { try { await pending; } catch {} finally { if (pendingSnapshot === pending) pendingSnapshot = null; } })();
    }
    return pendingSnapshot;
  };
  handle.iconBatchTick=iconBatch.tick;
  handle.auditTick=audit.tick;
  handle.workspaceTick=workspace.tick;handle.workspaceChanged=workspace.changed;
  handle.freezeIcons=()=>localLane(async()=>{
    const current=await navigation({type:'navigation.get'}),missing=current.bookmarks.filter(site=>!site.icon);
    if(!missing.length)return current;
    let remaining=MAX_ICONS_BYTES-current.bookmarks.reduce((n,s)=>n+(s.icon?.dataURL?.length||0),0);const icons=[];
    for(const site of missing){
      let icon=null;try{icon=validateBookmarkIcon(await readLegacyIcon(site.url));}catch{}
      if(icon?.dataURL?.length>remaining)icon=null;
      if(icon?.dataURL)remaining-=icon.dataURL.length;
      icons.push({id:site.id,icon:icon||fallbackBookmarkIcon(site.title,site.url)});
    }
    return navigation({type:'navigation.freezeIcons',revision:current.revision,icons});
  });
  handle.backupTick=backups.tick;handle.backupChanged=backups.changed;
  return handle;
}
