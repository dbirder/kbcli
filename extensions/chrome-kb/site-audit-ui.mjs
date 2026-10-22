import {AUDIT_KEY,AUDIT_LABELS,auditIssue,auditDeletable,auditOrigin,knownAuditRedirect} from './site-audit.mjs';
import {showDialog,showFormError,preserveFocus} from './ui.mjs';
const $=id=>document.getElementById(id);
const node=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
const time=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'未完成';
export async function initSiteAudit({send,toast}){
 let job=null,nav=null,canUndo=false,busy=false,selected=new Set(),review=null,loadNumber=0;
 const current=row=>nav?.bookmarks.find(s=>s.id===row.id);
 const fresh=row=>current(row)?.url===row.url;
 const selectable=row=>job?.state!=='running'&&auditDeletable(row)&&fresh(row);
 function badge(site){
  const row=job?.rows.find(r=>r.id===site.id),b=node('span','audit-site-status');
  if(!row)return b;
  const stale=row.url!==site.url,state=stale?'stale':row.status,label=stale?'待重查':AUDIT_LABELS[state]||'待重查';b.dataset.state=state;
  b.setAttribute('role','img');b.setAttribute('aria-label',label);
  b.title=stale?'网址已修改，请手动重新检查':`${label} · ${row.detail||''}\n检查时间：${time(row.checkedAt)}`;
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
  // Different silhouettes retain meaning without depending on color alone.
  const paths={ok:['M5 12l4 4L19 6'],restricted:['M7 11V7a5 5 0 0 1 10 0v4','M6 11h12v10H6z'],networkError:['M7 11V7a5 5 0 0 1 10 0v4','M6 11h12v10H6z'],httpError:['M12 5v9','M12 18v1'],timeout:['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18','M12 7v6l4 2'],redirect:['M4 12h16','M14 6l6 6-6 6'],stale:['M20 10a8 8 0 1 0-1 7','M20 4v6h-6'],pending:['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18','M12 8v5'],checking:['M20 10a8 8 0 1 0-1 7','M20 4v6h-6'],cancelled:['M8 6v12','M16 6v12'],skipped:['M6 12h12']};
  for(const d of paths[state]||paths.stale){const path=document.createElementNS(ns,'path');path.setAttribute('d',d);svg.append(path);}b.append(svg);
  return b;
 }
 function paintBadges(){
  document.querySelectorAll('.site-card[data-site-id]').forEach(card=>{
   const site=nav?.bookmarks.find(s=>s.id===card.dataset.siteId);if(!site)return;
   const old=card.querySelector('.audit-site-status'),next=badge(site);if(old)old.replaceWith(next);else (card.querySelector('.site-icon-wrap')||card).append(next);
  });
 }
 function selection(){
  $('audit-selection').textContent=`已选择 ${selected.size} 个网站`;
  $('audit-review-delete').disabled=busy||!selected.size||job?.state==='running';
 }
 function render(){
  const running=job?.state==='running',rows=job?.rows||[],done=rows.filter(r=>!['pending','checking'].includes(r.status)).length,issues=rows.filter(r=>auditIssue(r)&&fresh(r));
  for(const id of selected)if(!rows.some(r=>r.id===id&&selectable(r)))selected.delete(id);
  $('audit-start').textContent=job?'重新检查全部收藏':'开始检查全部收藏';$('audit-start').disabled=busy||running||!nav?.bookmarks.length;
  $('audit-stop').hidden=!running;$('audit-stop').disabled=busy;$('audit-undo').hidden=!canUndo;$('audit-undo').disabled=busy||running;
  $('audit-progress').max=Math.max(rows.length,1);$('audit-progress').value=done;
  $('audit-progress-text').textContent=job?`${running?'正在检查':job.state==='stopped'?'已停止':'检查完成'} · ${done}/${rows.length} · ${issues.filter(auditDeletable).length} 个 HTTP 异常 / ${issues.filter(r=>!auditDeletable(r)).length} 个待复核 · ${time(job.finishedAt||job.startedAt)}`:`尚未检查 · 当前 ${nav?.bookmarks.length||0} 个收藏`;
  $('audit-counts').textContent=`可访问 ${rows.filter(r=>r.status==='ok'&&fresh(r)).length} · HTTP 异常 ${issues.filter(auditDeletable).length} · 待复核 ${issues.filter(r=>!auditDeletable(r)).length} · 未检查/已变更 ${rows.filter(r=>['skipped','cancelled'].includes(r.status)||!fresh(r)).length}`;
  if($('audit-dialog').open){
   const restore=preserveFocus($('audit-list')),shown=rows.filter(r=>current(r)&&($('audit-filter').value==='all'||auditIssue(r)||['skipped','cancelled'].includes(r.status)||!fresh(r)));
   $('audit-list').replaceChildren(...shown.map(row=>{
    const site=current(row),li=node('li','audit-row');li.dataset.auditId=row.id;
    const label=node('label','audit-check'),check=document.createElement('input');check.type='checkbox';check.checked=selected.has(row.id);check.disabled=busy||!selectable(row);if(auditIssue(row)&&!auditDeletable(row))check.title='待复核，不作为失效依据，不参与批量删除';check.setAttribute('aria-label',`选择删除：${site.title}`);check.dataset.focusKey='audit:'+row.id;
    check.addEventListener('change',()=>{check.checked?selected.add(row.id):selected.delete(row.id);selection();});label.append(check);
    const content=node('div','audit-row-content'),heading=node('div','audit-row-heading'),link=node('a','',site.title);link.href=site.url;link.target='_blank';link.rel='noopener noreferrer';
    const state=node('span','audit-state',fresh(row)?AUDIT_LABELS[row.status]:'待重查');state.dataset.state=fresh(row)?row.status:'stale';heading.append(link,state);
    const group=nav.groups.find(g=>g.id===site.groupId)?.name||row.group;
    content.append(heading,node('p','audit-meta',`${group} · ${new URL(site.url).hostname} · ${row.code?'HTTP '+row.code+' · ':''}${time(row.checkedAt)}`),node('p','audit-detail',fresh(row)?row.detail||'等待检查入口响应':'网址已修改，旧结果不再用于删除，请重新检查'));
    if(row.scope?.startsWith('仅'))content.append(node('p','audit-meta',row.scope));
    if(auditIssue(row)&&!auditDeletable(row))content.append(node('p','audit-meta','待复核项目不参与批量删除，请打开网站确认。'));
    const target=(row.permissionTarget===knownAuditRedirect(row.url)?row.permissionTarget:null)||(!row.code&&!Object.hasOwn(row,'permissionTarget')&&['restricted','networkError','timeout'].includes(row.status)?knownAuditRedirect(row.url):null);
    if(target&&fresh(row)){const retry=node('button','secondary audit-retry',`授权 ${new URL(target).hostname} 后重试`);retry.type='button';retry.disabled=busy||running;retry.addEventListener('click',()=>{if(busy||running)return;const runId=job.id,id=row.id,grant=chrome.permissions.request({origins:[auditOrigin(target)]});void action(async()=>{if(!await grant)throw new Error('未授权跳转目标，原结果保留');await send({type:'audit.retry',runId,id});toast('已授权跳转目标，正在重新检查该收藏');});});content.append(retry);}
    if(row.finalURL&&row.status==='redirect')content.append(node('p','audit-meta','最终地址：'+row.finalURL));
    li.append(label,content);return li;
   }));restore();
   $('audit-empty').hidden=shown.length>0;$('audit-empty').textContent=running?'正在检查，请稍候；可切换“全部结果”查看进度。':job?'当前筛选下没有结果。':'点击开始检查，查看收藏状态。';
  }
  selection();paintBadges();
 }
 async function load(){
  const version=++loadNumber;
  try{const [state,currentNav]=await Promise.all([send({type:'audit.get'}),send({type:'navigation.get'})]);if(version!==loadNumber)return;job=state.job;canUndo=state.canUndo;nav=currentNav;render();}
  catch(e){showFormError('audit-error',e);}
 }
 async function action(fn){if(busy)return;busy=true;render();showFormError('audit-error',null);try{await fn();}catch(e){showFormError('audit-error',e);}finally{busy=false;await load();}}
 $('audit-sites-button').addEventListener('click',async()=>{selected.clear();showFormError('audit-error',null);showDialog('audit-dialog','audit-sites-button');await load();});
 $('audit-start').addEventListener('click',async()=>{
  if(busy||job?.state==='running'||!nav)return;
  // Request synchronously within this click's user activation, before any await.
  const expected=nav.revision,origins=[...new Set(nav.bookmarks.map(s=>auditOrigin(s.url)))];
  const grant=chrome.permissions.request({origins});
  await action(async()=>{if(!await grant)throw new Error('未获得访问权限，未开始检查；收藏保持原样');await send({type:'audit.start',revision:expected});selected.clear();});
 });
 $('audit-stop').addEventListener('click',()=>action(async()=>{await send({type:'audit.stop',runId:job.id});toast('检查已停止，已完成的结果保留');}));
 $('audit-filter').addEventListener('change',render);
 $('audit-review-delete').addEventListener('click',()=>{
  const rows=job?.rows.filter(r=>selected.has(r.id)&&selectable(r))||[];if(!rows.length)return;
  review={runId:job.id,revision:nav.revision,ids:rows.map(r=>r.id)};
  $('audit-delete-list').replaceChildren(...rows.map(r=>node('li','',`${current(r).title}（${new URL(r.url).hostname}）`)));
  $('audit-confirm-delete').textContent=`确认删除 ${rows.length} 个收藏`;showFormError('audit-delete-error',null);showDialog('audit-delete-dialog','audit-review-delete');
 });
 $('audit-confirm-delete').addEventListener('click',async()=>{
  if(busy||!review)return;busy=true;$('audit-confirm-delete').disabled=true;
  try{const result=await send({type:'audit.delete',...review});selected.clear();$('audit-delete-dialog').close();toast(`已删除 ${result.deleted} 个收藏，可撤销本次删除`);}
  catch(e){showFormError('audit-delete-error',e);}
  finally{busy=false;$('audit-confirm-delete').disabled=false;await load();}
 });
 $('audit-undo').addEventListener('click',()=>action(async()=>{const r=await send({type:'audit.undo'});toast(`已恢复 ${r.restored} 个收藏`);}));
 for(const id of ['audit-dialog','audit-delete-dialog']){$(id).kbCanDismiss=()=>!busy;$(id).addEventListener('cancel',event=>{if(busy)event.preventDefault();});}
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes[AUDIT_KEY]||changes.navigation||changes.siteAuditUndo))void load();});
 await load();return {badge};
}
