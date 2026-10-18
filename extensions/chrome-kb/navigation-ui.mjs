import {MAX_BACKUP_BYTES,exportNavigation} from './navigation.mjs';
import {bindValidation,preserveFocus,showDialog,showFormError} from './ui.mjs';
const $ = id => document.getElementById(id);
const node = (tag, className, text) => { const n = document.createElement(tag); n.className = className || ''; if (text !== undefined) n.textContent = text; return n; };
export async function initNavigation({send,toast,onPreferences=()=>{}}) {
  let folders = true, managing = false;
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
    busy = true; document.querySelectorAll('#site-dialog button,#group-dialog button,#pref-new-tab,#pref-knowledge,#pref-compact').forEach(b => b.disabled = true);
    try { data = await send({...message,revision:rev}); error(errorId,null); render(); return true; }
    catch (e) { if (e.code === 'NAVIGATION_CHANGED') { await load(); siteRevision = data?.revision; groupRevision = data?.revision; } error(errorId,e); toast(e.message,true); return false; }
    finally { busy = false; document.querySelectorAll('#site-dialog button,#group-dialog button,#pref-new-tab,#pref-knowledge,#pref-compact').forEach(b => b.disabled = false); if (data) applyPreferences(); }
  }
  function applyPreferences() {
    const p = data.preferences;
    onPreferences(p);
    $('knowledge-toggle').hidden = !p.showKnowledge;
    $('show-knowledge-button').hidden = p.showKnowledge;

    document.body.classList.toggle('compact-sites',p.compact);
    $('pref-new-tab').checked = p.openInNewTab; $('pref-knowledge').checked = p.showKnowledge; $('pref-compact').checked = p.compact;
  }
  function icon(site,mini=false) {
    const host=new URL(site.url).hostname.replace(/^www\./,''),hue=Array.from(host).reduce((a,c)=>a+c.charCodeAt(0),0)%360;
    const n=node('span',mini?'mini-icon':'site-icon',site.title.slice(0,1).toUpperCase());n.setAttribute('aria-hidden','true');
    n.style.backgroundColor=`hsl(${hue} 42% 84%)`;n.style.color=`hsl(${hue} 48% 25%)`;return n;
  }
  function siteCard(site,ordered,query='') {
    const card=node('li','site-card');card.dataset.siteId=site.id;
    const link=node('a','site-link');link.href=site.url;link.target=data.preferences.openInNewTab?'_blank':'_self';link.rel='noopener noreferrer';link.dataset.focusKey=`site:${site.id}:link`;
    const copy=node('span','site-copy');copy.append(node('strong','',site.title),node('span','site-host',new URL(site.url).hostname.replace(/^www\./,'')));link.append(icon(site),copy);
    const controls=node('div','site-controls'),position=ordered.indexOf(site);
    controls.append(action(`向前移动网站：${site.title}`,'‹',()=>mutate({type:'bookmark.move',id:site.id,direction:-1},'navigation-error'),position===0||Boolean(query),`site:${site.id}:previous`),action(`向后移动网站：${site.title}`,'›',()=>mutate({type:'bookmark.move',id:site.id,direction:1},'navigation-error'),position===ordered.length-1||Boolean(query),`site:${site.id}:next`),action(`编辑网站：${site.title}`,'⋯',()=>openSite(site),false,`site:${site.id}:edit`));
    card.append(link,controls);return card;
  }
  function renderFolder() {
    const group=data.groups.find(g=>g.id===selected);if(!group){if($('folder-dialog').open)$('folder-dialog').close();return;}
    const restore=preserveFocus($('folder-sites')),ordered=data.bookmarks.filter(s=>s.groupId===group.id),query=$('folder-search').value.trim().toLowerCase();
    const sites=ordered.filter(s=>`${s.title} ${s.url}`.toLowerCase().includes(query));
    $('folder-title').textContent=group.name;$('folder-count').textContent=`${ordered.length} 个网站`;
    $('folder-sites').replaceChildren(...sites.map(s=>siteCard(s,ordered,query)));$('folder-empty').hidden=sites.length>0;restore();
  }
  function render() {
    if(!data)return;const restore=preserveFocus($('site-groups'));applyPreferences();
    const query=$('site-search').value.trim().toLowerCase(),visible=data.bookmarks.filter(s=>`${s.title} ${s.url}`.toLowerCase().includes(query));
    $('site-total').textContent=query?`找到 ${visible.length} 个收藏`:`${data.groups.length} 个分组 · ${data.bookmarks.length} 个收藏`;
    const container=$('site-groups');container.className=folders&&!query?'folder-grid':'all-sites';container.replaceChildren();
    for(const [index,group] of data.groups.entries()) {
      const sites=data.bookmarks.filter(s=>s.groupId===group.id);
      if(folders&&!query){
        const tile=node('div','folder-tile'),button=node('button','folder-button');button.dataset.focusKey=`group:${group.id}:filter`;button.setAttribute('aria-label',`打开分组：${group.name}，${sites.length} 个网站`);
        const preview=node('span','folder-preview');for(const site of sites.slice(0,9))preview.append(icon(site,true));if(!sites.length)preview.append(node('span','folder-blank','＋'));
        button.append(preview,node('span','folder-label',group.name),node('span','folder-size',`${sites.length} 个网站`));
        button.addEventListener('click',()=>{selected=group.id;$('folder-search').value='';renderFolder();showDialog('folder-dialog','all-groups-button');});tile.append(button);
        if(managing){const controls=node('div','group-controls');controls.append(action(`向前移动分组：${group.name}`,'‹',()=>mutate({type:'group.move',id:group.id,direction:-1},'navigation-error'),index===0,`group:${group.id}:previous`),action(`向后移动分组：${group.name}`,'›',()=>mutate({type:'group.move',id:group.id,direction:1},'navigation-error'),index===data.groups.length-1,`group:${group.id}:next`),action(`编辑分组：${group.name}`,'⋯',()=>openGroup(group),false,`group:${group.id}:edit`));tile.append(controls);}container.append(tile);
      }else{
        const matches=sites.filter(s=>visible.includes(s));if(query&&!matches.length)continue;
        const section=node('section','site-section'),heading=node('div','group-heading');heading.append(node('h2','',group.name),action(`编辑分组：${group.name}`,'⋯',()=>openGroup(group),false,`group:${group.id}:edit`));
        const list=node('ul','site-grid');list.append(...matches.map(s=>siteCard(s,sites,query)));section.append(heading,list);container.append(section);
      }
    }
    $('site-empty').hidden=data.bookmarks.length>0&&(!query||visible.length>0);
    $('site-empty-title').textContent=query?'没有找到匹配的收藏':'收藏你的日常。';$('site-empty-copy').textContent=query?'试试名称或域名，或使用右侧按钮搜索网页。':'从一个网站、一个分组开始，整理属于自己的空间。';$('site-empty-action').textContent=query?'清空搜索':'收藏第一个网站';
    $('all-groups-button').setAttribute('aria-pressed',String(!folders));$('all-groups-button').querySelector('span').textContent=folders?'全部网站':'分组视图';
    $('edit-layout-button').setAttribute('aria-pressed',String(managing));$('edit-layout-button').textContent=managing?'完成管理':'管理';
    renderFolder();restore();
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
  $('all-groups-button').addEventListener('click',()=>{folders=!folders;$('site-search').value='';render();});
  $('edit-layout-button').addEventListener('click',()=>{managing=!managing;render();});
  $('folder-search').addEventListener('input',renderFolder);$('folder-add').addEventListener('click',()=>openSite(null,selected));$('folder-edit').addEventListener('click',()=>openGroup(data.groups.find(g=>g.id===selected)));
  $('folder-dialog').addEventListener('close',()=>{selected='all';});
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
