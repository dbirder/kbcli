import {ApiError} from './api.mjs';
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
  if (!data.groups.length || data.groups.length > 100 || data.bookmarks.length > 2000 || !data.groups.some(g => g?.id === 'default')) fail('收藏分组数据无效，原数据未被覆盖');
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
    bookmarks.add(site.id); text(site.title, 100, '网站名称'); bookmarkURL(site.url);
  }
  if (['openInNewTab', 'showKnowledge', 'compact'].some(key => typeof data.preferences[key] !== 'boolean')) fail('显示设置无效');
  return data;
}
export function createNavigationStore({storage, revision = () => crypto.randomUUID()}) {
  async function read() {
    const saved = (await storage.get('navigation')).navigation;
    return saved == null ? {version:1, revision:'initial', groups:[{id:'default',name:'常用'}], bookmarks:[], preferences:{openInNewTab:true,showKnowledge:true,compact:false}} : validateNavigation(structuredClone(saved));
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
    if (message.revision !== data.revision) throw new ApiError('NAVIGATION_CHANGED', '收藏已在其他标签页更新。已刷新列表，请核对后再次保存，当前输入已保留');
    const action = message.type;
    if (action === 'group.add' || action === 'group.update') {
      const name = text(message.name, 40, '分组名称');
      if (data.groups.some(g => g.name === name && g.id !== message.id)) fail('已有同名分组','name');
      if (action === 'group.add') { if (data.groups.length >= 100) fail('最多支持 100 个分组'); data.groups.push({id:revision(),name}); }
      else find(data.groups,message.id).name = name;
    } else if (action === 'group.remove') {
      if (message.id === 'default') fail('常用分组需要保留，可以修改名称');
      find(data.groups,message.id);
      data.groups = data.groups.filter(g => g.id !== message.id);
      for (const site of data.bookmarks) if (site.groupId === message.id) site.groupId = 'default';
    } else if (action === 'group.move') {
      move(data.groups,find(data.groups,message.id),message.direction);
    } else if (action === 'bookmark.add' || action === 'bookmark.update') {
      const title = text(message.title,100,'网站名称'), url = bookmarkURL(message.url);
      find(data.groups,message.groupId);
      if (action === 'bookmark.add') { if (data.bookmarks.length >= 2000) fail('最多支持 2000 个网站'); data.bookmarks.push({id:revision(),title,url,groupId:message.groupId}); }
      else Object.assign(find(data.bookmarks,message.id),{title,url,groupId:message.groupId});
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
        if (!data.bookmarks.some(s => s.url === url && s.groupId === groupId)) data.bookmarks.push({id:revision(),title:site.title.trim(),url,groupId});
      }
    } else if (action === 'preferences.update') {
      const changes = message.changes;
      if (!changes || !Object.keys(changes).length || Object.entries(changes).some(([key,value]) => !['openInNewTab','showKnowledge','compact'].includes(key) || typeof value !== 'boolean')) fail('显示设置无效');
      Object.assign(data.preferences,changes);
    } else fail('不支持的收藏操作');
    data.revision = revision(); validateNavigation(data);
    await storage.set({navigation:data});
    return data;
  };
}
export function exportNavigation(data) {
  validateNavigation(data);
  return {format:'kb-workspace-bookmarks',version:1,groups:data.groups.map(({id,name})=>({id,name})),bookmarks:data.bookmarks.map(({id,title,url,groupId})=>({id,title,url,groupId}))};
}
