import {ApiError} from './api.mjs';
import {validateBookmarkIcon,equalBookmark,MAX_ICONS_BYTES,fallbackBookmarkIcon} from './bookmark-icon.mjs';
export const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
const fail = (message,field) => { throw new ApiError('NAVIGATION_INVALID', message,field ? {field} : {}); };
const text = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${label}需为 1–${max} 个字符`,({'网址':'url','网站名称':'title','分组名称':'name'})[label]);
  return value.trim();
};
export function bookmarkURL(value) {
  let raw = text(value, 4096, '网址');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = 'https://' + raw;
  let url; try { url = new URL(raw); } catch { fail('请输入有效的网址','url'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) fail('只支持不含账号密码的 HTTP 或 HTTPS 网址','url');
  return url.href;
}
export function validateNavigation(data) {
  if (!data || data.version !== 1 || typeof data.revision !== 'string' || !Array.isArray(data.groups) || !Array.isArray(data.bookmarks) || !data.preferences) fail('收藏数据无法读取，请保留本机数据以便恢复；原数据未被覆盖');
  if (data.groups.length > 100 || data.bookmarks.length > 2000) fail('收藏分组数据无效，原数据未被覆盖');
  const ids = new Set(), names = new Set();
  for (const group of data.groups) {
    if (!group || typeof group.id !== 'string' || !group.id || ids.has(group.id)) fail('分组标识无效');
    const name = text(group.name, 40, '分组名称');
    if (names.has(name)) fail('分组名称重复');
    ids.add(group.id); names.add(name);
  }
  const bookmarks = new Set();
  for (const site of data.bookmarks) {
    if (!site || typeof site.id !== 'string' || !site.id || bookmarks.has(site.id) || !ids.has(site.groupId)) fail('网站分组或标识无效');
    bookmarks.add(site.id); text(site.title, 100, '网站名称'); bookmarkURL(site.url);validateBookmarkIcon(site.icon);
  }
  if(data.bookmarks.reduce((n,s)=>n+(s.icon?.dataURL?.length||0),0)>MAX_ICONS_BYTES)fail('网站图标总容量超过 1 MiB，请减少自定义图片后再保存','icon');
  if (['openInNewTab', 'showKnowledge', 'compact'].some(key => typeof data.preferences[key] !== 'boolean')) fail('显示设置无效');
  return data;
}
export function createNavigationStore({storage, revision = () => crypto.randomUUID()}) {
  async function read() {
    const saved = (await storage.get('navigation')).navigation;
    return saved == null ? {version:1, revision:'initial', groups:[], bookmarks:[], preferences:{openInNewTab:true,showKnowledge:true,compact:false}} : validateNavigation(structuredClone(saved));
  }
  const find = (list, id) => { const item = list.find(x => x.id === id); if (!item) fail('内容已改变，请刷新后重试'); return item; };
  const move = (list, item, direction) => {
    if (![-1,1].includes(direction)) fail('排序方向无效');
    const index = list.indexOf(item), next = index + direction;
    if (next >= 0 && next < list.length) [list[index], list[next]] = [list[next], list[index]];
  };
  return async message => {
    const data = await read();
    if (message.type === 'navigation.get') return data;
    let capture;
    if(message.type==='bookmark.capture'){
      if(!/^[0-9a-f-]{36}$/i.test(message.operationId||''))fail('保存标识无效');
      capture={title:text(message.title,100,'网站名称'),url:bookmarkURL(message.url),groupId:message.groupId};
      capture.icon=validateBookmarkIcon(message.icon)||fallbackBookmarkIcon(capture.title,capture.url);
      // Stable create id and equality check make retry after popup/worker loss
      // harmless. A changed record still requires the original revision.
      const existing=data.bookmarks.find(s=>s.id===(message.id||message.operationId));
      if(equalBookmark(existing,capture))return data;
    }
    if (message.revision !== data.revision) throw new ApiError('NAVIGATION_CHANGED', '收藏已在其他标签页更新。已刷新列表，请核对后再次保存，当前输入已保留');
    const action = message.type;
    if(action==='navigation.freezeIcons'){
      if(!Array.isArray(message.icons))fail('图标快照无效');
      for(const item of message.icons){const site=find(data.bookmarks,item.id);if(!site.icon)site.icon=validateBookmarkIcon(item.icon)||fallbackBookmarkIcon(site.title,site.url);}
    }else if (action === 'group.add' || action === 'group.update') {
      const name = text(message.name, 40, '分组名称');
      if (data.groups.some(g => g.name === name && g.id !== message.id)) fail('已有同名分组','name');
      if (action === 'group.add') { if (data.groups.length >= 100) fail('最多支持 100 个分组'); data.groups.push({id:revision(),name}); }
      else find(data.groups,message.id).name = name;
    } else if (action === 'group.remove') {
      find(data.groups,message.id);
      const remaining=data.groups.filter(g=>g.id!==message.id),sites=data.bookmarks.filter(s=>s.groupId===message.id);
      if(sites.length&&!remaining.length)fail('最后一个分组还有网站，请先移出或删除网站后再删除分组');
      const target=sites.length?find(remaining,message.targetGroupId||remaining[0].id):null;
      data.groups=remaining;
      for(const site of sites)site.groupId=target.id;
    } else if (action === 'group.place') {
      const group = find(data.groups,message.id);
      if (message.beforeId !== null && message.beforeId !== undefined) find(data.groups,message.beforeId);
      if (message.beforeId === group.id) fail('不能移动到自身之前');
      data.groups = data.groups.filter(g => g.id !== group.id);
      const index = message.beforeId == null ? data.groups.length : data.groups.findIndex(g => g.id === message.beforeId);
      data.groups.splice(index,0,group);
    } else if (action === 'bookmark.place') {
      const site = find(data.bookmarks,message.id);
      find(data.groups,message.groupId);
      const before = message.beforeId == null ? null : find(data.bookmarks,message.beforeId);
      if (before && (before.id === site.id || before.groupId !== message.groupId)) fail('目标网站不属于此分组');
      data.bookmarks = data.bookmarks.filter(s => s.id !== site.id);
      site.groupId = message.groupId;
      let index = before ? data.bookmarks.findIndex(s => s.id === before.id) : data.bookmarks.findLastIndex(s => s.groupId === site.groupId)+1;
      if (!before && index === 0) index = data.bookmarks.length;
      data.bookmarks.splice(index,0,site);
    } else if (action === 'group.move') {
      move(data.groups,find(data.groups,message.id),message.direction);
    } else if(action==='bookmark.capture'){
      find(data.groups,capture.groupId);
      const duplicate=data.bookmarks.find(s=>s.url===capture.url&&s.id!==message.id&&s.id!==message.operationId);
      const edited=message.id?data.bookmarks.find(s=>s.id===message.id):null;
      if(duplicate&&(!edited||edited.url!==capture.url))throw new ApiError('BOOKMARK_EXISTS','这个网址已经收藏，请重新打开弹窗编辑已有收藏');
      if(message.id){const site=find(data.bookmarks,message.id);Object.assign(site,capture);if(!capture.icon)delete site.icon;}
      else {if(data.bookmarks.length>=2000)fail('最多支持 2000 个网站');if(data.bookmarks.some(s=>s.id===message.operationId))fail('此保存已完成，请重新打开弹窗核对');data.bookmarks.push({id:message.operationId,...capture});}
    } else if (action === 'bookmark.add' || action === 'bookmark.update') {
      const title = text(message.title,100,'网站名称'), url = bookmarkURL(message.url);
      find(data.groups,message.groupId);
      const icon=Object.hasOwn(message,'icon')?validateBookmarkIcon(message.icon):undefined;
      if (action === 'bookmark.add') { if (data.bookmarks.length >= 2000) fail('最多支持 2000 个网站'); data.bookmarks.push({id:revision(),title,url,groupId:message.groupId,icon:icon||fallbackBookmarkIcon(title,url)}); }
      else {const site=find(data.bookmarks,message.id);Object.assign(site,{title,url,groupId:message.groupId});if(icon!==undefined){if(icon)site.icon=icon;else delete site.icon;}}
    } else if (action === 'bookmark.remove') {
      find(data.bookmarks,message.id); data.bookmarks = data.bookmarks.filter(s => s.id !== message.id);
    } else if (action === 'bookmark.move') {
      const site = find(data.bookmarks,message.id), ordered = data.bookmarks.filter(s => s.groupId === site.groupId);
      move(ordered,site,message.direction);
      let index = 0; data.bookmarks = data.bookmarks.map(s => s.groupId === site.groupId ? ordered[index++] : s);
    } else if (action === 'navigation.import') {
      const input = message.backup;
      if (input?.format !== 'kb-workspace-bookmarks' || new TextEncoder().encode(JSON.stringify(input)).byteLength > MAX_BACKUP_BYTES) fail('请选择 KB 工作台导出的收藏备份（不超过 16 MiB）');
      validateNavigation({...input, revision:'import', preferences:data.preferences});
      const groups = new Map();
      for (const group of input.groups) {
        let target = data.groups.find(g => g.name === group.name.trim());
        if (!target) { target = {id:revision(),name:group.name.trim()}; data.groups.push(target); }
        groups.set(group.id,target.id);
      }
      for (const site of input.bookmarks) {
        const url = bookmarkURL(site.url), groupId = groups.get(site.groupId);
        if (!data.bookmarks.some(s => s.url === url && s.groupId === groupId)) {const icon=validateBookmarkIcon(site.icon)||fallbackBookmarkIcon(site.title,url);data.bookmarks.push({id:revision(),title:site.title.trim(),url,groupId,icon});}
      }
    } else if (action === 'preferences.update') {
      const changes = message.changes;
      if (!changes || !Object.keys(changes).length || Object.entries(changes).some(([key,value]) => !['openInNewTab','showKnowledge','compact'].includes(key) || typeof value !== 'boolean')) fail('显示设置无效');
      Object.assign(data.preferences,changes);
    } else fail('不支持的收藏操作');
    data.revision = revision(); validateNavigation(data);
    try{await storage.set({navigation:data});}catch{throw new ApiError('STORAGE_FULL','收藏未保存，浏览器存储空间不足；原收藏已保留');}
    return data;
  };
}
export function exportNavigation(data) {
  validateNavigation(data);
  return {format:'kb-workspace-bookmarks',version:1,groups:data.groups.map(({id,name})=>({id,name})),bookmarks:data.bookmarks.map(({id,title,url,groupId,icon})=>({id,title,url,groupId,...(icon?{icon:validateBookmarkIcon(icon)}:{})}))};
}
