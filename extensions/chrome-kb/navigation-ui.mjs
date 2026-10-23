import {initSiteAudit} from './site-audit-ui.mjs';
import {normalizeIcon} from './capture-image.mjs';
import {paintBookmarkIcon,fallbackBookmarkIcon} from './bookmark-icon.mjs';
import Sortable from './vendor/sortable-1.15.7.mjs';
import {MAX_BACKUP_BYTES,exportNavigation,bookmarkURL} from './navigation.mjs';
import {bindValidation,preserveFocus,showDialog,showFormError} from './ui.mjs';
export function dropZoneForPoint(point,bounds,zones){
  if(!point||point.x<bounds.left||point.x>bounds.right||point.y<bounds.top||point.y>bounds.bottom)return null;
  return [...zones].find(zone=>{const r=zone.getBoundingClientRect();return point.x>=r.left&&point.x<=r.right&&point.y>=r.top&&point.y<=r.bottom;})||null;
}
// Read-only grid geometry: the indicator never changes card layout mid-drag.
export function insertionForPoint(point,bounds,cards){
  if(!point||point.x<bounds.left||point.x>bounds.right||point.y<bounds.top||point.y>bounds.bottom)return null;
  if(!cards.length)return {beforeId:null,left:bounds.left+8,top:bounds.top+8,height:100};
  const nearest=cards.reduce((best,card)=>Math.abs(point.y-(card.rect.top+card.rect.bottom)/2)<=Math.abs(point.y-(best.rect.top+best.rect.bottom)/2)?card:best);
  const row=cards.filter(card=>Math.abs(card.rect.top-nearest.rect.top)<2);
  const next=point.y<cards[0].rect.top?cards[0]:point.y>cards.at(-1).rect.bottom?null:row.find(card=>point.x<(card.rect.left+card.rect.right)/2);
  if(next)return {beforeId:next.id,left:next.rect.left-5,top:next.rect.top,height:next.rect.bottom-next.rect.top};
  const last=point.y>cards.at(-1).rect.bottom?cards.at(-1):row.at(-1);
  return {beforeId:cards[cards.indexOf(last)+1]?.id||null,left:last.rect.right+5,top:last.rect.top,height:last.rect.bottom-last.rect.top};
}
const $ = id => document.getElementById(id);
const node = (tag, className, text) => { const n = document.createElement(tag); n.className = className || ''; if (text !== undefined) n.textContent = text; return n; };
export async function initNavigation({send,toast,onPreferences=()=>{}}) {
  const audit=await initSiteAudit({send,toast});
  let folders = true;
  let preparingSite=false,creationURL=null,creationIcon=null;
  let data = null, selected = 'all', editingSite = null, editingGroup = null, siteRevision, groupRevision, busy = false;
  const error = showFormError;
  let sortables = [], dragging = false, dragRevision = null, pendingLoad = false, folderRenderKey = null, renderedFolder = null;
  function clearSortables() { for (const sortable of sortables) sortable.destroy(); sortables = []; folderRenderKey = null; }
  function clearFolderSortables() {
    const retained=[];
    for(const sortable of sortables) {
      if(sortable.el?.closest('#folder-dialog'))sortable.destroy();else retained.push(sortable);
    }
    sortables=retained;
  }
  function grip(label) {
    const handle = action(label+'；方向键调整顺序','⠿',()=>{});
    handle.classList.add('drag-handle');
    return handle;
  }
  let dragPointer=null,draggingSite=false,feedbackFrame=0,homeDrag=null,homeFrame=0,homeHover=null,homeHoverSince=0,suppressClickUntil=0;
  const spring=node('section','spring-folder');spring.id='spring-folder';spring.hidden=true;spring.setAttribute('aria-label','选择目标分组内的位置');
  const springTitle=node('h2');springTitle.id='spring-title';
  const springHint=node('p','quiet','拖到网站之间，松手插入；拖出窗口返回首页 · Esc 取消');
  const springScroll=node('div','folder-scroll spring-scroll');springScroll.id='spring-scroll';
  const springList=node('ul','site-grid');springList.id='spring-sites';
  const springMarker=node('div','spring-insertion');springMarker.id='spring-insertion';springMarker.hidden=true;springMarker.setAttribute('aria-hidden','true');
  const springEmpty=node('p','quiet','空分组，松手即可移入');
  springScroll.append(springList,springEmpty,springMarker);spring.append(springTitle,springHint,springScroll);$('folder-dialog').append(spring);
  function pointerPoint(event){const p=event?.changedTouches?.[0]||event?.touches?.[0]||event;return Number.isFinite(p?.clientX)&&Number.isFinite(p?.clientY)?{x:p.clientX,y:p.clientY}:null;}
  function dropZoneAt(point){
    if(!point||!$('folder-dialog').open||$('folder-drop-panel').hidden)return null;
    return dropZoneForPoint(point,$('folder-drop-groups').getBoundingClientRect(),$('folder-drop-groups').querySelectorAll('.drop-zone'));
  }
  function homeFolderAt(point){return dropZoneForPoint(point,$('collection-scroll').getBoundingClientRect(),$('site-groups').querySelectorAll('.folder-tile'));}
  function dragBanner(text){if($('home-drag-banner').textContent!==text)$('home-drag-banner').textContent=text;}
  function springPosition(point){return insertionForPoint(point,springScroll.getBoundingClientRect(),[...springList.children].map(el=>({id:el.dataset.siteId,rect:el.getBoundingClientRect()})));}
  function springFeedback(){
    const position=springPosition(dragPointer),r=springScroll.getBoundingClientRect();springMarker.hidden=!position;
    if(position){springMarker.style.left=`${position.left-r.left+springScroll.scrollLeft}px`;springMarker.style.top=`${position.top-r.top+springScroll.scrollTop}px`;springMarker.style.height=`${position.height}px`;}
    dragBanner(position?`松开插入「${data.groups.find(g=>g.id===homeDrag.preview)?.name||''}」的此位置`:'拖入列表选择位置；拖出窗口返回首页 · Esc 取消');
  }
  function closeSpring(){
    spring.hidden=true;springMarker.hidden=true;$('folder-dialog').classList.remove('spring-open');
    $('folder-dialog').setAttribute('aria-labelledby','folder-title');
    if(homeDrag){homeDrag.preview=null;homeDrag.entered=false;}
    homeHoverSince=performance.now();
  }
  function openSpring(groupId){
    // Do not rebuild/destroy the source Sortable or move the open dialog. Both
    // must stay connected until the original gesture's onEnd has completed.
    homeDrag.preview=groupId;homeDrag.entered=false;
    const sites=data.bookmarks.filter(site=>site.groupId===groupId);
    springTitle.textContent=data.groups.find(g=>g.id===groupId).name;
    springList.replaceChildren(...sites.map(site=>{const card=node('li','site-card'),copy=node('span','site-link');card.dataset.siteId=site.id;copy.append(icon(site),node('strong','spring-site-title',site.title));card.append(copy);return card;}));
    springEmpty.hidden=sites.length>0;springScroll.scrollTop=0;spring.hidden=false;
    $('folder-dialog').classList.remove('drag-to-home');$('folder-dialog').classList.add('spring-open');
    $('folder-dialog').setAttribute('aria-labelledby','spring-title');
    const r=$('folder-dialog').getBoundingClientRect(),p=dragPointer;
    homeDrag.entered=Boolean(p&&p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom);
    homeHover?.classList.remove('home-drop-target','home-drop-source');springFeedback();
  }
  function homeFeedback(){
    const target=homeFolderAt(dragPointer);
    if(homeHover!==target){
      homeHover?.classList.remove('home-drop-target','home-drop-source');homeHover=target;homeHoverSince=performance.now();
      if(target)target.classList.add(target.dataset.groupId===homeDrag.source?'home-drop-source':'home-drop-target');
    }
    dragBanner(target?(target.dataset.groupId===homeDrag.source?'松开取消，返回当前分组':`松开移入「${data.groups.find(g=>g.id===target.dataset.groupId)?.name||''}」 · 停留片刻展开`):'拖到首页文件夹，松开移动 · Esc 取消');
    if(target&&target.dataset.groupId!==homeDrag.source&&performance.now()-homeHoverSince>=650)openSpring(target.dataset.groupId);
  }
  function homeDragFeedback(){
    if(homeDrag.preview){
      const r=$('folder-dialog').getBoundingClientRect(),p=dragPointer;
      const inside=p&&p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom;
      if(inside){homeDrag.entered=true;springFeedback();return;}
      if(!homeDrag.entered){const target=homeFolderAt(p);if(!target||target.dataset.groupId===homeDrag.preview){springFeedback();return;}}
      closeSpring();$('folder-dialog').classList.add('drag-to-home');homeHover=null;
    }
    homeFeedback();
  }
  function homeAutoScroll(){
    if(!dragging||!homeDrag?.escaped||homeDrag.cancelled)return;
    const scroller=homeDrag.preview?springScroll:$('collection-scroll'),r=scroller.getBoundingClientRect(),p=dragPointer;
    let scrolled=false;
    if(p&&p.x>=r.left&&p.x<=r.right){
      const step=p.y>=r.top-12&&p.y<r.top+36?-12:p.y<=r.bottom+12&&p.y>r.bottom-36?12:0;
      if(step){const old=scroller.scrollTop;scroller.scrollTop+=step;scrolled=old!==scroller.scrollTop;}
    }
    if(!homeDrag.preview)homeDragFeedback();else if(scrolled)springFeedback();
    homeFrame=requestAnimationFrame(homeAutoScroll);
  }
  function clearHomeDrag(){
    if(homeFrame)cancelAnimationFrame(homeFrame);homeFrame=0;
    closeSpring();homeHover?.classList.remove('home-drop-target','home-drop-source');homeHover=null;
    $('folder-dialog').classList.remove('drag-to-home');$('home-drag-banner').hidden=true;document.body.classList.remove('home-drop-active');homeDrag=null;
  }
  function dropFeedback(event){
    if(!dragging||!draggingSite)return;
    dragPointer=pointerPoint(event)||dragPointer;
    if(feedbackFrame)return;
    feedbackFrame=requestAnimationFrame(()=>{
      feedbackFrame=0;
      document.querySelectorAll('.drop-zone.is-drop-target').forEach(zone=>zone.classList.remove('is-drop-target'));
      if(homeDrag&&!homeDrag.cancelled&&dragPointer){
        const p=dragPointer,r=homeDrag.bounds;
        if(homeDrag.escaped||p.x<r.left+8||p.x>r.right-8||p.y<r.top+8||p.y>r.bottom-8){
          if(!homeDrag.escaped){homeDrag.escaped=true;$('folder-dialog').classList.add('drag-to-home');$('home-drag-banner').hidden=false;document.body.classList.add('home-drop-active');homeAutoScroll();}
          homeDragFeedback();return;
        }
      }
      if(!homeDrag?.cancelled)dropZoneAt(dragPointer)?.classList.add('is-drop-target');
    });
  }
  document.addEventListener('pointermove',dropFeedback,{capture:true,passive:true});
  document.addEventListener('pointerdown',()=>{suppressClickUntil=0;},{capture:true,passive:true});
  document.addEventListener('click',event=>{if(event.detail>0&&performance.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();suppressClickUntil=0;}},true);
  document.addEventListener('wheel',event=>{if(dragging&&homeDrag?.escaped&&!homeDrag.cancelled){event.preventDefault();(homeDrag.preview?springScroll:$('collection-scroll')).scrollTop+=event.deltaY;homeDragFeedback();}},{capture:true,passive:false});
  $('folder-drop-groups').addEventListener('scroll',()=>dropFeedback(),{passive:true});
  function cancelHomeMove(){
    closeSpring();
    if(homeDrag)homeDrag.cancelled=true;
    if(homeFrame)cancelAnimationFrame(homeFrame);homeFrame=0;
    homeHover?.classList.remove('home-drop-target','home-drop-source');homeHover=null;
    $('folder-dialog').classList.remove('drag-to-home');$('home-drag-banner').hidden=true;document.body.classList.remove('home-drop-active');
  }
  $('folder-dialog').addEventListener('cancel',event=>{if(dragging&&draggingSite){event.preventDefault();cancelHomeMove();}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&dragging&&homeDrag){event.preventDefault();event.stopPropagation();cancelHomeMove();}},true);
  function copyIconPixels(source,target) {
    if(!target)return;
    const copies=target.querySelectorAll('canvas.favicon');
    source.querySelectorAll('canvas.favicon').forEach((canvas,index)=>{
      try{copies[index]?.getContext('2d').drawImage(canvas,0,0);}catch{/* A still-loading icon keeps its initial. */}
    });
  }
  function sortable(root,kind,groupId=null) {
    sortables.push(new Sortable(root,{
      draggable:kind==='group'?'.folder-tile':'.site-card',
      // The whole tile is draggable; editing controls keep their normal clicks.
      filter:'.site-controls, .group-controls, input, textarea, select',preventOnFilter:false,
      group:kind==='group'?'kb-groups':{name:'kb-sites',pull:true,put:true},
      sort:!root.classList.contains('drop-zone'),forceFallback:true,fallbackTolerance:8,
      delay:250,delayOnTouchOnly:true,touchStartThreshold:6,
      animation:matchMedia('(prefers-reduced-motion: reduce)').matches?0:140,
      ghostClass:'sort-ghost',chosenClass:'sort-chosen',fallbackClass:'sort-floating',
      onClone(event){copyIconPixels(event.item,event.clone);},
      onStart(event){
        const ghost=Sortable.ghost;
        // Keep the moving preview in the modal's top layer, outside the list's
        // clipped scrolling box. On the homepage use the viewport-level body.
        if(ghost)(event.item.closest('dialog')||document.body).append(ghost);
        copyIconPixels(event.item,ghost);dragging=true;draggingSite=kind==='site';dragPointer=pointerPoint(event.originalEvent);dragRevision=data.revision;document.body.classList.add('sorting');
        if(draggingSite&&root.closest('#folder-dialog'))homeDrag={source:root.dataset.groupId||groupId,bounds:$('folder-dialog').getBoundingClientRect(),escaped:false,cancelled:false};
      },
      onMove(event){dropFeedback(event.originalEvent);},
      onEnd(event){
        const point=pointerPoint(event.originalEvent)||dragPointer,home=homeDrag;
        const escaped=Boolean(home?.escaped),cancelled=Boolean(home?.cancelled||/cancel$/i.test(event.originalEvent?.type||''));
        const previewPosition=home?.preview&&!cancelled?springPosition(point):null;
        const dialogBounds=$('folder-dialog').getBoundingClientRect();
        const overPreview=home?.preview&&point&&point.x>=dialogBounds.left&&point.x<=dialogBounds.right&&point.y>=dialogBounds.top&&point.y<=dialogBounds.bottom;
        const homeTarget=escaped&&!cancelled&&!overPreview?homeFolderAt(point):null;
        const previewGroup=previewPosition?home.preview:null;
        const previewScroll=previewGroup?springScroll.scrollTop:0;
        const homeMove=Boolean(homeTarget&&homeTarget.dataset.groupId!==home.source);
        const zone=kind==='site'&&!escaped&&!cancelled?dropZoneAt(point):null;
        if(feedbackFrame)cancelAnimationFrame(feedbackFrame);feedbackFrame=0;dragPointer=null;draggingSite=false;
        dragging=false;suppressClickUntil=performance.now()+500;document.body.classList.remove('sorting');
        document.querySelectorAll('.drop-zone.is-drop-target').forEach(zone=>zone.classList.remove('is-drop-target'));
        if(previewGroup)selected=previewGroup;
        else if(homeMove){selected='all';$('folder-dialog').close();}
        clearHomeDrag();
        const id=kind==='group'?event.item.dataset.groupId:event.item.dataset.siteId;
        const beforeId=previewGroup?previewPosition.beforeId:homeMove||zone?null:kind==='group'?event.item.nextElementSibling?.dataset.groupId:event.item.nextElementSibling?.dataset.siteId;
        const targetGroup=previewGroup||homeTarget?.dataset.groupId||zone?.dataset.groupId||event.to.dataset.groupId||groupId;
        const changed=!cancelled&&(escaped?Boolean(previewGroup)||homeMove:Boolean(zone)||(!(point&&event.to.classList.contains('drop-zone'))&&(event.from!==event.to||event.oldDraggableIndex!==event.newDraggableIndex)));
        if(previewGroup){renderFolder();$('folder-scroll').scrollTop=previewScroll;}
        if(changed) void (async()=>{
          // The mutation returns the latest state (or loads it on conflict).
          pendingLoad=false;
          const ok=await mutate({type:kind==='group'?'group.place':'bookmark.place',id,groupId:targetGroup,beforeId:beforeId||null},'navigation-error',dragRevision);
          if(ok)toast(kind==='group'?'分组顺序已保存':'网站位置已保存');
          else render();
        })();
        else {render();if(pendingLoad){pendingLoad=false;void load();}}
      },
    }));
  }
  function keyboardMove(handle,kind,id) {
    handle.addEventListener('keydown',event=>{
      const direction={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1}[event.key];
      if(!direction)return;event.preventDefault();
      void mutate({type:kind+'.move',id,direction},'navigation-error');
    });
  }
  function action(label, text, handler, disabled = false, key = label) {
    const b = node('button','small-icon',text); b.type = 'button'; b.dataset.focusKey=key; b.title = label; b.setAttribute('aria-label',label); b.disabled = disabled; b.addEventListener('click',handler); return b;
  }
  async function load() {
    if(dragging){pendingLoad=true;return;}
    try { const next = await send({type:'navigation.get'}); if(next.revision===data?.revision)return; data=next; error('navigation-error',null); render(); }
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
    n.style.backgroundColor=`hsl(${hue} 42% 84%)`;n.style.color=`hsl(${hue} 48% 25%)`;
    paintBookmarkIcon(n,site.icon||fallbackBookmarkIcon(site.title,site.url));return n;
  }
  function siteCard(site,ordered,query='') {
    const card=node('li','site-card');card.dataset.siteId=site.id;
    const link=node('a','site-link');link.href=site.url;link.target=data.preferences.openInNewTab?'_blank':'_self';link.rel='noopener noreferrer';link.dataset.focusKey=`site:${site.id}:link`;link.title=site.title+'\n'+new URL(site.url).hostname;
    const copy=node('span','site-copy');copy.append(node('strong','',site.title),node('span','site-host',new URL(site.url).hostname.replace(/^www\./,'')));const iconWrap=node('span','site-icon-wrap');iconWrap.append(icon(site),audit.badge(site));link.append(iconWrap,copy);
    const controls=node('div','site-controls');controls.append(action(`编辑网站：${site.title}`,'⋯',()=>openSite(site),false,`site:${site.id}:edit`));
    const handle=grip(`拖动网站：${site.title}`);handle.dataset.focusKey=`site:${site.id}:drag`;handle.disabled=Boolean(query);keyboardMove(handle,'bookmark',site.id);
    card.append(link,handle,controls);return card;
  }
  function renderFolder() {
    const group=data.groups.find(g=>g.id===selected);if(!group){if($('folder-dialog').open)$('folder-dialog').close();return;}
    const restore=preserveFocus($('folder-sites')),ordered=data.bookmarks.filter(s=>s.groupId===group.id),query=$('folder-search').value.trim().toLowerCase();
    const key=JSON.stringify([data.revision,selected,query]);
    if(folderRenderKey===key)return;
    clearFolderSortables();folderRenderKey=key;
    if(renderedFolder!==group.id){$('folder-scroll').scrollTop=0;renderedFolder=group.id;}
    const sites=ordered.filter(s=>`${s.title} ${s.url}`.toLowerCase().includes(query));
    $('folder-title').textContent=group.name;$('folder-count').textContent=`${ordered.length} 个网站`;
    $('folder-sites').dataset.groupId=group.id;
    $('folder-sites').replaceChildren(...sites.map(s=>siteCard(s,ordered,query)));$('folder-empty').hidden=sites.length>0;
    $('folder-drag-hint').hidden=Boolean(query);
    $('folder-drag-hint').textContent=data.groups.length>1?'拖出窗口移到其他文件夹；停留片刻展开，可选择插入位置。':'直接拖动图标调整顺序，也可使用方向键移动。';
    if(!query)sortable($('folder-sites'),'site',group.id);restore();
  }
  function render() {
    if(!data||dragging)return;clearSortables();const restore=preserveFocus($('site-groups'));applyPreferences();
    const query=$('site-search').value.trim().toLowerCase(),visible=data.bookmarks.filter(s=>`${s.title} ${s.url}`.toLowerCase().includes(query));
    $('site-total').textContent=query?`找到 ${visible.length} 个收藏`:`${data.groups.length} 个分组 · ${data.bookmarks.length} 个收藏`;
    const container=$('site-groups');container.className=folders&&!query?'folder-grid':'all-sites';container.replaceChildren();
    for(const group of data.groups) {
      const sites=data.bookmarks.filter(s=>s.groupId===group.id);
      if(folders&&!query){
        const tile=node('div','folder-tile');tile.dataset.groupId=group.id;const button=node('button','folder-button');button.dataset.focusKey=`group:${group.id}:filter`;button.setAttribute('aria-label',`打开分组：${group.name}，${sites.length} 个网站`);
        const preview=node('span','folder-preview');for(const site of sites.slice(0,9))preview.append(icon(site,true));if(!sites.length)preview.append(node('span','folder-blank','＋'));
        button.append(preview,node('span','folder-label',group.name),node('span','folder-size',`${sites.length} 个网站`));
        button.addEventListener('click',()=>{selected=group.id;$('folder-search').value='';renderFolder();showDialog('folder-dialog','all-groups-button');});tile.append(button);const handle=grip(`拖动分组：${group.name}`);handle.dataset.focusKey=`group:${group.id}:drag`;keyboardMove(handle,'group',group.id);tile.append(handle);
        const controls=node('div','group-controls');controls.append(action(`编辑分组：${group.name}`,'⋯',()=>openGroup(group),false,`group:${group.id}:edit`));tile.append(controls);container.append(tile);
      }else{
        const matches=sites.filter(s=>visible.includes(s));if(query&&!matches.length)continue;
        const section=node('section','site-section'),heading=node('div','group-heading');heading.append(node('h2','',group.name),action(`编辑分组：${group.name}`,'⋯',()=>openGroup(group),false,`group:${group.id}:edit`));
        const list=node('ul','site-grid');list.dataset.groupId=group.id;list.append(...matches.map(s=>siteCard(s,sites,query)));section.append(heading,list);container.append(section);if(!query)sortable(list,'site',group.id);
      }
    }
    $('site-empty').hidden=data.bookmarks.length>0&&(!query||visible.length>0);
    $('site-empty-title').textContent=query?'没有找到匹配的收藏':'收藏你的日常。';$('site-empty-copy').textContent=query?'试试名称或域名，或使用右侧按钮搜索网页。':'从一个网站、一个分组开始，整理属于自己的空间。';$('site-empty-action').textContent=query?'清空搜索':'收藏第一个网站';
    $('all-groups-button').setAttribute('aria-pressed',String(!folders));$('all-groups-button').querySelector('span').textContent=folders?'全部网站':'分组视图';
    if(folders&&!query)sortable(container,'group');
    if($('folder-dialog').open||selected!=='all')renderFolder();restore();
  }
  function openSite(site = null, groupId = selected === 'all' ? 'default' : selected) {
    if (!data || busy) return;
    editingSite = site; siteRevision = data.revision;creationURL=null;creationIcon=null;
    $('site-dialog-title').textContent = site ? '编辑网站' : '收藏网站'; $('site-title').value = site?.title || ''; $('site-url').value = site?.url || '';
    $('site-group').replaceChildren(...data.groups.map(g => { const option = node('option','',g.name); option.value = g.id; return option; })); $('site-group').value = site?.groupId || groupId;
    $('edit-site-icon-button').hidden=!site;$('delete-site-button').hidden = !site; error('site-error',null); showDialog('site-dialog','add-site-button'); $('site-title').focus();
  }
  const captureDialog=$('capture-dialog'),captureFrame=$('capture-frame');
  let captureChannel=null,captureBusy=false,capturePopover=false,captureInitial=null,captureReturnKey=null;
  function closeCapture(){if(!captureBusy)captureDialog.close();}
  captureDialog.kbCanDismiss=()=>!captureBusy;
  captureDialog.addEventListener('cancel',event=>{
    if(captureBusy||capturePopover)event.preventDefault();
    if(capturePopover)captureFrame.contentWindow.postMessage({type:'kb-capture:dismiss-popover',channel:captureChannel},location.origin);
  });
  captureDialog.addEventListener('close',()=>{
    captureChannel=null;captureBusy=false;capturePopover=false;captureFrame.removeAttribute('src');$('close-capture-button').disabled=false;
    requestAnimationFrame(()=>{const target=[...document.querySelectorAll('[data-focus-key]')].find(n=>n.dataset.focusKey===captureReturnKey&&n.getClientRects().length);(target||($('folder-dialog').open?$('folder-search'):$('site-search'))).focus({preventScroll:true});});
  });
  window.addEventListener('message',event=>{
    if(!captureDialog.open||event.source!==captureFrame.contentWindow||event.origin!==location.origin||event.data?.channel!==captureChannel||!captureChannel)return;
    if(event.data.type==='kb-capture:ready')captureFrame.contentWindow.postMessage({type:'kb-capture:init',channel:captureChannel,initial:captureInitial},location.origin);
    else if(event.data.type==='kb-capture:busy'){captureBusy=event.data.value===true;$('close-capture-button').disabled=captureBusy;}
    else if(event.data.type==='kb-capture:popover')capturePopover=event.data.value===true;
    else if(event.data.type==='kb-capture:close')closeCapture();
    else if(event.data.type==='kb-capture:saved'){captureBusy=false;captureDialog.close();toast('网站已保存');void load();}
  });
  $('edit-site-icon-button').addEventListener('click',()=>{
    if(!editingSite)return;
    captureInitial={revision:siteRevision};
    for(const [field,el]of [['title','site-title'],['url','site-url'],['groupId','site-group']])if($(el).value!==editingSite[field])captureInitial[field]=$(el).value;
    captureReturnKey=`site:${editingSite.id}:edit`;captureChannel=crypto.randomUUID();captureBusy=false;capturePopover=false;
    $('site-dialog').close();
    captureFrame.src=chrome.runtime.getURL('popup.html')+'?'+new URLSearchParams({bookmark:editingSite.id,channel:captureChannel});
    // Keep the native top layer and the underlying folder in this tab.
    captureDialog.showModal();
  });
  function openGroup(group = null) {
    if (!data || busy) return;
    editingGroup = group; groupRevision = data.revision;
    $('group-dialog-title').textContent = group ? '编辑分组' : '新建分组'; $('group-name').value = group?.name || '';
    const removable = group && group.id !== 'default'; $('delete-group-button').hidden = !removable; $('group-delete-hint').hidden = !removable;
    $('group-delete-hint').textContent = `删除此分组后，其中的网站会移入「${data.groups.find(g => g.id === 'default').name}」。`;
    $('delete-group-button').textContent = `删除分组并保留网站`; error('group-error',null); showDialog('group-dialog','new-group-button'); $('group-name').focus();
  }
  $('site-dialog').kbCanDismiss=()=>!preparingSite&&!busy;
  $('site-form').addEventListener('submit',async event=>{
    event.preventDefault();if(preparingSite||busy)return;
    let url;try{url=bookmarkURL($('site-url').value);}catch(e){error('site-error',e);return;}
    preparingSite=true;const button=$('save-site-button'),controls=[...$('site-form').querySelectorAll('input,select,button')];controls.forEach(el=>el.disabled=true);
    try{
      if(!editingSite&&creationURL!==url){
        creationURL=url;creationIcon=fallbackBookmarkIcon($('site-title').value,url);
        button.textContent='正在保存网站图标…';
        try{const image=await send({type:'capture.image',source:'website',pageURL:url});creationIcon={mode:'auto',dataURL:await normalizeIcon(image.dataURL)};}catch{/* One creation attempt only; persist the text fallback. */}
      }
      if(await mutate({type:editingSite?'bookmark.update':'bookmark.add',id:editingSite?.id,title:$('site-title').value,url,groupId:$('site-group').value,...(!editingSite?{icon:creationIcon}:{})},'site-error',siteRevision)){$('site-dialog').close();toast('网站已保存');}
    }finally{preparingSite=false;controls.forEach(el=>el.disabled=false);button.textContent='保存网站';}
  });
  $('group-form').addEventListener('submit',async event => { event.preventDefault(); if (await mutate({type:editingGroup ? 'group.update' : 'group.add',id:editingGroup?.id,name:$('group-name').value},'group-error',groupRevision)) { $('group-dialog').close(); toast('分组已保存'); } });
  $('delete-site-button').addEventListener('click',async () => { if (await mutate({type:'bookmark.remove',id:editingSite.id},'site-error',siteRevision)) { $('site-dialog').close(); toast('收藏已删除'); } });
  $('delete-group-button').addEventListener('click',async () => { if (await mutate({type:'group.remove',id:editingGroup.id},'group-error',groupRevision)) { $('group-dialog').close(); toast('分组已删除，网站已保留到默认分组'); } });
  $('new-group-button').addEventListener('click',() => openGroup()); $('add-site-button').addEventListener('click',() => openSite());
  $('all-groups-button').addEventListener('click',()=>{folders=!folders;$('site-search').value='';render();});
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
  ['site-dialog','group-dialog'].forEach(id => $(id).addEventListener('cancel',event => { if (busy||(id==='site-dialog'&&preparingSite)) event.preventDefault(); }));
  chrome.storage.onChanged.addListener((changes,area) => { if (area === 'local' && changes.navigation) void load(); });
  bindValidation('site-form','site-error'); bindValidation('group-form','group-error');
  await load();
}
