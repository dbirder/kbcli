import test from 'node:test';
import assert from 'node:assert/strict';
import {createLegacyIconReader} from '../../extensions/chrome-kb/icon-snapshots.mjs';
import {createController} from '../../extensions/chrome-kb/controller.mjs';
import {fallbackBookmarkIcon} from '../../extensions/chrome-kb/bookmark-icon.mjs';
import {fetchCaptureImage} from '../../extensions/chrome-kb/capture.mjs';
const dataURL='data:image/webp;base64,'+btoa('RIFF0000WEBPtest');
const image={mode:'auto',dataURL},BASE='https://kb-favicon-cache.invalid/';
function oldCache(){const rows=new Map();let opens=0;return {rows,get opens(){return opens;},cacheStorage:{async keys(){return ['kb-favicons-v1'];},async open(){opens++;return {async match(key){const v=rows.get(key);return v instanceof Response?v.clone():v;}};}},add(source,body,origin='https://example.org'){const index=BASE+'index?'+new URLSearchParams({origin,source}),key=BASE+'data?'+new URLSearchParams({origin,source,ticket:'old',epoch:'1'});rows.set(index,Response.json({missing:false,epoch:1,body:key}));rows.set(key,body);}};}
function fixture(readLegacyIcon){const data={navigation:{version:1,revision:'old',groups:[{id:'default',name:'常用'}],bookmarks:[{id:'old-site',title:'旧收藏',url:'https://example.org/docs',groupId:'default'}],preferences:{openInNewTab:true,showKnowledge:false,compact:false}}};let rev=0;const storage={async get(key){return structuredClone({[key]:data[key]});},async set(v){Object.assign(data,structuredClone(v));},async remove(){}};const make=()=>createController({storage,permissions:{},readLegacyIcon,revision:()=>`r${++rev}`});return {data,storage,make,handle:make()};}
test('legacy adapter snapshots only readable local bytes and shares one decode across a site origin',async t=>{
 const f=oldCache();f.add('chrome',new Response('cached png'));let decodes=0,requests=0;const previous=globalThis.fetch;globalThis.fetch=async()=>{requests++;throw Error('network forbidden');};t.after(()=>globalThis.fetch=previous);
 const read=createLegacyIconReader({cacheStorage:f.cacheStorage,normalize:async response=>{decodes++;assert.equal(await response.text(),'cached png');return dataURL;}});
 assert.deepEqual(await read('https://example.org/private?token=secret'),image);assert.deepEqual(await read('https://example.org/other'),image);assert.equal(decodes,1);assert.equal(requests,0);
});
test('opaque or broken entries never trigger a source request; readable Chrome cache is preserved',async()=>{
 const f=oldCache();f.add('site',{ok:false,type:'opaque'});f.add('chrome',new Response('chrome'));
 const read=createLegacyIconReader({cacheStorage:f.cacheStorage,normalize:async response=>{assert.equal(await response.text(),'chrome');return dataURL;}});assert.deepEqual(await read('https://example.org'),image);
 f.rows.clear();assert.equal(await createLegacyIconReader({cacheStorage:f.cacheStorage})('https://example.org'),null);
 const absent={async keys(){return [];},async open(){assert.fail('Must not create a cache on an empty profile');}};assert.equal(await createLegacyIconReader({cacheStorage:absent})('https://example.org'),null);
});
test('frozen images survive controller restart and old cache eviction without another lookup',async()=>{
 let reads=0;const f=fixture(async()=>{reads++;return image;});await f.handle.freezeIcons();const saved=structuredClone(f.data.navigation);assert.deepEqual(saved.bookmarks[0].icon,image);
 await f.make().freezeIcons();assert.equal(reads,1);assert.deepEqual(f.data.navigation,saved);
 const n=await f.handle({type:'bookmark.update',id:'old-site',title:'只改名称',url:'https://other.example/',groupId:'default',revision:saved.revision});assert.deepEqual(n.bookmarks[0].icon,image);
});
test('a missing old image becomes a fixed text snapshot and is never retried',async()=>{
 let attempts=0;const f=fixture(async()=>{attempts++;throw Error('missing cache');});await f.handle.freezeIcons();assert.deepEqual(f.data.navigation.bookmarks[0].icon,fallbackBookmarkIcon('旧收藏','https://example.org/docs'));
 await f.make().freezeIcons();assert.equal(attempts,1);
});
test('migration never replaces an existing manual icon and respects the embedded-image quota',async()=>{
 const large={mode:'auto',dataURL:'data:image/webp;base64,'+btoa('RIFF0000WEBP'+'x'.repeat(23000))};let calls=0;const f=fixture(async()=>{calls++;return large;});f.data.navigation.bookmarks=[{...f.data.navigation.bookmarks[0],id:'manual',icon:{mode:'text',text:'自定',color:'#2c756a'}},...Array.from({length:40},(_,i)=>({id:'old'+i,title:'旧收藏',url:`https://site${i}.example/`,groupId:'default'}))];
 await f.handle.freezeIcons();assert.equal(calls,40);assert.equal(f.data.navigation.bookmarks[0].icon.text,'自定');assert.ok(f.data.navigation.bookmarks.slice(1).some(s=>s.icon.mode==='text'));assert.ok(f.data.navigation.bookmarks.reduce((n,s)=>n+(s.icon.dataURL?.length||0),0)<=1024*1024);
});
test('out-of-band concurrent edits abort legacy conversion instead of overwriting newer data',async()=>{
 let release,started;const gate=new Promise(r=>release=r),begin=new Promise(r=>started=r);const f=fixture(async()=>{started();await gate;return image;});const pending=f.handle.freezeIcons();await begin;f.data.navigation.revision='newer';f.data.navigation.bookmarks[0].title='较新的名称';release();await assert.rejects(pending,{code:'NAVIGATION_CHANGED'});assert.equal(f.data.navigation.bookmarks[0].title,'较新的名称');assert.equal(f.data.navigation.bookmarks[0].icon,undefined);
});
test('new sites and icon-less imports persist text once; routine edits preserve that snapshot',async()=>{
 const f=fixture(async()=>null);let n=await f.handle({type:'navigation.get'});n=await f.handle({type:'bookmark.add',title:'新收藏',url:'https://new.example/a?q=1',groupId:'default',revision:n.revision});const site=n.bookmarks.at(-1),icon=site.icon;assert.equal(icon.mode,'text');n=await f.handle({type:'bookmark.update',id:site.id,title:'改名不改图标',url:'https://new.example/a?q=1',groupId:'default',revision:n.revision});assert.deepEqual(n.bookmarks.at(-1).icon,icon);
});
test('creation lookup uses the local Chrome service and never sends private URL paths',async()=>{
 const calls=[],env={runtime:{getURL:path=>'chrome-extension://test'+path},fetcher:async url=>{calls.push(url);return new Response(new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13]),{headers:{'content-type':'image/png'}});}};
 await fetchCaptureImage({source:'website',pageURL:'https://example.org/private?secret=1#part'},env);assert.equal(calls.length,1);assert.equal(new URL(calls[0]).searchParams.get('pageUrl'),'https://example.org/');assert.ok(!calls[0].includes('secret'));
});
