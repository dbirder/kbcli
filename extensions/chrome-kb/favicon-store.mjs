// Historical pre-0.11 fixture implementation only. Not imported by the current
// UI or shipped in release packages; see icon-snapshots.mjs for local upgrades.
// Cache keys are virtual HTTPS URLs (Cache.put does not accept extension URLs).
// These URLs are storage identifiers only and are never fetched.
const CACHE='kb-favicons-v1',BASE='https://kb-favicon-cache.invalid/';
const tokenPattern=/^[0-9a-f-]{36}$/i;
const missing=()=>new Response(null,{status:404});
function validOrigin(value){
  try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&u.origin===value?value:null;}catch{return null;}
}
function details(value){
  if(!value||!validOrigin(value.origin)||!['chrome','site'].includes(value.source)||!tokenPattern.test(value.ticket)||!Number.isSafeInteger(value.epoch)||value.epoch<0)return null;
  return {origin:value.origin,source:value.source,ticket:value.ticket,epoch:value.epoch,refresh:value.refresh===true||value.refresh==='1'};
}
const key=(kind,d)=>BASE+kind+'?'+new URLSearchParams(kind==='index'?{origin:d.origin,source:d.source}:{origin:d.origin,source:d.source,ticket:d.ticket,epoch:String(d.epoch)});
export function faviconRoute(runtime,siteURL,source,{ticket,epoch,refresh=false}){
  const url=new URL('_kb-favicon/'+source,runtime.getURL(''));
  url.search=new URLSearchParams({origin:new URL(siteURL).origin,ticket,epoch:String(epoch),refresh:refresh?'1':'0'});
  return url.href;
}
export function parseFaviconRoute(url,runtime){
  const u=new URL(url),base=new URL('_kb-favicon/',runtime.getURL(''));
  if(u.protocol!==base.protocol||u.host!==base.host||!u.pathname.startsWith(base.pathname))return null;
  return details({origin:u.searchParams.get('origin'),source:u.pathname.slice(base.pathname.length),ticket:u.searchParams.get('ticket'),epoch:Number(u.searchParams.get('epoch')),refresh:u.searchParams.get('refresh')});
}
export function createFaviconResponseStore({cacheStorage=globalThis.caches,runtime,allowed,fetcher=fetch,now=()=>Date.now()}){
  const inflight=new Map();let tail=Promise.resolve();
  const serial=run=>{const pending=(async()=>{try{await tail;}catch{}return run();})();tail=pending;return pending;};
  async function record(cache,d){
    const response=await cache.match(key('index',d));if(!response)return null;
    try{const index=await response.json();if(typeof index.missing!=='boolean'||!Number.isSafeInteger(index.epoch))return null;
      if(index.missing)return {index,response:missing()};
      if(typeof index.body!=='string'||!index.body.startsWith(BASE+'data?'))return null;
      const body=await cache.match(index.body);return body?{index,response:body}:null;
    }catch{return null;}
  }
  async function saved(cache,d){
    const current=await record(cache,d);
    if(d.source!=='chrome')return current;
    const site=await record(cache,{...d,source:'site'});
    if(site&&!site.index.missing&&(!current||current.index.missing||site.index.epoch>=current.index.epoch))return site;
    return current;
  }
  async function source(d){
    const url=d.source==='site'?d.origin+'/favicon.ico':(()=>{const u=new URL(runtime.getURL('/_favicon/'));u.search=new URLSearchParams({pageUrl:d.origin+'/',size:'64'});return u.href;})();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{return await fetcher(url,{mode:d.source==='site'?'no-cors':'same-origin',credentials:'omit',referrerPolicy:'no-referrer',cache:d.refresh?'reload':'default',signal:controller.signal});}
    finally{clearTimeout(timer);}
  }
  async function respond(d){
    if(!details(d)||!await allowed(d.origin))return missing();
    let cache;try{cache=await cacheStorage.open(CACHE);}catch{}
    if(cache&&!d.refresh){const hit=await saved(cache,d);if(hit)return hit.response;}
    const id=JSON.stringify([d.origin,d.source,d.refresh,d.refresh?d.ticket:'']);
    if(!inflight.has(id))inflight.set(id,(async()=>{try{return await source(d);}catch{return missing();}})());
    let result;
    try{result=(await inflight.get(id)).clone();}finally{inflight.delete(id);}
    // An opaque response stays opaque: only an <img> decodes it. Never read its body.
    if(cache)try{await cache.put(key('data',d),result.clone());}catch{}
    return result;
  }
  async function settle(input){
    const d=details(input);if(!d||typeof input.missing!=='boolean'||!await allowed(d.origin))return {saved:false};
    let cache;try{cache=await cacheStorage.open(CACHE);}catch{return {saved:false};}
    const body=key('data',d),candidate=await cache.match(body);if(!candidate)return {saved:false};
    const current=await record(cache,d);
    // A failed refresh must not destroy the last usable icon. Old tabs cannot
    // publish an older candidate over a more recent manual refresh.
    if(current&&(current.index.epoch>d.epoch||(input.missing&&!current.index.missing))){await cache.delete(body);return {saved:false,preserved:true};}
    const index={epoch:d.epoch,missing:input.missing,body:input.missing?null:body};
    try{await cache.put(key('index',d),Response.json(index));}catch{return {saved:false};}
    if(input.missing)await cache.delete(body);
    if(current?.index.body&&current.index.body!==body)await cache.delete(current.index.body);
    return {saved:true};
  }
  async function prune(){
    try{
      const cache=await cacheStorage.open(CACHE),keys=await cache.keys(),keep=new Set();
      for(const request of keys)if(request.url.startsWith(BASE+'index?')){
        const u=new URL(request.url),origin=u.searchParams.get('origin');
        if(!await allowed(origin)){await cache.delete(request);continue;}
        const r=await record(cache,{origin,source:u.searchParams.get('source')});if(r?.index.body)keep.add(r.index.body);
      }
      for(const request of keys)if(request.url.startsWith(BASE+'data?')&&!keep.has(request.url)&&now()-Number(new URL(request.url).searchParams.get('epoch'))>600000)await cache.delete(request);
    }catch{/* Cache eviction never affects bookmarks. */}
  }
  return {respond,settle:input=>serial(()=>settle(input)),prune:()=>serial(prune)};
}
