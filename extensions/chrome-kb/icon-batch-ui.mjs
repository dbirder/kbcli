import {ICON_BATCH_KEY,ICON_BATCH_LABELS} from './icon-batch.mjs';
import {imagePermissionOrigin} from './bookmark-icon.mjs';
import {showDialog,showFormError} from './ui.mjs';
const $=id=>document.getElementById(id),node=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
export async function initIconBatch({send,toast}){
 let nav=null,job=null,busy=false,generation=0;
 function render(){
  const rows=job?.rows||[],running=job?.state==='running',done=rows.filter(r=>!['pending','fetching'].includes(r.status)).length;
  $('icon-batch-start').disabled=busy||running||!nav?.bookmarks.length;$('icon-batch-authorize').hidden=!rows.some(r=>r.status==='failed'&&r.needsPermission);$('icon-batch-authorize').disabled=busy||running;$('icon-batch-stop').hidden=!running;$('icon-batch-stop').disabled=busy;$('icon-batch-custom').disabled=busy||running;
  $('icon-batch-progress').max=Math.max(rows.length,1);$('icon-batch-progress').value=done;
  $('icon-batch-status').textContent=job?`${running?'正在获取':job.state==='stopped'?'已停止':'获取完成'} · ${done}/${rows.length} · 成功 ${rows.filter(r=>r.status==='updated').length} · 失败 ${rows.filter(r=>r.status==='failed').length} · 保留/跳过 ${rows.filter(r=>['protected','skipped','cancelled'].includes(r.status)).length}`:`当前 ${nav?.bookmarks.length||0} 个收藏，点击后开始获取`;
  if(!$('icon-batch-dialog').open)return;
  const filter=$('icon-batch-filter').value,shown=rows.filter(r=>filter==='all'||['failed','skipped','cancelled'].includes(r.status));
  $('icon-batch-list').replaceChildren(...shown.map(r=>{
   const row=node('li','audit-row');row.dataset.iconBatchId=r.id;
   const content=node('div','audit-row-content'),heading=node('div','audit-row-heading'),state=node('span','audit-state',ICON_BATCH_LABELS[r.status]);state.dataset.state=r.status==='failed'?'httpError':['skipped','protected'].includes(r.status)?'restricted':r.status;heading.append(node('strong','',r.title),state);
   content.append(heading,node('p','audit-meta',new URL(r.url).hostname),node('p','audit-detail',r.detail||(r.status==='protected'?'未请求该图标；勾选“替换自定义图标”后可再次获取':ICON_BATCH_LABELS[r.status])));row.append(content);return row;
  }));
  $('icon-batch-empty').hidden=shown.length>0;$('icon-batch-empty').textContent=job?'当前筛选下没有结果。':'尚未开始，原有图标保持不变。';
 }
 async function load(){const seq=++generation;try{const [state,n]=await Promise.all([send({type:'icons.get'}),send({type:'navigation.get'})]);if(seq!==generation)return;job=state.job;nav=n;render();}catch(e){showFormError('icon-batch-error',e);}}
 async function open(){showFormError('icon-batch-error',null);showDialog('icon-batch-dialog','icon-batch-button');await load();}
 $('icon-batch-button').addEventListener('click',open);$('settings-icon-batch-button').addEventListener('click',open);
 $('icon-batch-filter').addEventListener('change',render);
 $('icon-batch-start').addEventListener('click',async()=>{
  if(busy||job?.state==='running'||!nav)return;
  const revision=nav.revision,replaceCustom=$('icon-batch-custom').checked;
  busy=true;render();showFormError('icon-batch-error',null);
  try{await send({type:'icons.start',revision,replaceCustom});toast('已开始批量获取图标，关闭窗口后继续');}
  catch(e){showFormError('icon-batch-error',e);}finally{busy=false;await load();}
 });
 $('icon-batch-authorize').addEventListener('click',async()=>{
  if(busy||job?.state==='running'||!nav)return;
  const sites=job?.rows.filter(r=>r.status==='failed'&&r.needsPermission&&nav.bookmarks.some(s=>s.id===r.id&&s.url===r.url))||[];if(!sites.length)return;
  const revision=nav.revision,replaceCustom=$('icon-batch-custom').checked;
  const grant=chrome.permissions.request({origins:[...new Set(sites.map(s=>imagePermissionOrigin(s.url)))]});busy=true;render();showFormError('icon-batch-error',null);
  try{if(!await grant)throw new Error('未授权网站，原图标保持不变');await send({type:'icons.start',revision,replaceCustom});toast('已授权失败站点，重新尝试获取图标');}catch(e){showFormError('icon-batch-error',e);}finally{busy=false;await load();}
 });
 $('icon-batch-stop').addEventListener('click',async()=>{if(busy||!job)return;busy=true;render();try{await send({type:'icons.stop',runId:job.id});toast('已停止，成功保存的图标保留');}catch(e){showFormError('icon-batch-error',e);}finally{busy=false;await load();}});
 $('icon-batch-dialog').kbCanDismiss=()=>!busy;$('icon-batch-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes[ICON_BATCH_KEY]||changes.navigation))void load();});await load();
}
