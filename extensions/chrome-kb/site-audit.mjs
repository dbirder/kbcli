import {ApiError} from './api.mjs';
import {validateNavigation} from './navigation.mjs';
export const AUDIT_KEY='siteAudit', AUDIT_TIMEOUT=12000, AUDIT_LEASE=30000;
export const AUDIT_LABELS={pending:'待检查',checking:'检查中',ok:'可访问',redirect:'跳转 · 待复核',restricted:'请求受限 · 待复核',httpError:'HTTP 异常',networkError:'请求受限 · 待复核',timeout:'超时 · 待复核',skipped:'未检查',cancelled:'已停止'};
export const auditIssue=row=>['redirect','restricted','httpError','networkError','timeout'].includes(row?.status);
export const auditDeletable=row=>row?.status==='httpError';
// User-reported redirect hints. These never rewrite bookmarks or silently grant
// access; a failed request may offer an explicit permission-and-retry action.
export function knownAuditRedirect(value){
 try{
  const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return null;
  const same=source=>'Origin' in globalThis?Origin.from(u).isSameOrigin(Origin.from(source)):u.origin===new URL(source).origin;
  if(same('https://labs.google')&&/^\/fx\/(?:[^/]+\/)?tools\/flow(?:\/|$)/.test(u.pathname))return 'https://flow.google.com/';
  return Object.entries({'https://console.cloud.google.com':'https://accounts.google.com/','https://codecv.top':'https://www.codecvcv.com/','https://www.landiannews.com':'https://www.landian.news/','https://roxijet.cloud':'https://www.roxi123.us/'}).find(([source])=>same(source))?.[1]||null;
 }catch{return null;}
}
export function auditOrigin(value){const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('无效网址');return `${u.protocol}//${u.hostname}/*`;}
export function auditRequestURL(value){
 const u=new URL(value);u.hash='';
 // Temporary session URLs must not be replayed or forwarded during an audit.
 const privateQuery=[...u.searchParams.keys()].some(k=>/token|ticket|secret|session|exportkey|signature|scenenote|^key$|^uin$/i.test(k));
 return {url:privateQuery?u.origin+'/':u.href,scope:privateQuery?'仅检查站点入口（原链接含临时会话参数）':'收藏入口'};
}
const safeURL=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.origin+u.pathname:'';}catch{return '';}};
async function excerpt(response){
 if(!/html|text/i.test(response.headers.get('content-type')||'')){try{await response.body?.cancel();}catch{}return '';}
 const reader=response.body?.getReader();if(!reader)return '';
 const decoder=new TextDecoder();let output='',bytes=0;
 try{while(bytes<65536){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;output+=decoder.decode(value.subarray(0,Math.max(0,65536-(bytes-value.byteLength))),{stream:true});}}finally{try{await reader.cancel();}catch{}}
 return output;
}
export async function probeSite(url,{fetcher=fetch,timeout=AUDIT_TIMEOUT,permissions}={}){
 const target=auditRequestURL(url),signal=AbortSignal.timeout(timeout);
 try{
  const response=await fetcher(target.url,{method:'GET',redirect:'follow',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal});
  const body=await excerpt(response),code=response.status,finalURL=safeURL(response.url||target.url);
  const common={code,finalURL,scope:target.scope};
  if(new URL(response.url||target.url).hostname==='accounts.google.com')return {...common,status:'restricted',detail:'已跳转到 Google 登录入口，站点可响应；未携带登录凭据，不能判定网站失效'};
  if(code===401||code===403||code===429)return {...common,status:'restricted',detail:`HTTP ${code}：登录、风控或限流，不能据此判定网站失效`};
  if(!response.ok)return {...common,status:'httpError',detail:`HTTP ${code}：${code>=500?'服务器本次返回错误':'入口返回错误'}，建议浏览器复核`};
  if(/<title[^>]*>[^<]*(just a moment|checking your browser|attention required|captcha|security verification)|cf-chl-|<title[^>]*>[^<]*(验证|安全检查)/i.test(body))return {...common,status:'restricted',detail:'入口响应正常，但可能停留在验证码或安全验证页'};
  const from=new URL(target.url),to=new URL(response.url||target.url);
  if(from.hostname.replace(/^www\./,'')!==to.hostname.replace(/^www\./,''))return {...common,status:'redirect',detail:'跳转到其他域名，请确认仍是原网站；跳转本身不代表失效'};
  return {...common,status:'ok',detail:`HTTP ${code}：入口可响应，未验证登录后功能${response.redirected?'（同站跳转）':''}`};
 }catch{
  const hint=knownAuditRedirect(url);let permissionTarget=null;
  if(hint&&permissions)try{if(!await permissions.contains({origins:[auditOrigin(hint)]}))permissionTarget=hint;}catch{}
  return {status:signal.aborted?'timeout':'restricted',code:null,scope:target.scope,finalURL:'',permissionTarget,detail:signal.aborted?'12 秒内未完成请求，待人工复核，不作为失效依据':permissionTarget?'请求受限，已知跳转目标尚未授权；可授权后重试，不能判定网站失效':'请求受限或网络原因未明（可能涉及 CORS、地址空间、证书或网络），待人工复核，不作为失效依据'};
 }
}
export function createSiteAudit({storage,permissions,navigation,localLane,fetcher=fetch,now=()=>Date.now(),revision=()=>crypto.randomUUID()}){
 const read=async()=>((await storage.get(AUDIT_KEY))[AUDIT_KEY]||null);
 const save=async job=>storage.set({[AUDIT_KEY]:job});
 const fail=message=>{throw new ApiError('AUDIT_CHANGED',message);};
 async function handle(message){return localLane(async()=>{
  const job=await read();
  if(message.type==='audit.get'){
   const undo=(await storage.get('siteAuditUndo')).siteAuditUndo,current=await navigation({type:'navigation.get'});
   return {job,canUndo:Boolean(undo&&undo.afterRevision===current.revision)};
  }
  if(message.type==='audit.start'){
   if(job?.state==='running')fail('已有检查正在进行，请等待完成或先停止');
   const current=await navigation({type:'navigation.get'});
   if(current.revision!==message.revision)fail('收藏已改变，请重新打开检查窗口后开始');
   const next={id:revision(),state:current.bookmarks.length?'running':'completed',startedAt:now(),finishedAt:null,rows:current.bookmarks.map(site=>({id:site.id,title:site.title,url:site.url,groupId:site.groupId,group:current.groups.find(g=>g.id===site.groupId)?.name||'',status:'pending',attempts:0,checkedAt:null}))};
   if(!next.rows.length)next.finishedAt=now();await save(next);return {job:next};
  }
  if(message.type==='audit.stop'){
   if(job?.id!==message.runId)fail('检查任务已改变，请重新核对');
   if(job.state==='running'){job.state='stopped';job.finishedAt=now();for(const row of job.rows)if(['pending','checking'].includes(row.status)){row.status='cancelled';delete row.lease;}await save(job);}return {job};
  }
  if(message.type==='audit.retry'){
   if(job?.id!==message.runId||job.state==='running')fail('检查任务已改变，请等待检查完成后重试');
   const row=job.rows.find(r=>r.id===message.id),n=await navigation({type:'navigation.get'}),hint=row&&knownAuditRedirect(row.url);
   if(!row||!auditIssue(row)||!hint||!n.bookmarks.some(s=>s.id===row.id&&s.url===row.url))fail('收藏或跳转目标已改变，请重新检查');
   if(!await permissions.contains({origins:[auditOrigin(hint)]}))throw new ApiError('PERMISSION_REQUIRED','跳转目标未授权，原检查结果已保留');
   Object.assign(row,{status:'pending',checkedAt:null,permissionTarget:null});for(const key of ['code','finalURL','detail','lease','claim'])delete row[key];
   job.state='running';job.finishedAt=null;await save(job);return {job};
  }
  if(message.type==='audit.delete'){
   if(job?.id!==message.runId||job.state==='running')fail('检查状态已改变，请重新选择');
   const current=await navigation({type:'navigation.get'});
   if(current.revision!==message.revision)fail('收藏已在其他页面更新，未删除任何网站，请重新核对');
   const ids=message.ids;if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)fail('请选择要删除的异常网站');
   for(const id of ids){const row=job.rows.find(r=>r.id===id),site=current.bookmarks.find(s=>s.id===id);if(!auditDeletable(row)||!site||site.url!==row.url)fail('所选网站需复核或网址已改变，未删除任何网站；请求受限、超时和跳转不参与批量删除');}
   const next=structuredClone(current);next.bookmarks=next.bookmarks.filter(s=>!ids.includes(s.id));next.revision=revision();validateNavigation(next);
   // One atomic storage write: a failed backup cannot leave a partial deletion.
   await storage.set({navigation:next,siteAuditUndo:{before:current,afterRevision:next.revision,deletedAt:now(),count:ids.length}});
   return {deleted:ids.length};
  }
  if(message.type==='audit.undo'){
   const undo=(await storage.get('siteAuditUndo')).siteAuditUndo,current=await navigation({type:'navigation.get'});
   if(!undo||current.revision!==undo.afterRevision)fail('删除后收藏已有其他修改，不能直接撤销覆盖；请使用已有备份恢复');
   const next=structuredClone(undo.before);next.revision=revision();validateNavigation(next);
   await storage.set({navigation:next,siteAuditUndo:null});return {restored:undo.count};
  }
  fail('不支持的检查操作');
 });}
 async function tick(){
  const claim=await localLane(async()=>{
   const job=await read();if(job?.state!=='running')return null;
   const current=await navigation({type:'navigation.get'});
   for(const row of job.rows){
    if(row.status==='checking'&&row.lease<=now()){row.status='pending';delete row.lease;}
    if(['pending','checking'].includes(row.status)&&!current.bookmarks.some(s=>s.id===row.id&&s.url===row.url)){row.status='skipped';row.detail='收藏已删除或网址已修改，旧任务未请求该网址';delete row.lease;}
   }
   const slots=Math.max(0,4-job.rows.filter(r=>r.status==='checking').length),rows=job.rows.filter(r=>r.status==='pending').slice(0,slots);
   for(const row of rows){row.status='checking';row.lease=now()+AUDIT_LEASE;row.attempts++;row.claim=revision();}
   if(!job.rows.some(r=>['pending','checking'].includes(r.status))){job.state='completed';job.finishedAt=now();}
   await save(job);return {runId:job.id,rows:structuredClone(rows)};
  });
  if(!claim?.rows.length)return false;
  await Promise.all(claim.rows.map(async row=>{
   let result;
   try{if(!await permissions.contains({origins:[auditOrigin(row.url)]}))result={status:'skipped',detail:'未获得该网站访问权限，未发送请求'};else result=await probeSite(row.url,{fetcher,permissions});}catch{result={status:'skipped',detail:'无法检查此网址或读取访问权限'};}
   await localLane(async()=>{
    const job=await read(),target=job?.rows.find(r=>r.id===row.id);
    if(job?.id!==claim.runId||job.state!=='running'||target?.claim!==row.claim||target.status!=='checking')return;
    Object.assign(target,result,{checkedAt:now()});delete target.lease;delete target.claim;
    if(!job.rows.some(r=>['pending','checking'].includes(r.status))){job.state='completed';job.finishedAt=now();}
    await save(job);
   });
  }));
  return true;
 }
 return {handle,tick};
}
