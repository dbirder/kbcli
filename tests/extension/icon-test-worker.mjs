// HTTP fixture only: exercise the real response store through image fetch events.
import {createFaviconResponseStore,parseFaviconRoute} from '/favicon-store.mjs';
const runtime={getURL:path=>new URL(path,location.origin).href};
const store=createFaviconResponseStore({runtime,allowed:async origin=>origin===location.origin,fetcher:async(url,options)=>fetch(url.includes('/_favicon/')?'/__test/icon/source/chrome':'http://localhost:'+location.port+'/__test/icon/source/site',options)});
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{const d=parseFaviconRoute(event.request.url,runtime);if(d)event.respondWith(store.respond(d));});
self.addEventListener('message',event=>{if(event.data?.type==='favicon.result')event.waitUntil((async()=>{try{event.ports[0].postMessage({ok:true,data:await store.settle(event.data)});}catch{event.ports[0].postMessage({ok:false});}})());});
