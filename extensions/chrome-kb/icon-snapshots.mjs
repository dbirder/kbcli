import {MAX_ICON_BYTES,validateBookmarkIcon} from './bookmark-icon.mjs';
const CACHE='kb-favicons-v1',BASE='https://kb-favicon-cache.invalid/';
// Upgrade adapter only. Reads old local cache entries; never calls fetch, even
// when an entry is missing, opaque, expired, malformed, or cannot be decoded.
export function createLegacyIconReader({cacheStorage=globalThis.caches,normalize=normalizeCachedIcon}={}){
 const pending=new Map();
 return async siteURL=>{
  const origin=new URL(siteURL).origin;
  if(!pending.has(origin))pending.set(origin,(async()=>{
   try{
    if(!cacheStorage)return null;
    if(cacheStorage.keys&&!(await cacheStorage.keys()).includes(CACHE))return null;
    const cache=await cacheStorage.open(CACHE);
    for(const source of ['site','chrome']){
     try{
      const index=await cache.match(BASE+'index?'+new URLSearchParams({origin,source}));if(!index)continue;
      const value=await index.json();if(value.missing!==false||typeof value.body!=='string'||!value.body.startsWith(BASE+'data?'))continue;
      const key=new URL(value.body);if(key.searchParams.get('origin')!==origin||key.searchParams.get('source')!==source)continue;
      const response=await cache.match(value.body);if(!response?.ok||response.type==='opaque'||response.type==='opaqueredirect')continue;
      const dataURL=await normalize(response);const icon=validateBookmarkIcon({mode:'auto',dataURL});return icon;
     }catch{/* An unreadable cache entry becomes a fixed text icon. */}
    }
   }catch{/* Cache failure must not trigger a network fallback. */}
   return null;
  })());
  return pending.get(origin);
 };
}
export async function normalizeCachedIcon(response){
 const blob=await response.blob();if(!blob.size||blob.size>2*1024*1024)throw Error('invalid cached icon');
 const bitmap=await createImageBitmap(blob);
 try{
  if(!bitmap.width||!bitmap.height||bitmap.width>8192||bitmap.height>8192)throw Error('invalid cached dimensions');
  const canvas=new OffscreenCanvas(128,128),scale=Math.min(128/bitmap.width,128/bitmap.height),w=bitmap.width*scale,h=bitmap.height*scale;
  canvas.getContext('2d').drawImage(bitmap,(128-w)/2,(128-h)/2,w,h);
  const out=await canvas.convertToBlob({type:'image/webp',quality:.85}),bytes=new Uint8Array(await out.arrayBuffer());let binary='';
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  const dataURL='data:image/webp;base64,'+btoa(binary);if(dataURL.length>MAX_ICON_BYTES)throw Error('cached icon too large');return dataURL;
 }finally{bitmap.close();}
}
