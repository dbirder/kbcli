import test from 'node:test';
import assert from 'node:assert/strict';
const hash='sha256:'+'a'.repeat(64),id='50a7f8da-c1b6-4d48-8d7f-c8b51a2523cd';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
let serial=0;
async function worker(t,{accessFails=false}={}) {
  const originalChrome=globalThis.chrome,originalFetch=globalThis.fetch,data={},listeners={};let block=false;
  const started=deferred(),release=deferred();
  t.after(()=>{globalThis.chrome=originalChrome;globalThis.fetch=originalFetch;release.resolve();});
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/tasks')&&options.method==='GET'){
      if(block){started.resolve();await release.promise;}
      return Response.json({ok:true,tasks:[{id,file_hash:hash,title:'待办',status:'todo',tags:[]}]});
    }
    return Response.json(url.endsWith('/status')?{ok:true,role:'human'}:url.endsWith('/autosync')?{ok:true,state:'idle'}:{ok:true,file_hash:hash});
  };
  globalThis.chrome={
    runtime:{id:'kb-test',getURL:path=>'chrome-extension://kb-test/'+path,onMessage:{addListener:handler=>listeners.message=handler}},
    action:{onClicked:{addListener:handler=>listeners.action=handler}},tabs:{async create(){}},
    permissions:{async contains(){return true;},async remove(){}},
    storage:{local:{async setAccessLevel(){if(accessFails)throw Error('private storage failure');},async get(key){return structuredClone({[key]:data[key]});},async set(value){Object.assign(data,structuredClone(value));},async remove(keys){for(const key of [keys].flat())delete data[key];}}}
  };
  await import(new URL('../../extensions/chrome-kb/background.mjs?test='+serial++,import.meta.url).href);
  const sender={id:'kb-test',url:'chrome-extension://kb-test/newtab.html'};
  const send=message=>new Promise(resolve=>assert.equal(listeners.message(message,sender,resolve),true));
  return {send,listeners,sender,started,release,block(){block=true;},data};
}
test('worker registers handlers, rejects URL-prefix spoofing and reports malformed messages',async t=>{
  const f=await worker(t);assert.equal(typeof f.listeners.action,'function');
  assert.equal(f.listeners.message({type:'connection'},{...f.sender,url:f.sender.url+'.evil'},()=>assert.fail('Unexpected response')),false);
  assert.equal((await f.send(null)).error.code,'MESSAGE_INVALID');
  assert.equal((await f.send({type:'navigation.get'})).ok,true);
});
test('actual worker keeps bookmark lane available while a NAS mutation waits',async t=>{
  const f=await worker(t);await f.send({type:'connect',server:'http://nas.test',token:'test'});const initial=(await f.send({type:'snapshot'})).data;
  f.block();const saving=f.send({type:'complete',id,hash,revision:initial.connection.revision});await f.started.promise;
  let responded=false;const local=f.send({type:'navigation.get'});void local.then(()=>responded=true);
  try {await new Promise(setImmediate);assert.equal(responded,true);}
  finally {f.release.resolve();await saving;await local;}
});
test('storage initialization failure is reported without accessing user data',async t=>{
  const f=await worker(t,{accessFails:true});const response=await f.send({type:'navigation.get'});
  assert.equal(response.ok,false);assert.equal(response.error.code,'STORAGE_UNAVAILABLE');assert.ok(!JSON.stringify(response).includes('private storage failure'));
});
