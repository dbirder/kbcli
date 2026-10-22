import {ApiError} from './api.mjs';
export const MAX_ICON_BYTES=32*1024,MAX_ICONS_BYTES=1024*1024;
export function fallbackBookmarkIcon(title,url){
  const colors=['#2c756a','#526f9b','#82649b','#8b6b47','#547d62','#886473'];
  const host=new URL(url).hostname,hash=Array.from(host).reduce((n,c)=>n+c.codePointAt(0),0);
  return {mode:'text',text:Array.from(title.trim())[0]||'网',color:colors[hash%colors.length]};
}
const fail=()=>{throw new ApiError('ICON_INVALID','请选择有效的网站图标（处理后不超过 32 KiB）',{field:'icon'});};
export function imageURL(value){
  let u;try{u=new URL(value);}catch{fail();}
  if(!['https:','http:'].includes(u.protocol)||!u.hostname||u.username||u.password||u.href.length>4096)fail();return u.href;
}
export function imagePermissionOrigin(value){const u=new URL(imageURL(value));return u.protocol+'//'+u.hostname+'/*';}
export function validateBookmarkIcon(icon){
  if(icon==null)return null;
  if(typeof icon!=='object'||Array.isArray(icon))fail();
  if(icon.mode==='text'){
    if(Object.keys(icon).some(k=>!['mode','text','color'].includes(k))||typeof icon.text!=='string'||!icon.text.trim()||Array.from(icon.text).length>2||!/^#[0-9a-f]{6}$/i.test(icon.color))fail();
    return {mode:'text',text:icon.text.trim(),color:icon.color.toLowerCase()};
  }
  if(!['auto','image'].includes(icon.mode)||Object.keys(icon).some(k=>!['mode','dataURL','sourceURL'].includes(k))||typeof icon.dataURL!=='string'||icon.dataURL.length>MAX_ICON_BYTES||!/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(icon.dataURL))fail();
  let bytes;try{bytes=atob(icon.dataURL.slice(23));}catch{fail();}
  if(bytes.slice(0,4)!=='RIFF'||bytes.slice(8,12)!=='WEBP')fail();
  return {mode:icon.mode,dataURL:icon.dataURL,...(icon.sourceURL?{sourceURL:imageURL(icon.sourceURL)}:{})};
}
export function equalBookmark(a,b){return Boolean(a&&a.title===b.title&&a.url===b.url&&a.groupId===b.groupId&&JSON.stringify(a.icon||null)===JSON.stringify(b.icon||null));}
export function paintBookmarkIcon(container,icon){
  if(!icon)return false;
  if(icon.mode==='text'){container.textContent=icon.text;container.style.backgroundColor=icon.color;container.style.color='#ffffff';return true;}
  if(icon.dataURL){const fallback=container.textContent;container.textContent='';const img=document.createElement('img');img.className='favicon';img.alt='';img.width=img.height=128;img.decoding='sync';img.draggable=false;img.onerror=()=>{if(img.isConnected)container.textContent=fallback;};img.src=icon.dataURL;container.append(img);return true;}
  return false;
}
