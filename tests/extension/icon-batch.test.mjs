import {legacyNavigation} from './fixtures/legacy-navigation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createController} from '../../extensions/chrome-kb/controller.mjs';
import {createBatchIconFetcher,isCustomIcon,ICON_BATCH_LEASE} from '../../extensions/chrome-kb/icon-batch.mjs';
import {fallbackBookmarkIcon} from '../../extensions/chrome-kb/bookmark-icon.mjs';
const dataURL='data:image/webp;base64,'+btoa('RIFF0000WEBPtest'),updated={mode:'auto',dataURL},result={icon:updated,source:'TEST ONLY'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(fetcher=async()=>result){let serial=0,clock=1000;const data={navigation:legacyNavigation()},calls=[];
 const storage={async get(key){return structuredClone({[key]:data[key]});},async set(v){Object.assign(data,structuredClone(v));},async remove(key){delete data[key];}};
 const make=()=>createController({storage,permissions:{},fetchBatchIcon:async url=>{calls.push(url);return fetcher(url);},now:()=>clock,revision:()=>`r${++serial}`});let handle=make();
 return {data,calls,storage,get handle(){return handle;},restart(){handle=make();},advance(ms){clock+=ms;},async seed(count=1){let n=await handle({type:'navigation.get'});for(let i=0;i<count;i++)n=await handle({type:'bookmark.add',revision:n.revision,title:'网站'+i,url:`https://site${i}.example/private?token=secret#fragment`,groupId:'default'});return n;},async start(replaceCustom=false){const n=await handle({type:'navigation.get'});return (await handle({type:'icons.start',revision:n.revision,replaceCustom})).job;}};
}
test('manual batch updates only icons and persists them; no implicit request after reads or restart',async()=>{
 const f=fixture(),before=await f.seed(3);assert.equal(await f.handle.iconBatchTick(),false);await f.handle({type:'icons.get'});assert.equal(f.calls.length,0);const job=await f.start();await f.handle.iconBatchTick();const n=await f.handle({type:'navigation.get'});
 assert.deepEqual(n.bookmarks.map(({icon,...s})=>s),before.bookmarks.map(({icon,...s})=>s));assert.ok(n.bookmarks.every(s=>s.icon.mode==='auto'));assert.ok(f.calls.every(u=>/^https:\/\/site\d\.example\/$/.test(u)));assert.deepEqual(n.groups,before.groups);assert.deepEqual(n.preferences,before.preferences);
 f.restart();assert.equal((await f.handle({type:'icons.get'})).job.id,job.id);assert.equal(await f.handle.iconBatchTick(),false);assert.equal(f.calls.length,3);
});
test('default protects custom images/text and opt-in replaces them; automatic fallback remains eligible',async()=>{
 const f=fixture();let n=await f.seed(3);n=await f.handle({type:'bookmark.update',revision:n.revision,...n.bookmarks[0],icon:{mode:'image',dataURL}});n=await f.handle({type:'bookmark.update',revision:n.revision,...n.bookmarks[1],icon:{mode:'text',text:'手',color:'#123456'}});
 assert.equal(isCustomIcon(n.bookmarks[0]),true);assert.equal(isCustomIcon(n.bookmarks[1]),true);assert.equal(isCustomIcon(n.bookmarks[2]),false);await f.start();await f.handle.iconBatchTick();assert.equal(f.calls.length,1);assert.equal(f.data.iconBatch.rows.filter(r=>r.status==='protected').length,2);
 await f.start(true);await f.handle.iconBatchTick();assert.equal(f.calls.length,4);assert.ok(f.data.navigation.bookmarks.every(s=>s.icon.mode==='auto'));
});
test('network failure or invalid result keeps the old icon and records failure',async()=>{
 for(const fetcher of [async()=>{throw Error('offline');},async()=>({icon:{mode:'auto',dataURL:'bad'}})]){const f=fixture(fetcher),before=await f.seed();await f.start();await f.handle.iconBatchTick();assert.deepEqual(f.data.navigation,before);assert.equal(f.data.iconBatch.rows[0].status,'failed');}
});
test('four concurrent requests, duplicate origins share a fetch, second start cannot race',async()=>{
 const gate=deferred();let active=0,max=0;const f=fixture(async()=>{active++;max=Math.max(max,active);await gate.promise;active--;return result;});let n=await f.seed(6);n=await f.handle({type:'bookmark.update',revision:n.revision,...n.bookmarks[1],url:n.bookmarks[0].url+'/other',icon:fallbackBookmarkIcon(n.bookmarks[1].title,n.bookmarks[0].url)});
 await f.start();await assert.rejects(f.start(),{code:'ICON_BATCH_CHANGED'});const pending=f.handle.iconBatchTick();await new Promise(setImmediate);assert.equal(f.calls.length,3);assert.equal(await f.handle.iconBatchTick(),false);assert.ok(max<=4);gate.resolve();await pending;await f.handle.iconBatchTick();assert.equal(f.data.iconBatch.state,'completed');
});
test('concurrent manual icon edit, URL edit or removal wins over a late fetched icon',async()=>{
 for(const kind of ['icon','url','remove']){const gate=deferred(),f=fixture(async()=>{await gate.promise;return result;});let n=await f.seed();await f.start();const pending=f.handle.iconBatchTick();await new Promise(setImmediate);
  n=await f.handle(kind==='remove'?{type:'bookmark.remove',revision:n.revision,id:n.bookmarks[0].id}:{type:'bookmark.update',revision:n.revision,...n.bookmarks[0],...(kind==='icon'?{icon:{mode:'text',text:'改',color:'#123456'}}:{url:'https://changed.example/'})});
  gate.resolve();await pending;assert.deepEqual(f.data.navigation,n);assert.equal(f.data.iconBatch.rows[0].status,'skipped');}
});
test('stop rejects late writes and expired worker leases recover only requested work',async()=>{
 const gate=deferred(),f=fixture(async()=>{await gate.promise;return result;});const n=await f.seed(),job=await f.start();const pending=f.handle.iconBatchTick();await new Promise(setImmediate);await f.handle({type:'icons.stop',runId:job.id});gate.resolve();await pending;assert.deepEqual(f.data.navigation,n);assert.equal(f.data.iconBatch.rows[0].status,'cancelled');
 const g=fixture();await g.seed();await g.start();Object.assign(g.data.iconBatch.rows[0],{status:'fetching',lease:1000+ICON_BATCH_LEASE,claim:'expired'});g.restart();assert.equal(await g.handle.iconBatchTick(),false);g.advance(ICON_BATCH_LEASE+1);await g.handle.iconBatchTick();assert.equal(g.calls.length,1);assert.equal(g.data.iconBatch.state,'completed');
});
test('atomic quota failure preserves canonical icon and reports failure',async()=>{
 const f=fixture(),n=await f.seed();await f.start();const set=f.storage.set;f.storage.set=async v=>{if(v.navigation)throw Error('quota');return set(v);};await f.handle.iconBatchTick();assert.deepEqual(f.data.navigation,n);assert.equal(f.data.iconBatch.rows[0].status,'failed');
});
test('fetcher only requests origin favicon, keeps credentials out, and rejects a generic Chrome default',async()=>{
 const calls=[],runtime={id:'test',getURL:path=>'chrome-extension://test/'+path.replace(/^\//,'')};let direct=true;
 const fetchIcon=createBatchIconFetcher({runtime,permissions:{async contains(){return true;}},normalize:async r=>{await r.blob();return dataURL;},fetcher:async(url,o)=>{calls.push(url);assert.equal(o.credentials,'omit');assert.equal(o.referrerPolicy,'no-referrer');assert.equal(o.redirect,'error');if(!direct&&url.startsWith('https:'))throw Error('not found');return new Response('image',{headers:{'Content-Type':'image/png'}});}});
 assert.equal((await fetchIcon('https://site.example/private?token=secret')).source,'网站 favicon');assert.ok(calls[0].startsWith('chrome-extension://test/_favicon/'));assert.equal(calls[1],'https://site.example/favicon.ico');direct=false;await assert.rejects(fetchIcon('https://site.example/private?token=secret'),{code:'ICON_FETCH_FAILED'});assert.ok(!calls.some(u=>u.includes('secret')));
});

test('batch Chrome fallback handles missing MIME and still distinguishes the default icon',async()=>{
 const calls=[],runtime={id:'test',getURL:p=>'chrome-extension://test'+p};
 const fetchIcon=createBatchIconFetcher({runtime,permissions:{async contains(){return true;}},normalize:async r=>{assert.equal(r.headers.get('content-type'),'image/png');return (await r.arrayBuffer()).byteLength===13?dataURL:'data:image/webp;base64,'+btoa('RIFF0000WEBPdefault');},fetcher:async url=>{
  calls.push(url);if(url.startsWith('https:'))throw Error('TEST ONLY no direct favicon');const generic=new URL(url).searchParams.get('pageUrl').includes('.invalid');return new Response(new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,...(generic?[0,0]:[0])]));
 }});
 assert.equal((await fetchIcon('https://news.kagi.com/world/latest')).source,'Chrome 网站图标');assert.equal(calls.length,2);assert.ok(calls.every(u=>u.startsWith('chrome-extension:')));
});

test('usable Chrome favicon never requests a website or needs host permission',async()=>{
 const calls=[],runtime={id:'test',getURL:p=>'chrome-extension://test'+p};
 const get=createBatchIconFetcher({runtime,permissions:{async contains(){assert.fail('Chrome cache must not need host permission');}},normalize:async r=>(await r.arrayBuffer()).byteLength===13?dataURL:'data:image/webp;base64,'+btoa('RIFF0000WEBPdefault'),fetcher:async url=>{calls.push(url);assert.ok(url.startsWith('chrome-extension:'));const empty=new URL(url).searchParams.get('pageUrl').includes('.invalid');return new Response(new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,...(empty?[0,0]:[0])]));}});
 assert.equal((await get('https://site.example/private?token=secret')).source,'Chrome 网站图标');assert.equal(calls.length,2);assert.ok(!calls.some(u=>u.includes('secret')));
});
test('missing Chrome icon never contacts an unauthorized website',async()=>{
 let calls=0;const get=createBatchIconFetcher({runtime:{getURL:p=>'chrome-extension://test'+p},permissions:{async contains(){return false;}},fetcher:async url=>{calls++;assert.ok(url.startsWith('chrome-extension:'));throw Error('missing cache');}});await assert.rejects(get('https://site.example/'),{code:'PERMISSION_REQUIRED'});assert.equal(calls,1);
});
