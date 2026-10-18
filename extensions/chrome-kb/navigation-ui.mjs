import {MAX_BACKUP_BYTES,exportNavigation} from './navigation.mjs';
import {bindValidation,preserveFocus,showDialog,showFormError} from './ui.mjs';
const $ = id => document.getElementById(id);
const node = (tag, className, text) => { const n = document.createElement(tag); n.className = className || ''; if (text !== undefined) n.textContent = text; return n; };
export async function initNavigation({send,toast}) {
  let data = null, selected = 'all', editingSite = null, editingGroup = null, siteRevision, groupRevision, busy = false;
  const error = showFormError;
  function action(label, text, handler, disabled = false, key = label) {
    const b = node('button','small-icon',text); b.type = 'button'; b.dataset.focusKey=key; b.title = label; b.setAttribute('aria-label',label); b.disabled = disabled; b.addEventListener('click',handler); return b;
  }
  async function load() {
    try { data = await send({type:'navigation.get'}); error('navigation-error',null); render(); }
    catch (e) { error('navigation-error',e); }
  }
  async function mutate(message, errorId, rev = data?.revision) {
    if (busy || !data) return false;
    busy = true; document.querySelectorAll('#site-dialog button,#group-dialog button,.toggle-row input').forEach(b => b.disabled = true);
    try { data = await send({...message,revision:rev}); error(errorId,null); render(); return true; }
    catch (e) { if (e.code === 'NAVIGATION_CHANGED') { await load(); siteRevision = data?.revision; groupRevision = data?.revision; } error(errorId,e); toast(e.message,true); return false; }
    finally { busy = false; document.querySelectorAll('#site-dialog button,#group-dialog button,.toggle-row input').forEach(b => b.disabled = false); if (data) applyPreferences(); }
  }
  function applyPreferences() {
    const p = data.preferences;
    $('knowledge-panel').hidden = !p.showKnowledge;
    $('show-knowledge-button').hidden = p.showKnowledge;
    document.body.classList.toggle('knowledge-hidden',!p.showKnowledge);
    document.body.classList.toggle('compact-sites',p.compact);
    $('pref-new-tab').checked = p.openInNewTab; $('pref-knowledge').checked = p.showKnowledge; $('pref-compact').checked = p.compact;
  }
  function render() {
    if (!data) return;
    const restoreNav = preserveFocus($('group-nav')),restoreSites = preserveFocus($('site-groups'));
    applyPreferences();
    if (selected !== 'all' && !data.groups.some(g => g.id === selected)) selected = 'all';
    const query = $('site-search').value.trim().toLowerCase();
    const visible = data.bookmarks.filter(s => (selected === 'all' || s.groupId === selected) && `${s.title} ${s.url}`.toLowerCase().includes(query));
    const byGroup = new Map(data.groups.map(g=>[g.id,[]])), filtered = new Map(data.groups.map(g=>[g.id,[]]));
    for (const site of data.bookmarks) byGroup.get(site.groupId).push(site);
    for (const site of visible) filtered.get(site.groupId).push(site);
    $('site-total').textContent = `共 ${data.bookmarks.length} 个收藏，${data.groups.length} 个分组${query ? ` · 找到 ${visible.length} 个` : ''}`;
    const nav = $('group-nav'); nav.replaceChildren();
    for (const group of [{id:'all',name:'全部网站'},...data.groups]) {
      const b = node('button','nav-item' + (selected === group.id ? ' selected' : ''));
      b.type = 'button'; b.dataset.groupId = group.id; b.dataset.focusKey=`group:${group.id}:filter`; b.setAttribute('aria-current',selected === group.id ? 'page' : 'false');
      b.append(node('span','nav-symbol',group.id === 'all' ? '▦' : '▱'),node('span','group-name',group.name),node('span','nav-count',group.id === 'all' ? data.bookmarks.length : byGroup.get(group.id).length));
      b.addEventListener('click',() => { selected = group.id; render(); }); nav.append(b);
    }
    const sections = $('site-groups'); sections.replaceChildren();
    for (const [index,group] of data.groups.entries()) {
      if (selected !== 'all' && selected !== group.id) continue;
      const sites = filtered.get(group.id),ordered=byGroup.get(group.id),positions=new Map(ordered.map((s,index)=>[s.id,index]));
      if (query && !sites.length) continue;
      const section = node('section','site-section'); section.dataset.groupId = group.id;
      const heading = node('div','group-heading'), title = node('h2','',group.name); title.append(node('span','group-size',sites.length));
      const controls = node('div','group-controls');
      controls.append(action(`向前移动分组：${group.name}`,'‹',() => mutate({type:'group.move',id:group.id,direction:-1},'navigation-error'),index === 0,`group:${group.id}:previous`),action(`向后移动分组：${group.name}`,'›',() => mutate({type:'group.move',id:group.id,direction:1},'navigation-error'),index === data.groups.length-1,`group:${group.id}:next`),action(`编辑分组：${group.name}`,'⋯',() => openGroup(group),false,`group:${group.id}:edit`),action(`收藏网站到：${group.name}`,'＋',() => openSite(null,group.id),false,`group:${group.id}:add`));
      heading.append(title,controls); section.append(heading);
      const grid = node('ul','site-grid');
      for (const site of sites) {
        const card = node('li','site-card'); card.dataset.siteId = site.id;
        const link = node('a','site-link'); link.href = site.url; link.target = data.preferences.openInNewTab ? '_blank' : '_self'; link.rel = 'noopener noreferrer';
        link.dataset.focusKey=`site:${site.id}:link`;
        const host = new URL(site.url).hostname.replace(/^www\./,'');
        const icon = node('span','site-icon',host.slice(0,1).toUpperCase()); icon.setAttribute('aria-hidden','true');
        const hue = Array.from(host).reduce((sum,char) => sum + char.charCodeAt(0),0) % 360;
        icon.style.backgroundColor = `hsl(${hue} 35% 94%)`; icon.style.color = `hsl(${hue} 30% 36%)`;
        const copy = node('span','site-copy'); copy.append(node('strong','',site.title),node('span','site-host',host)); link.append(icon,copy);
        const controls = node('div','site-controls');
        const position = positions.get(site.id);
        controls.append(action(`向前移动网站：${site.title}`,'‹',() => mutate({type:'bookmark.move',id:site.id,direction:-1},'navigation-error'),position === 0 || Boolean(query),`site:${site.id}:previous`),action(`向后移动网站：${site.title}`,'›',() => mutate({type:'bookmark.move',id:site.id,direction:1},'navigation-error'),position === ordered.length-1 || Boolean(query),`site:${site.id}:next`),action(`编辑网站：${site.title}`,'⋯',() => openSite(site),false,`site:${site.id}:edit`));
        card.append(link,controls); grid.append(card);
      }
      if (!sites.length) { const add = node('button','add-site-placeholder','＋ 收藏网站到此分组'); add.dataset.focusKey=`group:${group.id}:first-site`; add.addEventListener('click',() => openSite(null,group.id)); const item=node('li');item.append(add);grid.append(item); }
      section.append(grid); sections.append(section);
    }
    $('site-empty').hidden = !query || visible.length > 0;
    // A dedicated first-run state leaves group controls available above it.
    if (!data.bookmarks.length && !query) { $('site-empty').hidden = false; $('site-empty-title').textContent = '把常去的网站放在这里'; $('site-empty-copy').textContent = '按工作、阅读或生活分组，打开新标签页就能找到。'; $('site-empty-action').textContent = '收藏第一个网站'; }
    else if (query) { $('site-empty-title').textContent = '没有找到匹配的网站'; $('site-empty-copy').textContent = '试试网站名称或域名，也可以清空搜索查看全部。'; $('site-empty-action').textContent = '清空搜索'; }
    restoreNav(); restoreSites();
  }
  function openSite(site = null, groupId = selected === 'all' ? 'default' : selected) {
    if (!data || busy) return;
    editingSite = site; siteRevision = data.revision;
    $('site-dialog-title').textContent = site ? '编辑网站' : '收藏网站'; $('site-title').value = site?.title || ''; $('site-url').value = site?.url || '';
    $('site-group').replaceChildren(...data.groups.map(g => { const option = node('option','',g.name); option.value = g.id; return option; })); $('site-group').value = site?.groupId || groupId;
    $('delete-site-button').hidden = !site; error('site-error',null); showDialog('site-dialog','add-site-button'); $('site-title').focus();
  }
  function openGroup(group = null) {
    if (!data || busy) return;
    editingGroup = group; groupRevision = data.revision;
    $('group-dialog-title').textContent = group ? '编辑分组' : '新建分组'; $('group-name').value = group?.name || '';
    const removable = group && group.id !== 'default'; $('delete-group-button').hidden = !removable; $('group-delete-hint').hidden = !removable;
    $('group-delete-hint').textContent = `删除此分组后，其中的网站会移入「${data.groups.find(g => g.id === 'default').name}」。`;
    $('delete-group-button').textContent = `删除分组并保留网站`; error('group-error',null); showDialog('group-dialog','new-group-button'); $('group-name').focus();
  }
  $('site-form').addEventListener('submit',async event => { event.preventDefault(); if (await mutate({type:editingSite ? 'bookmark.update' : 'bookmark.add',id:editingSite?.id,title:$('site-title').value,url:$('site-url').value,groupId:$('site-group').value},'site-error',siteRevision)) { $('site-dialog').close(); toast('网站已保存'); } });
  $('group-form').addEventListener('submit',async event => { event.preventDefault(); if (await mutate({type:editingGroup ? 'group.update' : 'group.add',id:editingGroup?.id,name:$('group-name').value},'group-error',groupRevision)) { $('group-dialog').close(); toast('分组已保存'); } });
  $('delete-site-button').addEventListener('click',async () => { if (await mutate({type:'bookmark.remove',id:editingSite.id},'site-error',siteRevision)) { $('site-dialog').close(); toast('收藏已删除'); } });
  $('delete-group-button').addEventListener('click',async () => { if (await mutate({type:'group.remove',id:editingGroup.id},'group-error',groupRevision)) { $('group-dialog').close(); toast('分组已删除，网站已保留到默认分组'); } });
  $('new-group-button').addEventListener('click',() => openGroup()); $('add-site-button').addEventListener('click',() => openSite());
  $('all-groups-button').addEventListener('click',() => { selected = 'all'; $('site-search').value = ''; render(); });
  $('site-search').addEventListener('input',() => data && render());
  $('site-empty-action').addEventListener('click',() => { if ($('site-search').value) { $('site-search').value = ''; render(); } else openSite(); });
  for (const [id,key] of [['pref-new-tab','openInNewTab'],['pref-knowledge','showKnowledge'],['pref-compact','compact']]) $(id).addEventListener('change',event => mutate({type:'preferences.update',changes:{[key]:event.target.checked}},'preferences-error'));
  $('show-knowledge-button').addEventListener('click',() => mutate({type:'preferences.update',changes:{showKnowledge:true}},'navigation-error'));
  $('export-sites-button').addEventListener('click',() => {
    if (!data) return;
    const backup = exportNavigation(data);
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
    const a = node('a'); a.href = url; a.download = `kb-bookmarks-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url),10000);
  });
  $('import-sites-input').addEventListener('change',async event => {
    const file = event.target.files[0]; if (!file) return;
    try { if (file.size > MAX_BACKUP_BYTES) { error('backup-error',Error('备份文件不能超过 16 MiB'));return; } const backup = JSON.parse(await file.text()); if (await mutate({type:'navigation.import',backup},'backup-error')) toast('收藏已合并导入'); }
    catch { error('backup-error',Error('无法读取收藏备份，请选择 KB 工作台导出的 JSON 文件')); }
    finally { event.target.value = ''; }
  });
  ['site-dialog','group-dialog'].forEach(id => $(id).addEventListener('cancel',event => { if (busy) event.preventDefault(); }));
  chrome.storage.onChanged.addListener((changes,area) => { if (area === 'local' && changes.navigation) void load(); });
  bindValidation('site-form','site-error'); bindValidation('group-form','group-error');
  await load();
}
