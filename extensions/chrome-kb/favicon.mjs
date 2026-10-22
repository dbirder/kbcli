// Historical pre-0.11 fixture implementation only. Not imported by the current
// UI or shipped in release packages; see icon-snapshots.mjs for local upgrades.
import {faviconRoute} from './favicon-store.mjs';
// Resolve only a site's public origin: never send a saved path, query or fragment.
export function faviconSources(siteURL,runtime,size=64) {
  const origin=new URL(siteURL).origin;
  const cached=new URL(runtime.getURL('/_favicon/'));
  cached.searchParams.set('pageUrl',origin+'/');cached.searchParams.set('size',String(size));
  return {cached:cached.href,direct:origin+'/favicon.ico'};
}
function signature(image) {
  try {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
    canvas.getContext('2d').drawImage(image,0,0,64,64);return canvas.toDataURL();
  } catch { return null; }
}
function loadImage(url) {
  return new Promise(resolve=>{
    const image=new Image();image.decoding='async';image.referrerPolicy='no-referrer';
    const finish=value=>{clearTimeout(timer);image.onload=image.onerror=null;resolve(value);};
    const timer=setTimeout(()=>{finish(null);image.removeAttribute('src');},12000);
    image.onload=()=>finish(image);image.onerror=()=>finish(null);image.src=url;
  });
}
let defaultSignature;
async function isChromeDefault(image,runtime) {
  if(!runtime.getURL('/_favicon/').startsWith('chrome-extension:'))return false;
  defaultSignature??=(async()=>{
    const fallback=await loadImage(faviconSources('https://kb-workspace-favicon.invalid/',runtime).cached);
    return fallback?signature(fallback):null;
  })();
  const fallback=await defaultSignature;
  return Boolean(fallback&&signature(image)===fallback);
}
// Decode each persistent response once per page, shared by all icon surfaces.
// Keep failures as well, so a missing icon is not retried on every interaction.
export function createFaviconCache({load=loadImage,isDefault=isChromeDefault,refresh=false}={}) {
  const entries=new Map(),waiting=[];let active=0;
  async function limited(run){
    await new Promise(resolve=>{if(active<4){active++;resolve();}else waiting.push(resolve);});
    try{return await run();}finally{const next=waiting.shift();if(next)next();else active--;}
  }
  return {
    get(siteURL,runtime) {
      const sources=faviconSources(siteURL,runtime),key=sources.cached;
      if(!entries.has(key)) {
        const entry={value:undefined,promise:null};
        entry.promise=limited(async()=>{
          try {
            if(!runtime.id||!runtime.sendMessage){
              const cached=await load(sources.cached);
              entry.value=cached&&!await isDefault(cached,runtime)?cached:await load(sources.direct);
            } else {
              const context={ticket:crypto.randomUUID(),epoch:Date.now(),refresh};
              async function resolve(source,force=refresh){
                const image=await load(faviconRoute(runtime,siteURL,source,{...context,refresh:force}));
                const valid=Boolean(image&&(source!=='chrome'||!await isDefault(image,runtime)));
                try{await runtime.sendMessage({type:'favicon.result',origin:new URL(siteURL).origin,source,...context,missing:!valid});}catch{}
                return valid?image:null;
              }
              entry.value=refresh?await resolve('site')||await resolve('chrome'):await resolve('chrome')||await resolve('site');
              if(!entry.value&&refresh)entry.value=await resolve('site',false)||await resolve('chrome',false);
            }
          } catch { entry.value=null; }
          return entry.value;
        });
        entries.set(key,entry);
      }
      return entries.get(key).promise;
    },
    peek(siteURL,runtime){return entries.get(faviconSources(siteURL,runtime).cached)?.value;},
  };
}
// A browser reload is an explicit refresh; a newly opened tab is cache-only.
const isReload=typeof performance!=='undefined'&&performance.getEntriesByType?.('navigation')[0]?.type==='reload';
let icons=createFaviconCache({refresh:isReload});
export function refreshFavicons(){icons=createFaviconCache({refresh:true});return icons;}

const pending=new WeakMap();
let observer;
export function attachFavicon(container,siteURL,runtime) {
  const canvas=document.createElement('canvas');canvas.className='favicon';
  canvas.width=canvas.height=64;canvas.setAttribute('aria-hidden','true');canvas.style.opacity='0';
  function paint(image) {
    try {
      // Drawing a cross-origin image is allowed; we never read/export its pixels.
      canvas.getContext('2d').drawImage(image,0,0,64,64);canvas.style.opacity='1';
    } catch { /* Keep the site's initial if the browser cannot draw the bitmap. */ }
  }
  async function draw() {
    const image=await icons.get(siteURL,runtime);
    if(!image||!canvas.isConnected)return;
    paint(image);
  }
  container.append(canvas);
  const known=icons.peek(siteURL,runtime);
  if(known!==undefined){if(known)paint(known);return canvas;}
  if(typeof IntersectionObserver==='function') {
    observer??=new IntersectionObserver(entries=>{
      for(const entry of entries)if(entry.isIntersecting||!entry.target.isConnected){
        observer.unobserve(entry.target);const paint=pending.get(entry.target);pending.delete(entry.target);
        if(entry.isIntersecting&&entry.target.isConnected)void paint?.();
      }
    });
    pending.set(canvas,draw);observer.observe(canvas);
  } else void draw();
  return canvas;
}
