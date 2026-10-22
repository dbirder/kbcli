import {bookmarkURL} from './navigation.mjs';
import {imageURL,imagePermissionOrigin,paintBookmarkIcon,fallbackBookmarkIcon} from './bookmark-icon.mjs';
import {normalizeIcon,readPageMetadata} from './capture-image.mjs';
const $=id=>document.getElementById(id);
try{const value=(await chrome.storage.local.get('workbenchInterface')).workbenchInterface;document.documentElement.dataset.colorScheme=value?.colorScheme==='light'?'light':'dark';}catch{}
const embedded=window.parent!==window,channel=new URL(location.href).searchParams.get('channel');
const tellHost=(type,details={})=>{if(embedded&&channel)window.parent.postMessage({type,channel,...details},location.origin);};
if(embedded){document.body.classList.add('embedded');$('open-workbench').hidden=true;}
async function send(message){const response=await chrome.runtime.sendMessage(message);if(!response?.ok)throw Object.assign(new Error(response?.error?.message||'操作未完成，请重试'),response?.error);return response.data;}
let tab,context,navigation,revision,id=null,operationId=crypto.randomUUID(),sequence=0,ready=false,saving=false,saved=false,mode='auto',icon=null,metadata=null,imageEpoch=0,imageLoading=false,imageTask=null,autoAttemptURL=null;
let titleVersion=0,urlVersion=0,groupVersion=0,dirtyTitle=false,dirtyGroup=false,dirtyIcon=false,restoredDraft=false;
const validURL=value=>{try{return bookmarkURL(value);}catch{return null;}};
function error(e){$('form-error').textContent=e.message||String(e);$('form-error').hidden=false;const field={title:'capture-title',url:'capture-url',groupId:'group-trigger'}[e.field];if(field)$(field).setAttribute('aria-invalid','true');}
function notice(text){$('notice').textContent=text;$('notice').hidden=!text;}
function currentDraft(){return {operationId,sequence:++sequence,id,revision,title:$('capture-title').value,url:$('capture-url').value,groupId:$('group-trigger').dataset.value,mode,icon,imageURL:$('image-url').value,text:$('icon-text').value,color:$('icon-color').value};}
function changed(){
 if(saved){saved=false;operationId=crypto.randomUUID();$('success').hidden=true;}
 $('save-capture').textContent=id?'保存修改':'保存收藏';$('form-error').hidden=true;
}
function persist(){
 if(!ready||saving)return;
 const draft=currentDraft();$('draft-status').textContent='正在保留草稿…';
 void(async()=>{try{await send({type:'capture.draft',context,draft});if(sequence===draft.sequence)$('draft-status').textContent='草稿已保留，可稍后继续';}catch{$('draft-status').textContent='草稿未保留，请保持弹窗打开';}})();
}
function preview(){
 const title=$('capture-title').value.trim()||'收藏网站',url=validURL($('capture-url').value);
 $('preview-title').textContent=title;$('preview-host').textContent=url?new URL(url).hostname:'填写网址即可收藏';
 const box=$('preview-icon');box.replaceChildren();box.textContent=title.slice(0,1).toUpperCase();box.style.backgroundColor='#dbe9e0';box.style.color='#2c756a';paintBookmarkIcon(box,icon);
}
function setGroup(groupId){
 const group=navigation.groups.find(g=>g.id===groupId)||navigation.groups[0];$('group-trigger').dataset.value=group.id;
 $('group-trigger').replaceChildren(document.createTextNode(group.name));const caret=document.createElement('span');caret.textContent='⌄';caret.setAttribute('aria-hidden','true');$('group-trigger').append(caret);
}
function renderGroups(){
 const query=$('group-search').value.trim().toLowerCase(),list=$('group-options');list.replaceChildren();
 for(const group of navigation.groups.filter(g=>g.name.toLowerCase().includes(query))){
  const b=document.createElement('button');b.type='button';b.className='group-option';b.textContent=group.name;b.setAttribute('role','option');b.setAttribute('aria-selected',String(group.id===$('group-trigger').dataset.value));
  b.addEventListener('click',()=>{setGroup(group.id);groupVersion++;dirtyGroup=true;changed();persist();$('group-picker').hidePopover();$('group-trigger').focus();});list.append(b);
 }
 if(!list.childElementCount){const p=document.createElement('p');p.className='hint';p.textContent='没有匹配分组，可关闭后新建。';list.append(p);}
}
function panels(){for(const name of ['auto','image','text'])$(name+'-panel').hidden=mode!==name;document.querySelector(`input[name="icon-mode"][value="${mode}"]`).checked=true;$('icon-text').setCustomValidity('');}
function textIcon(){$('image-status').textContent='使用文字图标，不会发起图片请求。';const text=$('icon-text').value.trim();$('icon-text').setCustomValidity(Array.from(text).length>2?'图标文字最多两个字':'');if(text&&Array.from(text).length<=2)icon={mode:'text',text,color:$('icon-color').value};else if(!text)icon=null;preview();}
function matchExisting({fill=true}={}){
 const url=validURL($('capture-url').value),existing=navigation.bookmarks.find(s=>s.url===url);
 if(!existing)return false;
 id=existing.id;revision=navigation.revision;
 if(fill&&!dirtyTitle)$('capture-title').value=existing.title;
 if(fill&&!dirtyGroup)setGroup(existing.groupId);
 if(fill&&!dirtyIcon){icon=existing.icon||null;mode=icon?.mode||'auto';$('image-url').value=icon?.sourceURL||'';if(icon?.mode==='text'){$('icon-text').value=icon.text;$('icon-color').value=icon.color;}panels();}
 $('heading').textContent='编辑收藏';$('save-capture').textContent='保存修改';notice('已收藏到「'+(navigation.groups.find(g=>g.id===existing.groupId)?.name||'常用')+'」，保存将更新这条收藏。');preview();return true;
}
function loadIcon(request,{force=false,selectedMode=mode}={}){
 if(mode!==selectedMode)return Promise.resolve();
 imageTask=(async()=>{
 const epoch=++imageEpoch;imageLoading=true;$('image-status').textContent='正在加载图标…';
 try{
  const result=await send({type:'capture.image',...request,refresh:force});const dataURL=await normalizeIcon(result.dataURL);
  if(epoch!==imageEpoch||mode!==selectedMode)return;
  icon={mode:selectedMode,dataURL,...(request.url?{sourceURL:request.url}:{})};preview();$('image-status').textContent='图片已加载；保存后使用本地图标。';persist();
 }catch(e){if(epoch===imageEpoch)$('image-status').textContent=e.message||'图片加载失败，当前图标已保留。';}
 finally{if(epoch===imageEpoch)imageLoading=false;}
 })();return imageTask;
}
async function automatic(force=false){
 const url=validURL($('capture-url').value);if(!url)return;
 if(!force&&autoAttemptURL===url)return;autoAttemptURL=url;
 if(tab?.id&&url===validURL(tab.url))await loadIcon({source:'tab',tabId:tab.id,pageURL:url},{force,selectedMode:'auto'});
 else await loadIcon({source:'website',pageURL:url},{force,selectedMode:'auto'});
}
async function pageMetadata(){
 if(!tab?.id)return null;
 const current=await chrome.tabs.get(tab.id);tab=current;
 if(!validURL(current.url))return null;
 try{const results=await chrome.scripting.executeScript({target:{tabId:current.id},func:readPageMetadata});return results[0]?.result||null;}catch{return {title:current.title||'',url:current.url,iconURL:null};}
}
function busy(value){saving=value;for(const el of $('capture-form').querySelectorAll('input,button'))el.disabled=value;$('group-trigger').disabled=value;if(ready)tellHost('kb-capture:busy',{value});}
async function init(){
 try{
  [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  const selected=new URL(location.href).searchParams.get('bookmark'),page=validURL(tab?.url);
  context=selected?'edit:'+selected:String(tab?.id??'manual')+'|'+(page||'manual');
  const loaded=await send({type:'capture.load',context});navigation=loaded.navigation;revision=navigation.revision;
  const d=loaded.draft,existing=selected?navigation.bookmarks.find(s=>s.id===selected):null;restoredDraft=Boolean(d);
  $('capture-title').value=existing?.title||(page?(tab.title||new URL(page).hostname).slice(0,100):'');$('capture-url').value=existing?.url||page||'';setGroup(existing?.groupId||loaded.lastGroup);
  if(existing){id=existing.id;icon=existing.icon||null;}
  if(d){operationId=d.operationId;sequence=d.sequence;id=d.id;revision=d.revision;mode=d.mode;icon=d.icon;for(const [el,key]of [['capture-title','title'],['capture-url','url'],['image-url','imageURL'],['icon-text','text'],['icon-color','color']])if(typeof d[key]==='string')$(el).value=d[key];setGroup(d.groupId);dirtyTitle=dirtyGroup=dirtyIcon=true;notice('已恢复上次未保存的内容。');}
  else {matchExisting();mode=icon?.mode||'auto';if(icon?.mode==='text'){$('icon-text').value=icon.text;$('icon-color').value=icon.color;}$('image-url').value=icon?.sourceURL||'';}
  if(id&&!navigation.bookmarks.some(s=>s.id===id)){id=null;revision=navigation.revision;notice('原收藏已删除，草稿已保留；保存将新增一条收藏。');}
  panels();preview();if(id)$('image-status').textContent='使用已保存的本机图标；需要更换请手动获取或加载。';ready=true;busy(false);$('save-capture').textContent=id?'保存修改':'保存收藏';$('draft-status').textContent=d?'草稿已恢复':'关闭弹窗也会保留草稿';
  if(!page&&!selected)notice('此页面无法直接读取，请手动填写网站名称和网址。');
  persist();
  tellHost('kb-capture:ready');
  if(!d&&!id&&!icon&&mode==='auto')void automatic();
  // Metadata is optional and may finish after typing; it never replaces edits.
  const titleAt=titleVersion,urlAt=urlVersion;
  void(async()=>{try{metadata=await pageMetadata();if(metadata&&!d&&!id){if(titleAt===titleVersion&&!dirtyTitle)$('capture-title').value=metadata.title||$('capture-title').value;if(urlAt===urlVersion)$('capture-url').value=metadata.url||$('capture-url').value;preview();persist();}}catch{}})();
 }catch(e){error(e);$('draft-status').textContent='未能读取收藏，请重新打开弹窗';}
}
$('capture-title').addEventListener('input',()=>{titleVersion++;dirtyTitle=true;changed();preview();persist();});
$('capture-url').addEventListener('input',()=>{urlVersion++;imageEpoch++;imageLoading=false;if(mode==='auto'){if(!id)icon=null;$('image-status').textContent=id?'网址已修改，图标保持原样；需要更换请手动获取。':'创建时获取并保存图标。';}changed();preview();persist();});
$('capture-url').addEventListener('blur',()=>{if(ready&&!id&&matchExisting())persist();});
for(const radio of document.querySelectorAll('input[name="icon-mode"]'))radio.addEventListener('change',()=>{mode=radio.value;imageEpoch++;imageLoading=false;dirtyIcon=true;changed();panels();if(mode==='auto'){preview();void automatic(true);}else if(mode==='text')textIcon();else $('image-status').textContent='点击加载，成功预览后才替换当前图标。';persist();});
$('image-url').addEventListener('input',()=>{imageEpoch++;changed();$('image-status').textContent='点击加载，成功预览后才替换当前图标。';persist();});
for(const el of ['icon-text','icon-color'])$(el).addEventListener('input',()=>{dirtyIcon=true;changed();textIcon();persist();});
$('reload-icon').addEventListener('click',async()=>{
 if(metadata?.iconURL&&validURL($('capture-url').value)===validURL(tab?.url)){try{const url=imageURL(metadata.iconURL);const granted=await chrome.permissions.request({origins:[imagePermissionOrigin(url)]});if(!granted){$('image-status').textContent='未授权，当前图标已保留。';return;}await loadIcon({url},{force:true,selectedMode:'auto'});}catch(e){$('image-status').textContent=e.message;}}
 else await automatic(true);
});
$('load-image').addEventListener('click',async()=>{
 try{const url=imageURL($('image-url').value.trim());const granted=await chrome.permissions.request({origins:[imagePermissionOrigin(url)]});if(!granted){$('image-status').textContent='未授权，当前图标已保留；仍可保存网站。';return;}if(mode!=='image'||imageURL($('image-url').value.trim())!==url)return;dirtyIcon=true;changed();await loadIcon({url},{force:true,selectedMode:'image'});}catch(e){$('image-status').textContent=e.message;}
});
$('reload-info').addEventListener('click',async()=>{
 const titleAt=titleVersion,urlAt=urlVersion;
 try{const next=await pageMetadata();if(!next){notice('此页面无法读取，请手动填写。');return;}metadata=next;changed();if(titleAt===titleVersion){$('capture-title').value=next.title;dirtyTitle=false;}if(urlAt===urlVersion){$('capture-url').value=next.url;imageEpoch++;if(!id&&mode==='auto')icon=null;}if(!id)matchExisting();preview();persist();if(!id&&mode==='auto')void automatic();}catch(e){error(e);}
});
$('group-picker').addEventListener('beforetoggle',event=>{
 tellHost('kb-capture:popover',{value:event.newState==='open'});
 $('group-trigger').setAttribute('aria-expanded',String(event.newState==='open'));
 if(event.newState==='open'){$('group-search').value='';renderGroups();requestAnimationFrame(()=>{const r=$('group-trigger').getBoundingClientRect(),picker=$('group-picker'),below=innerHeight-r.bottom-8,up=below<140&&r.top>below;picker.style.width=r.width+'px';picker.style.maxHeight=Math.max(100,Math.min(230,up?r.top-12:below))+'px';picker.style.left=r.left+'px';picker.style.top=(up?Math.max(8,r.top-picker.getBoundingClientRect().height-6):r.bottom+6)+'px';$('group-search').focus();});}
});
$('group-search').addEventListener('input',renderGroups);
$('group-picker').addEventListener('keydown',event=>{const options=[...$('group-options').querySelectorAll('button')];if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const index=options.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?options.length-1:Math.max(0,Math.min(options.length-1,index+(event.key==='ArrowDown'?1:-1)));options[next]?.focus();}else if(event.key==='Enter'&&document.activeElement===$('group-search')){event.preventDefault();options[0]?.click();}});
$('new-group').addEventListener('click',()=>{$('new-group-fields').hidden=!$('new-group-fields').hidden;if(!$('new-group-fields').hidden)$('new-group-name').focus();});
$('create-group').addEventListener('click',async()=>{if(saving)return;const name=$('new-group-name').value.trim();if(!name){error(new Error('请输入分组名称'));return;}busy(true);try{navigation=await send({type:'group.add',name,revision});revision=navigation.revision;setGroup(navigation.groups.find(g=>g.name===name).id);dirtyGroup=true;$('new-group-fields').hidden=true;changed();}catch(e){if(e.code==='NAVIGATION_CHANGED'){navigation=await send({type:'navigation.get'});revision=navigation.revision;}error(e);}finally{busy(false);persist();}});
$('new-group-name').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('create-group').click();}});
$('capture-form').addEventListener('submit',async event=>{
 event.preventDefault();if(!ready||saving||saved)return;
 let url;try{url=bookmarkURL($('capture-url').value);}catch(e){error(e);$('capture-url').focus();return;}
 if(mode==='text'&&!$('icon-text').value.trim()){$('icon-text').setCustomValidity('请输入 1～2 个字');$('icon-text').reportValidity();return;}
 busy(true);$('form-error').hidden=true;$('save-capture').textContent='正在保存…';
 try{
  if(imageLoading&&imageTask)await imageTask;
  if(!id&&mode==='auto'&&!icon)await automatic();
  imageEpoch++;if(!icon)icon=fallbackBookmarkIcon($('capture-title').value,url);
  const result=await send({type:'capture.save',context,operationId,revision,bookmark:{id,title:$('capture-title').value.trim(),url,groupId:$('group-trigger').dataset.value,icon}});
  navigation=result.navigation;revision=navigation.revision;id=result.siteId;saved=true;operationId=crypto.randomUUID();$('success-title').textContent='已保存到「'+navigation.groups.find(g=>g.id===$('group-trigger').dataset.value).name+'」';$('success').hidden=false;$('draft-status').textContent='收藏已保存';
  if(embedded)tellHost('kb-capture:saved',{siteId:id});else window.close();
 }catch(e){if(['NAVIGATION_CHANGED','BOOKMARK_EXISTS'].includes(e.code)){navigation=await send({type:'navigation.get'});revision=navigation.revision;if(!navigation.groups.some(g=>g.id===$('group-trigger').dataset.value))setGroup('default');}error(e);}
 finally{busy(false);$('save-capture').textContent=saved?'已保存':id?'保存修改':'保存收藏';if(!saved)persist();}
});
for(const el of $('capture-form').querySelectorAll('input')){el.addEventListener('blur',()=>el.setAttribute('aria-invalid',String(el.matches(':user-invalid'))));el.addEventListener('input',()=>el.removeAttribute('aria-invalid'));}
$('capture-form').addEventListener('invalid',event=>{event.target.setAttribute('aria-invalid','true');error(new Error(event.target.validationMessage));},true);
async function openWorkbench(){try{await chrome.tabs.create({url:chrome.runtime.getURL('newtab.html')});window.close();}catch(e){error(e);}}
$('open-workbench').addEventListener('click',openWorkbench);$('view-saved').addEventListener('click',openWorkbench);
window.addEventListener('message',event=>{
 if(!embedded||event.source!==window.parent||event.origin!==location.origin||event.data?.channel!==channel||!ready)return;
 if(event.data.type==='kb-capture:dismiss-popover'){if($('group-picker').matches(':popover-open')){$('group-picker').hidePopover();$('group-trigger').focus();}return;}
 if(event.data.type!=='kb-capture:init')return;
 const v=event.data.initial||{};
 if(typeof v.title==='string'&&titleVersion===0){$('capture-title').value=v.title;dirtyTitle=true;}
 if(typeof v.url==='string'&&urlVersion===0){$('capture-url').value=v.url;imageEpoch++;if(!id&&mode==='auto')icon=null;}
 if(typeof v.groupId==='string'&&groupVersion===0)setGroup(v.groupId);
 if(!restoredDraft&&typeof v.revision==='string')revision=v.revision;
 preview();persist();
});
document.addEventListener('keydown',event=>{if(embedded&&event.key==='Escape'&&!document.querySelector(':popover-open')){event.preventDefault();event.stopPropagation();if(!saving)tellHost('kb-capture:close');}},true);
busy(true);void init();
