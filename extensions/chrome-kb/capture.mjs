import {ApiError} from './api.mjs';
import {bookmarkURL} from './navigation.mjs';
import {imageURL,imagePermissionOrigin} from './bookmark-icon.mjs';
const uuid=/^[0-9a-f-]{36}$/i;
export function createCaptureStore({storage,navigation,now=()=>Date.now()}){
 const get=async()=>{const v=(await storage.get('quickCapture')).quickCapture;return v?.version===1?v:{version:1,drafts:[],lastGroup:''};};
 function context(value){if(typeof value!=='string'||!value||value.length>4300)throw new ApiError('MESSAGE_INVALID','收藏草稿上下文无效');return value;}
 return async m=>{
  const s=await get();
  if(m.type==='capture.load'){context(m.context);return {navigation:await navigation({type:'navigation.get'}),draft:s.drafts.find(d=>d.context===m.context&&now()-d.updatedAt<7*86400000)?.value||null,lastGroup:s.lastGroup};}
  if(m.type==='capture.draft'){
   context(m.context);const d=m.draft;
   if(!d||!uuid.test(d.operationId)||!Number.isSafeInteger(d.sequence)||d.sequence<0||JSON.stringify(d).length>60000)throw new ApiError('MESSAGE_INVALID','收藏草稿无效');
   const old=s.drafts.find(x=>x.context===m.context);
   if(old?.value.operationId===d.operationId&&old.value.sequence>d.sequence)return {saved:false};
   s.drafts=s.drafts.filter(x=>x.context!==m.context);s.drafts.push({context:m.context,value:structuredClone(d),updatedAt:now()});s.drafts=s.drafts.slice(-10);await storage.set({quickCapture:s});return {saved:true};
  }
  if(m.type==='capture.save'){
   context(m.context);const n=await navigation({...m.bookmark,type:'bookmark.capture',operationId:m.operationId,revision:m.revision});
   const id=m.bookmark.id||m.operationId;
   s.lastGroup=m.bookmark.groupId;s.drafts=s.drafts.filter(x=>x.context!==m.context);await storage.set({quickCapture:s});return {navigation:n,siteId:id};
  }
  throw new ApiError('MESSAGE_INVALID','不支持的快速收藏操作');
 };
}
// No cookies/referrer or redirects. Only explicit image origins with permission
// can be fetched; tab icons use Chrome's local favicon service instead.
export async function fetchCaptureImage(m,{runtime,tabs,permissions,fetcher=fetch}){
 let url,chromeFavicon=false;
 if(m.source==='website'){
  const page=bookmarkURL(m.pageURL),u=new URL(runtime.getURL('/_favicon/'));
  u.search=new URLSearchParams({pageUrl:new URL(page).origin+'/',size:'128'});url=u.href;chromeFavicon=true;
 }else if(m.source==='tab'){
  const tab=await tabs.get(m.tabId);const page=bookmarkURL(tab.url);
  if(page!==m.pageURL)throw new ApiError('TAB_CHANGED','当前网页已改变，请重新获取网站信息');
  const u=new URL(runtime.getURL('/_favicon/'));u.search=new URLSearchParams({pageUrl:page,size:'128'});url=u.href;chromeFavicon=true;
 }else{
  url=imageURL(m.url);const origin=imagePermissionOrigin(url);
  if(!await permissions.contains({origins:[origin]}))throw new ApiError('PERMISSION_REQUIRED','请授权图片所在网站后再加载');
 }
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 try{
  const response=await fetcher(url,{credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:m.refresh?'reload':'default',signal:controller.signal});
  let mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(!response.ok||(!chromeFavicon&&!/^image\/(png|jpeg|webp|gif|svg\+xml|x-icon|vnd.microsoft.icon)$/.test(mime)))throw Error('not an image');
  if(Number(response.headers.get('content-length'))>2*1024*1024)throw Error('too large');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw Error('too large');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  // Chrome's internal favicon response can omit Content-Type entirely.
  // Only this generated internal URL may use a verified binary signature;
  // external image URLs still require their declared image content type.
  if(chromeFavicon){mime=faviconMime(bytes);if(!mime)throw Error('invalid favicon signature');}
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return {dataURL:`data:${mime};base64,${btoa(binary)}`};
 }catch{throw new ApiError('IMAGE_UNAVAILABLE','图片未加载：请检查图片直链、访问权限或文件大小（最多 2 MiB）；当前图标已保留');}
 finally{clearTimeout(timer);}
}
function faviconMime(bytes){
 const starts=signature=>signature.every((value,index)=>bytes[index]===value);
 const ascii=(offset,length)=>String.fromCharCode(...bytes.subarray(offset,offset+length));
 if(starts([137,80,78,71,13,10,26,10]))return 'image/png';
 if(starts([255,216,255]))return 'image/jpeg';
 if(['GIF87a','GIF89a'].includes(ascii(0,6)))return 'image/gif';
 if(ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP')return 'image/webp';
 if(starts([0,0,1,0])&&bytes.length>=6)return 'image/x-icon';
 return null;
}
