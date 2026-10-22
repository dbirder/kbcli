import test from 'node:test';
import assert from 'node:assert/strict';
import {createFaviconResponseStore,faviconRoute,parseFaviconRoute} from '../../extensions/chrome-kb/favicon-store.mjs';
const runtime={getURL:path=>new URL(path,'chrome-extension://kb-test/').href};
const ticket='11111111-1111-4111-8111-111111111111';
const detail=(extra={})=>({origin:'https://example.com',source:'chrome',epoch:1000,ticket,refresh:false,...extra});
function fixture(){
  const rows=new Map(),calls=[];let fail=false,failIndex=false;
  const cache={async match(k){return rows.get(typeof k==='string'?k:k.url)?.clone();},async put(k,v){if(failIndex&&k.includes('/index?'))throw Error('quota');rows.set(k,v.clone());},async delete(k){return rows.delete(typeof k==='string'?k:k.url);},async keys(){return [...rows.keys()].map(url=>new Request(url));}};
  const cacheStorage={async open(){return cache;}};
  const options={runtime,cacheStorage,allowed:async origin=>origin==='https://example.com',fetcher:async(url,opts)=>{calls.push({url,opts});return new Response(fail?'bad':'icon-'+calls.length,{status:fail?503:200});}};
  return {calls,options,store:createFaviconResponseStore(options),set offline(x){fail=x;},set quota(x){failIndex=x;}};
}
test('local icon route accepts only canonical HTTP origins and the exact extension host',()=>{
  const url=faviconRoute(runtime,'https://example.com/private?secret=1','site',detail());
  assert.deepEqual(parseFaviconRoute(url,runtime),detail({source:'site'}));
  assert.equal(parseFaviconRoute(url.replace('kb-test','other-extension'),runtime),null);
  assert.ok(!url.includes('secret'));assert.equal(parseFaviconRoute(url.replace('https%3A%2F%2Fexample.com','javascript%3Aalert(1)'),runtime),null);
});
test('validated image survives worker recreation without another source request',async()=>{
  const f=fixture(),d=detail();assert.equal(await (await f.store.respond(d)).text(),'icon-1');await f.store.settle({...d,missing:false});
  const reopened=createFaviconResponseStore(f.options);assert.equal(await (await reopened.respond(detail({ticket:'22222222-2222-4222-8222-222222222222',epoch:2000}))).text(),'icon-1');assert.equal(f.calls.length,1);
});
test('failed explicit refresh and failed index write keep the prior valid response',async()=>{
  const f=fixture(),d=detail({source:'site'});await f.store.respond(d);await f.store.settle({...d,missing:false});
  f.offline=true;const next=detail({source:'site',epoch:2000,refresh:true,ticket:'22222222-2222-4222-8222-222222222222'});await f.store.respond(next);assert.equal((await f.store.settle({...next,missing:true})).preserved,true);
  assert.equal(await (await f.store.respond(d)).text(),'icon-1');
  f.offline=false;f.quota=true;const later={...next,epoch:3000};await f.store.respond(later);assert.equal((await f.store.settle({...later,missing:false})).saved,false);assert.equal(await (await f.store.respond(d)).text(),'icon-1');
  assert.equal(f.calls[1].opts.credentials,'omit');assert.equal(f.calls[1].opts.mode,'no-cors');assert.equal(f.calls[1].opts.cache,'reload');
});
test('older candidates cannot replace a newer icon and a saved site icon is preferred over default lookup',async()=>{
  const f=fixture(),older=detail({source:'site'}),newer=detail({source:'site',epoch:2000,ticket:'22222222-2222-4222-8222-222222222222'});
  await f.store.respond(older);await f.store.respond(newer);await f.store.settle({...newer,missing:false});assert.equal((await f.store.settle({...older,missing:false})).preserved,true);
  assert.equal(await (await f.store.respond(detail())).text(),'icon-2');assert.equal(f.calls.length,2);
});
test('missing icons stay negative-cached and unsaved origins never trigger a network request',async()=>{
  const f=fixture(),d=detail();await f.store.respond(d);await f.store.settle({...d,missing:true});assert.equal((await f.store.respond(d)).status,404);assert.equal(f.calls.length,1);
  assert.equal((await f.store.respond({...d,origin:'https://unknown.example'})).status,404);assert.equal(f.calls.length,1);
});
