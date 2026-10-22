import {ApiError} from './api.mjs';
import {MAX_ICON_BYTES} from './bookmark-icon.mjs';
export async function normalizeIcon(dataURL){
 const image=new Image();image.decoding='async';
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{image.src='';reject(new ApiError('IMAGE_INVALID','图片解码超时，当前图标已保留'));},8000);image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(new ApiError('IMAGE_INVALID','无法解码这张图片，当前图标已保留'));};image.src=dataURL;});
 if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth>8192||image.naturalHeight>8192)throw new ApiError('IMAGE_INVALID','请选择尺寸不超过 8192×8192 的图片');
 const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
 const scale=Math.min(128/image.naturalWidth,128/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;
 canvas.getContext('2d').drawImage(image,(128-w)/2,(128-h)/2,w,h);
 const result=canvas.toDataURL('image/webp',.85);
 if(result.length>MAX_ICON_BYTES)throw new ApiError('IMAGE_INVALID','图片处理后仍过大，请换一张较简单的图标');return result;
}
// Executed only in the top frame after the user clicks the extension action.
export function readPageMetadata(){
 const icon=[...document.querySelectorAll('link[rel]')].find(link=>link.rel.split(/\s+/).some(v=>['icon','apple-touch-icon'].includes(v))&&/^https?:$/.test(new URL(link.href).protocol));
 return {title:document.title.slice(0,100),url:location.href,iconURL:icon?.href||null};
}
