import {initWorkbench} from './workbench-ui.mjs';
import {initIconBatch} from './icon-batch-ui.mjs';
import {ApiError, permissionOrigin, taskChanges, validateTask} from './api.mjs';
import {initWorkspace} from './workspace-ui.mjs';
import {initControls} from './controls.mjs';
import {initBackups} from './backup-ui.mjs';
import {initAppearance} from './appearance-ui.mjs';
import {initKnowledge} from './knowledge-ui.mjs';
import {initShell} from './shell.mjs';
import {initNavigation} from './navigation-ui.mjs';
import {bindLightDismiss,bindValidation,preserveFocus,protectDialogSecret,showDialog,showFormError} from './ui.mjs';
const $ = id => document.getElementById(id);
const labels = {pending: '待处理', doing: '进行中', done: '已完成', all: '全部待办', cancelled: '已取消'};
const statuses = {todo: '待办', doing: '进行中', done: '已完成', cancelled: '已取消'};
let snapshot = {connection: {configured: false}, resources: {}, writable: false};
let filter = 'pending', fetching = false, mutating = false, editing = null, conflict = false, latest = null, uncertain = false;
let refreshGeneration = 0, toastTimer, refreshQueued = false;
let editingRevision = null, settingsRevision = null, connecting = false, taskRenderKey = null;
await initWorkbench();
initControls();
document.querySelectorAll('dialog').forEach(dialog=>bindLightDismiss(dialog));
const shell=initShell();
const knowledge=initKnowledge({send,getConnection:()=>snapshot.connection});
const closeSettings = protectDialogSecret($('settings-dialog'),$('token-input'),()=>connecting);
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new ApiError(response?.error?.code || 'EXTENSION_ERROR', response?.error?.message || '插件请求未完成，请重新打开标签页', response?.error || {});
  return response.data;
}
function toast(message, error = false) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').className = 'toast' + (error ? ' error' : ''); $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, error ? 9000 : 5000); }
const formError = showFormError;
function moment(value) { if (!value) return '—'; const date = new Date(typeof value === 'number' ? value : value); if (Number.isNaN(+date)) return '—'; return new Intl.DateTimeFormat('zh-CN', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date); }
function dot(id, state = '') { $(id).className = 'status-dot' + (state ? ' ' + state : ''); }
function tasks() { return snapshot.resources.tasks?.data?.tasks || []; }
function matches(task, mode) { return mode === 'all' || (mode === 'pending' ? ['todo', 'doing'].includes(task.status) : task.status === mode); }
function writable() { return snapshot.writable && !mutating; }
function render() {
  const restoreFocus = preserveFocus($('task-list'));
  knowledge.connectionChanged();
  const resources = snapshot.resources, all = tasks(), query = $('search').value.trim().toLowerCase();
  const visible = all.filter(task => matches(task, filter) && `${task.title} ${(task.tags || []).join(' ')}`.toLowerCase().includes(query));
  const hasTasks = Boolean(resources.tasks?.data);
  const pending=all.filter(t=>['todo','doing'].includes(t.status)).length;$('pending-badge').hidden=!hasTasks||!pending;$('pending-badge').textContent=pending;
  document.querySelectorAll('[data-count]').forEach(n => n.textContent = hasTasks ? all.filter(t => matches(t, n.dataset.count)).length : '—');
  document.querySelectorAll('[data-filter]').forEach(n => { n.classList.toggle('selected', n.dataset.filter === filter); n.setAttribute('aria-current', n.dataset.filter === filter ? 'page' : 'false'); });
  $('list-heading').textContent = labels[filter];
  $('list-caption').textContent = hasTasks ? `${all.filter(t => ['todo', 'doing'].includes(t.status)).length} 项待处理，把注意力留给眼前的事` : '连接知识库后，你的待办会出现在这里';
  $('list-total').textContent = hasTasks ? `显示 ${visible.length} 项，共 ${all.length} 项` : '待办数据尚未加载';
  $('add-button').disabled = !writable(); $('save-task-button').disabled = !writable() || conflict || uncertain || editingRevision !== snapshot.connection.revision;
  const list = $('task-list'), nextTaskKey=JSON.stringify([visible,snapshot.connection.revision,writable(),filter]);
  if(taskRenderKey!==nextTaskKey){taskRenderKey=nextTaskKey;list.replaceChildren();
  for (const task of visible) {
    const row = el('li', `task-row ${task.status}`); row.dataset.taskId = task.id;
    const check = el('button', `complete-button ${task.status}`, task.status === 'done' ? '✓' : task.status === 'cancelled' ? '−' : '');
    check.type = 'button'; check.dataset.focusKey = `task:${task.id}:complete`; check.setAttribute('aria-label', `${task.status === 'done' ? '已完成' : '完成待办'}：${task.title}`);
    const displayedRevision = snapshot.connection.revision;
    check.disabled = !writable() || ['done', 'cancelled'].includes(task.status); check.addEventListener('click', () => complete(task,displayedRevision));
    const body = el('div', 'task-body'), title = el('button', 'task-title', task.title);
    title.dataset.focusKey = `task:${task.id}:title`; title.disabled = !writable(); title.addEventListener('click', () => openTask(task,displayedRevision)); body.append(title);
    const meta = el('div', 'task-meta');
    if (task.due) meta.append(el('span', 'due' + (task.overdue ? ' overdue' : ''), `${task.overdue ? '已逾期 · ' : ''}${task.due}`));
    if (task.status === 'doing' || filter === 'all') meta.append(el('span', 'status-text', statuses[task.status] || '未知状态'));
    for (const tag of (task.tags || []).slice(0, 3)) meta.append(el('span', 'task-tag', tag));
    if ((task.tags || []).length > 3) meta.append(el('span', '', `+${task.tags.length - 3}`));
    body.append(meta);
    const edit = el('button', 'row-edit', '⋯'); edit.type = 'button'; edit.dataset.focusKey = `task:${task.id}:edit`; edit.setAttribute('aria-label', `修改待办：${task.title}`); edit.disabled = !writable(); edit.addEventListener('click', () => openTask(task,displayedRevision));
    row.append(check, body, edit); list.append(row);
  }
  }
  $('empty').hidden = visible.length > 0;
  $('empty-title').textContent = !snapshot.connection.configured ? '让待办和知识，回到自己的空间。' : !hasTasks ? '暂时没有取得待办数据' : query ? '没有找到匹配的待办' : filter === 'pending' ? '眼前的事情，已经安排妥当。' : '这里暂时没有待办';
  $('empty-copy').textContent = !snapshot.connection.configured ? '连接 NAS 后，即可在这里管理你的待办。' : !hasTasks ? '检查连接设置，或稍后刷新。' : query ? '试试其他标题或标签。' : '记下一件接下来想完成的事。';
  $('empty-action').textContent = !snapshot.connection.configured || !hasTasks ? '连接知识库' : '新增待办';
  $('empty-action').disabled = snapshot.connection.configured && hasTasks && !writable();
  const online = resources.tasks && !resources.tasks.stale && resources.status && !resources.status.stale;
  dot('connection-dot', !snapshot.connection.configured ? '' : online ? 'good' : 'warning');
  $('connection-label').textContent = !snapshot.connection.configured ? '尚未连接 NAS' : online ? snapshot.connection.server : '连接暂不可用 · 正在显示缓存';
  $('last-refresh').textContent = resources.tasks?.fetchedAt ? `${resources.tasks.stale ? '缓存于' : '更新于'} ${moment(resources.tasks.fetchedAt)}` : '';
  let notice = '';
  if (snapshot.connection.configured && !online) notice = resources.tasks?.error?.message || resources.status?.error?.message || '连接暂不可用，恢复连接并刷新后才能修改待办。';
  else if (online && !snapshot.writable) notice = '需要用户令牌才能修改待办，请检查连接设置。';
  else if (resources.tasks?.data?.issues?.length) notice = '部分待办存在规范问题，未显示在清单中。请检查 NAS 上的知识库。';
  if (resources.autosync?.data?.state === 'paused' && !resources.autosync.stale) notice ||= '自动同步已暂停。待办仍可保存到 NAS，暂时不会推送到 Gitee。';
  $('banner').textContent = notice; $('banner').hidden = !notice;
  renderStatus();
  restoreFocus();
}
function renderStatus() {
  const item = snapshot.resources.status, data = item?.data;
  $('record-count').textContent = data?.content?.records ?? '—';
  const counts = data?.content?.by_directory || {};
  $('directory-counts').replaceChildren(...[['笔记','notes'],['来源','sources'],['项目','projects']].map(([label,key]) => { const n = el('span', '', label + ' '); n.append(el('b', '', counts[key] ?? '—')); return n; }));
  const live = data && !item.stale;
  $('vault-badge').textContent = !data ? '未连接' : item.stale ? '缓存' : data.schema?.errors ? '待检查' : '已连接';
  $('vault-badge').className = 'badge ' + (!live ? 'neutral' : data.schema?.errors ? 'warning' : 'good');
  $('schema-state').textContent = data ? `${data.schema?.errors ?? '—'} 处错误${item.stale ? '（缓存）' : ''}` : '等待连接';
  $('index-state').textContent = !data ? '等待连接' : !data.index?.observed ? '状态未知' : !data.index?.initialized ? '尚未建立' : data.index.pending_files?.length ? `${data.index.pending_files.length} 个文件待更新` : '已更新';
  $('pending-state').textContent = data?.pending_tool_writes ? `${data.pending_tool_writes.length} 个文件` : '—';
  $('service-version').textContent = data?.version ? `kbcli ${data.version}` : '';
  const git = data?.git;
  $('git-state').textContent = !git ? '等待连接' : !live ? '缓存状态' : git.state === 'diverged' ? '历史分叉' : git.dirty?.length ? '有本机修改' : git.ahead ? `${git.ahead} 个提交待推送` : git.behind ? `${git.behind} 个提交待拉取` : git.ahead === 0 && git.behind === 0 ? '跟踪分支已对齐' : '上游状态未知';
  $('git-caption').textContent = git?.last_successful_sync ? `最近确认同步：${moment(git.last_successful_sync)}。` : '索引更新与远端 Git 同步分别展示。';
  const resource = snapshot.resources.autosync, sync = resource?.data, state = resource?.stale ? 'unavailable' : sync?.state;
  const names = {idle:'自动同步运行中',syncing:'正在同步',retrying:'等待重试',paused:'自动同步已暂停',stale:'调度器心跳已过期',resuming:'正在恢复',not_started:'调度器尚未启动',not_configured:'同步状态尚未接入',unavailable:'同步状态暂不可用'};
  $('sync-heading').textContent = names[state] || '等待连接 NAS';
  dot('sync-dot', ['idle','syncing'].includes(state) ? 'good' : ['paused','stale'].includes(state) ? 'bad' : state ? 'warning' : '');
  $('sync-description').textContent = resource?.error?.httpStatus === 404 ? '当前服务没有同步状态接口，请升级 NAS 服务。' : resource?.stale ? '无法读取最新状态；下方时间可能来自缓存。' : sync?.pause?.error?.message || sync?.last_error?.message || (state === 'idle' ? '工具保存的修改会自动提交推送，远端更新按周期拉取。' : state === 'paused' ? '保留本机内容与提交，请在 NAS 检查后人工恢复。' : state === 'not_configured' ? '请在 NAS 服务中配置自动同步状态目录。' : '文件保存、Git 同步和检索索引会分别展示。');
  $('sync-last').textContent = moment(sync?.last_success_at);
  $('sync-next').textContent = state === 'paused' ? '等待人工恢复' : moment(sync?.next_attempt_at);
  $('sync-interval').textContent = sync?.poll_seconds && sync?.pull_seconds ? `检查 ${sync.poll_seconds}s / 拉取 ${sync.pull_seconds}s` : '—';
}
async function refresh({quiet = true} = {}) {
  if (fetching) { refreshQueued = true; return; }
  if (mutating) return;
  const generation = ++refreshGeneration; fetching = true; $('refresh-button').disabled = true;
  try { const next = await send({type:'snapshot'}); if (generation === refreshGeneration) { snapshot = next; render(); } }
  catch (error) { if (!quiet) toast(error.message, true); }
  finally { fetching = false; $('refresh-button').disabled = false; if (refreshQueued) { refreshQueued = false; void refresh(); } }
}
function openSettings() {
  settingsRevision = snapshot.connection.revision ?? null;
  $('server-input').value = snapshot.connection.server || '';
  $('token-input').value = ''; $('token-input').placeholder = snapshot.connection.configured ? '留空保留此地址的现有令牌' : '填写 NAS 服务的用户令牌';
  $('disconnect-button').hidden = !snapshot.connection.configured; formError('settings-error', null); showDialog('settings-dialog','settings-button');
}
function fillTask(task) {
  editingRevision = snapshot.connection.revision;
  editing = task ? structuredClone(task) : null; conflict = false; latest = null; uncertain = false;
  $('task-title').value = task?.title || ''; $('task-due').value = task?.due || ''; $('task-tags').value = (task?.tags || []).join('，'); $('task-status').value = task?.status || 'todo';
  $('task-status-label').hidden = !task; $('task-dialog-title').textContent = task ? '修改待办' : '新增待办';
  $('save-task-button').textContent = task ? '保存修改' : '新增待办'; $('save-task-button').disabled = !writable(); $('conflict-box').hidden = true; formError('task-error', null);
}
function openTask(task = null,revision = snapshot.connection.revision) { if (!writable() || revision !== snapshot.connection.revision) return; fillTask(task); showDialog('task-dialog','add-button'); $('task-title').focus(); }
async function complete(task,revision) {
  if (!writable() || revision !== snapshot.connection.revision) return;
  mutating = true; render();
  try { const response = await send({type:'complete', revision, id:task.id, hash:task.file_hash}); snapshot = response.snapshot; toast('待办已完成，等待后台同步'); }
  catch (error) { toast(error.message, true); }
  finally { mutating = false; render(); await refresh(); }
}
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); if (connecting) return;
  const server = $('server-input').value, token = $('token-input').value, revision = settingsRevision;
  connecting = true; const button = $('connect-button'); button.textContent = '正在连接…'; formError('settings-error', null);
  $('settings-form').querySelectorAll('input,button').forEach(n=>n.disabled=true);
  try {
    // Must be requested directly from this user gesture, before messaging the worker.
    const origin = permissionOrigin(server);
    if (!await chrome.permissions.request({origins:[origin]})) throw new ApiError('PERMISSION_REQUIRED', '需要允许访问这个 NAS 地址才能连接');
    const connection = await send({type:'connect', server, token, revision});
    snapshot = {connection, resources:{}, writable:false}; closeSettings(); render(); await refresh({quiet:false}); toast('已连接知识库');
  } catch (error) { formError('settings-error', error); }
  finally { connecting = false; $('settings-form').querySelectorAll('input,button').forEach(n=>n.disabled=false); button.textContent = '连接并保存'; $('settings-form').querySelector('[aria-invalid="true"]')?.focus(); }
});
$('disconnect-button').addEventListener('click', async () => {
  if (connecting) return;
  connecting = true;
  try { await send({type:'disconnect',revision:settingsRevision}); ++refreshGeneration; snapshot = {connection:{configured:false},resources:{},writable:false}; closeSettings(); render(); toast('已断开连接并清除缓存'); }
  catch (error) { formError('settings-error',error); }
  finally { connecting = false; }
});
$('task-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!writable() || conflict || uncertain) return;
  if (editingRevision !== snapshot.connection.revision) { formError('task-error',new ApiError('CONNECTION_CHANGED','连接已改变，当前草稿已保留。请关闭后在目标知识库重新新增或编辑')); return; }
  formError('task-error', null);
  const input = {title:$('task-title').value,due:$('task-due').value,tags:$('task-tags').value,status:$('task-status').value};
  let message;
  try { const task = validateTask(input); message = editing ? {type:'update',id:editing.id,hash:editing.file_hash,changes:taskChanges(editing,task)} : {type:'create',task}; if (editing && !Object.keys(message.changes).length) { $('task-dialog').close(); return; } }
  catch (error) { formError('task-error', error); return; }
  mutating = true; render();
  try { const response = await send({...message,revision:editingRevision}); snapshot = response.snapshot; $('task-dialog').close(); toast('已保存到 NAS，等待后台同步'); }
  catch (error) {
    formError('task-error', error);
    if (error.code === 'FILE_CHANGED') conflict = true;
    if (error.writeUncertain) uncertain = true;
  } finally {
    mutating = false; render(); await refresh(); render();
    if (conflict) { latest = tasks().find(t => t.id === editing?.id); $('conflict-box').hidden = false; $('conflict-latest').textContent = latest ? `最新内容：${latest.title}；${statuses[latest.status]}；截止 ${latest.due || '未设置'}。载入会替换当前输入。` : '最新记录暂不可读，请恢复连接后关闭编辑并刷新。'; $('load-latest').disabled = !latest; }
  }
});
$('load-latest').addEventListener('click', () => { if (latest && editingRevision === snapshot.connection.revision) fillTask(latest); });
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => { const id=button.dataset.close; if ($(id).kbCanDismiss?.()===false)return; if ((id!=='task-dialog'||!mutating)&&(id!=='settings-dialog'||!connecting)) { if(id==='settings-dialog')closeSettings();else $(id).close(); } }));
$('task-dialog').addEventListener('cancel', event => { if (mutating) event.preventDefault(); });
$('filters').addEventListener('click', event => { const button = event.target.closest('[data-filter]'); if (button) { filter = button.dataset.filter; render(); } });
$('search').addEventListener('input', render); $('settings-button').addEventListener('click', openSettings); $('refresh-button').addEventListener('click', () => refresh({quiet:false})); $('add-button').addEventListener('click', () => openTask());
$('empty-action').addEventListener('click', () => !snapshot.connection.configured || !snapshot.resources.tasks?.data ? openSettings() : openTask());
const knowledgeTabs=['tasks','knowledge','status'];
const tabScroll=new Map();
function selectKnowledgeTab(name) {
  const scroller=document.querySelector('.drawer-content'),previous=knowledgeTabs.find(key=>$(key+'-tab').getAttribute('aria-selected')==='true');
  if(previous!==name)tabScroll.set(previous,scroller.scrollTop);
  for(const key of knowledgeTabs){const active=key===name;$(key+'-view').hidden=!active;$(key+'-tab').classList.toggle('selected',active);$(key+'-tab').setAttribute('aria-selected',String(active));$(key+'-tab').tabIndex=active?0:-1;}
  scroller.scrollTop=tabScroll.get(name)||0;
  if(name==='knowledge')knowledge.activate();else knowledge.deactivate();
}
for(const key of knowledgeTabs)$(key+'-tab').addEventListener('click',()=>selectKnowledgeTab(key));
document.querySelector('.knowledge-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();let index=knowledgeTabs.findIndex(key=>$(key+'-tab').getAttribute('aria-selected')==='true');index=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3;selectKnowledgeTab(knowledgeTabs[index]);$(knowledgeTabs[index]+'-tab').focus();});
$('knowledge-settings').addEventListener('click',openSettings);
function dateLabel() { const now=new Date();$('date-label').textContent=new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'}).format(now);$('clock').textContent=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false}).format(now);$('clock').dateTime=now.toISOString();$('greeting').textContent=now.getHours()<11?'早安，给今天一个从容的开始。':now.getHours()<18?'午后，把注意力留给喜欢的事。':'夜深了，留一点空间给自己。'; }
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.connection) {
  ++refreshGeneration;
  const next = changes.connection.newValue;
  snapshot = {connection:next ? {configured:true,server:next.server,revision:next.revision} : {configured:false},resources:{},writable:false};
  if ($('task-dialog').open) formError('task-error',new ApiError('CONNECTION_CHANGED','知识库连接已改变，草稿已保留；请关闭后重新核对目标知识库'));
  render(); void refresh();
} });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(() => { dateLabel(); if (!document.hidden && !$('settings-dialog').open) refresh(); }, 30000);
for (const [form,error] of [['settings-form','settings-error'],['task-form','task-error']]) bindValidation(form,error);
dateLabel(); render();
try {
  await initAppearance({send,toast});
  await initNavigation({send,toast,onPreferences:shell.preferences});
  // Decode the saved wallpaper before revealing the local view; never wait for NAS.
  const wallpaper=$('wallpaper-image');
  let timer;
  try { await Promise.race([wallpaper.decode().catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,1200);})]); }
  finally { clearTimeout(timer); }
} finally { window.kbStartup?.finish(); }
await initIconBatch({send,toast}); await initBackups({send,toast,getConnection:()=>snapshot.connection}); await initWorkspace({send,toast,getConnection:()=>snapshot.connection}); await refresh();
