import {ApiError} from './api.mjs';
import {fallbackBookmarkIcon,validateBookmarkIcon} from './bookmark-icon.mjs';
import {validateNavigation} from './navigation.mjs';
import {fetchCaptureImage} from './capture.mjs';
import {normalizeCachedIcon} from './icon-snapshots.mjs';
export const ICON_BATCH_KEY='iconBatch',ICON_BATCH_LEASE=45000;
export const ICON_BATCH_LABELS={pending:'等待获取',fetching:'正在获取',updated:'已保存',failed:'失败，保留原图标',protected:'保留自定义图标',skipped:'内容已改动，已跳过',cancelled:'已停止'};
export function isCustomIcon(site){return site.icon?.mode==='image'||(site.icon?.mode==='text'&&JSON.stringify(site.icon)!==JSON.stringify(fallbackBookmarkIcon(site.title,site.url)));}
async function normalizeRaw(dataURL,normalize){const [header,body]=dataURL.split(',');return normalize(new Response(Uint8Array.from(atob(body),c=>c.charCodeAt(0)),{headers:{'Content-Type':header.slice(5).split(';')[0]}}));}
export function createBatchIconFetcher({runtime,permissions,fetcher=fetch,normalize=normalizeCachedIcon}){
 let defaultIcon;
 const image=async message=>{const raw=await fetchCaptureImage({...message,refresh:true},{runtime,permissions,fetcher});return normalizeRaw(raw.dataURL,normalize);};
 return async siteURL=>{
  const origin=new URL(siteURL).origin;
  try{
   const dataURL=await image({source:'website',pageURL:origin+'/'});
   if(runtime.id){
    defaultIcon??=(async()=>{try{return await image({source:'website',pageURL:'https://kb-workspace-favicon.invalid/'});}catch{return null;}})();
    const empty=await defaultIcon;if(!empty||dataURL===empty)throw Error('Default Chrome icon');
   }
   return {icon:{mode:'auto',dataURL},source:'Chrome 网站图标'};
  }catch{/* Chrome has no usable cached image; only an already authorized host may be contacted. */}
  const originPattern=new URL(origin).protocol+'//'+new URL(origin).hostname+'/*';
  if(!await permissions.contains({origins:[originPattern]}))throw new ApiError('PERMISSION_REQUIRED','Chrome 未找到可用图标，网站尚未授权，原图标已保留');
  try{return {icon:{mode:'auto',dataURL:await image({url:origin+'/favicon.ico'})},source:'网站 favicon'};}catch{throw new ApiError('ICON_FETCH_FAILED','Chrome 和网站均未返回可用图标，已保留原图标');}
 };
}
export function createIconBatch({storage,navigation,localLane,fetchIcon,now=()=>Date.now(),revision=()=>crypto.randomUUID()}){
 const read=async()=>((await storage.get(ICON_BATCH_KEY))[ICON_BATCH_KEY]||null),save=job=>storage.set({[ICON_BATCH_KEY]:job});
 const fail=message=>{throw new ApiError('ICON_BATCH_CHANGED',message);};
 const finish=job=>{if(!job.rows.some(r=>['pending','fetching'].includes(r.status))){job.state='completed';job.finishedAt=now();}};
 const unchanged=(site,row)=>site?.url===row.url&&JSON.stringify(site.icon||null)===row.expectedIcon;
 async function handle(m){return localLane(async()=>{
  const job=await read();if(m.type==='icons.get')return {job};
  if(m.type==='icons.start'){
   if(job?.state==='running')fail('已有图标获取任务正在进行，请等待完成或先停止');
   const n=await navigation({type:'navigation.get'});if(n.revision!==m.revision)fail('收藏已改变，请重新打开工具后再开始');
   if(typeof m.replaceCustom!=='boolean')fail('请选择是否替换自定义图标');
   const next={id:revision(),state:'running',startedAt:now(),finishedAt:null,replaceCustom:m.replaceCustom,rows:n.bookmarks.map(s=>({id:s.id,title:s.title,url:s.url,expectedIcon:JSON.stringify(s.icon||null),status:!m.replaceCustom&&isCustomIcon(s)?'protected':'pending',attempts:0,checkedAt:null}))};finish(next);await save(next);return {job:next};
  }
  if(m.type==='icons.stop'){
   if(job?.id!==m.runId)fail('图标任务已改变，请重新核对');
   if(job.state==='running'){job.state='stopped';job.finishedAt=now();for(const r of job.rows)if(['pending','fetching'].includes(r.status)){r.status='cancelled';delete r.lease;delete r.claim;}await save(job);}return {job};
  }
  fail('不支持的图标操作');
 });}
 async function tick(){
  const claim=await localLane(async()=>{
   const job=await read();if(job?.state!=='running')return null;
   const n=await navigation({type:'navigation.get'});
   for(const r of job.rows){if(r.status==='fetching'&&r.lease<=now()){r.status='pending';delete r.lease;}
    if(['pending','fetching'].includes(r.status)&&!unchanged(n.bookmarks.find(s=>s.id===r.id),r)){r.status='skipped';r.detail='收藏网址或图标已修改，保留最新内容';delete r.lease;}}
   const rows=job.rows.filter(r=>r.status==='pending').slice(0,Math.max(0,4-job.rows.filter(r=>r.status==='fetching').length));
   for(const r of rows){r.status='fetching';r.claim=revision();r.lease=now()+ICON_BATCH_LEASE;r.attempts++;}
   finish(job);await save(job);return {runId:job.id,rows:structuredClone(rows)};
  });
  if(!claim?.rows.length)return false;
  const origins=new Map();
  await Promise.all(claim.rows.map(async row=>{
   let result,error;
   try{const origin=new URL(row.url).origin;if(!origins.has(origin))origins.set(origin,fetchIcon(origin+'/'));result=await origins.get(origin);validateBookmarkIcon(result.icon);if(result.icon.mode!=='auto')throw Error('invalid automatic icon');}catch(e){error=e;}
   await localLane(async()=>{
    const job=await read(),r=job?.rows.find(x=>x.id===row.id);
    if(job?.id!==claim.runId||job.state!=='running'||r?.claim!==row.claim||r.status!=='fetching')return;
    const n=await navigation({type:'navigation.get'}),site=n.bookmarks.find(s=>s.id===row.id);let next=null;
    if(!unchanged(site,row)){r.status='skipped';r.detail='收藏网址或图标已修改，保留最新内容';}
    else if(error){r.status='failed';r.needsPermission=error.code==='PERMISSION_REQUIRED';r.detail=r.needsPermission?'Chrome 未找到可用图标，网站尚未授权；原图标保留，可授权后重试':'未能获取有效图标，原图标保留；可稍后重新尝试';}
    else{
     try{next=structuredClone(n);next.bookmarks.find(s=>s.id===row.id).icon=validateBookmarkIcon(result.icon);validateNavigation(next);next.revision=revision();r.status='updated';r.detail=result.source+'，已保存到本机';}
     catch{next=null;r.status='failed';r.detail='图标容量超限或格式无效，已保留原图标';}
    }
    r.checkedAt=now();delete r.claim;delete r.lease;finish(job);
    if(next){try{await storage.set({navigation:next,[ICON_BATCH_KEY]:job});}catch{r.status='failed';r.detail='存储空间不足，未替换原图标';await save(job);}}
    else await save(job);
   });
  }));return true;
 }
 return {handle,tick};
}
