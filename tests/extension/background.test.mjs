import {legacyNavigation} from './fixtures/legacy-navigation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const hash='sha256:'+'a'.repeat(64),id='50a7f8da-c1b6-4d48-8d7f-c8b51a2523cd';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
let serial=0;
async function worker(t,{accessFails=false}={}) {
  const originalChrome=globalThis.chrome,originalFetch=globalThis.fetch,originalAdd=globalThis.addEventListener,data={navigation:legacyNavigation()},listeners={},calls=[];let block=false;
  const started=deferred(),release=deferred();
  t.after(()=>{globalThis.chrome=originalChrome;globalThis.fetch=originalFetch;globalThis.addEventListener=originalAdd;release.resolve();});
  globalThis.addEventListener=(type,handler)=>{listeners[type]=handler;};
  globalThis.fetch=async(url,options)=>{
    calls.push({url,method:options.method});
    if(url.includes("/api/workspace/chrome")&&options.method==="GET")return Response.json({ok:true,head:null,acknowledged:null});
    if(url.endsWith('/tasks')&&options.method==='GET'){
      if(block){started.resolve();await release.promise;}
      return Response.json({ok:true,tasks:[{id,file_hash:hash,title:'待办',status:'todo',tags:[]}]});
    }
    return Response.json(url.endsWith('/status')?{ok:true,role:'human'}:url.endsWith('/autosync')?{ok:true,state:'idle'}:{ok:true,file_hash:hash});
  };
  globalThis.chrome={
    runtime:{id:'kb-test',getURL:path=>'chrome-extension://kb-test/'+path,onMessage:{addListener:handler=>listeners.message=handler},onStartup:{addListener:handler=>listeners.startup=handler},onInstalled:{addListener:handler=>listeners.installed=handler}},
    action:{onClicked:{addListener:handler=>listeners.action=handler}},tabs:{async create(){}},
    permissions:{async contains(){return true;},async remove(){}},
    alarms:{onAlarm:{addListener:handler=>listeners.alarm=handler},async get(){return {};},async create(){}},
    storage:{onChanged:{addListener:handler=>listeners.changed=handler},local:{async setAccessLevel(){if(accessFails)throw Error('private storage failure');},async get(key){return structuredClone({[key]:data[key]});},async set(value){Object.assign(data,structuredClone(value));},async remove(keys){for(const key of [keys].flat())delete data[key];}}}
  };
  await import(new URL('../../extensions/chrome-kb/background.mjs?test='+serial++,import.meta.url).href);
  const sender={id:'kb-test',url:'chrome-extension://kb-test/newtab.html'};
  const send=message=>new Promise(resolve=>assert.equal(listeners.message(message,sender,resolve),true));
  return {send,listeners,sender,started,release,calls,block(){block=true;},data};
}
test('worker registers handlers, rejects URL-prefix spoofing and reports malformed messages',async t=>{
  const f=await worker(t);assert.equal(f.listeners.action,undefined);for(const event of ['startup','installed','alarm','changed'])assert.equal(typeof f.listeners[event],'function');
  assert.equal(f.listeners.message({type:'connection'},{...f.sender,url:f.sender.url+'.evil'},()=>assert.fail('Unexpected response')),false);
  assert.equal((await f.send(null)).error.code,'MESSAGE_INVALID');
  assert.equal((await f.send({type:'navigation.get'})).ok,true);
});
test('popup is an exact trusted page with a limited message allowlist',async t=>{
 const f=await worker(t),sender={...f.sender,url:'chrome-extension://kb-test/popup.html'};
 const response=await new Promise(resolve=>assert.equal(f.listeners.message({type:'capture.load',context:'tab-test'},sender,resolve),true));assert.equal(response.ok,true);
 for(const url of [sender.url+'.evil','https://evil.example/popup.html'])assert.equal(f.listeners.message({type:'navigation.get'},{...sender,url},()=>{}),false);
 for(const type of ['connect','backup.restore','appearance.update','create','bookmark.remove'])assert.equal(f.listeners.message({type},sender,()=>{}),false);
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

test('alarm invokes shared workspace polling without a new-tab page',async t=>{
  const f=await worker(t);await f.send({type:'connect',server:'http://nas.test',token:'test'});const before=f.calls.length;f.listeners.alarm({name:'kb-workspace-backup'});await new Promise(setImmediate);await f.send({type:'workspace.status'});assert.ok(f.calls.slice(before).some(c=>c.method==='GET'&&c.url.includes('/api/workspace/chrome')));
});


test('worker has no legacy favicon fetch route or result endpoint',async t=>{
 const f=await worker(t);assert.equal(f.listeners.fetch,undefined);
 assert.equal((await f.send({type:'favicon.result'})).error.code,'MESSAGE_INVALID');
 assert.equal(f.calls.length,0);
});

test('actual worker runs the manual audit and rejects audit operations from popup',async t=>{
 const f=await worker(t);let n=(await f.send({type:'navigation.get'})).data;
 n=(await f.send({type:'bookmark.add',revision:n.revision,title:'TEST ONLY audit',url:'https://audit.example/',groupId:'default'})).data;
 assert.equal(f.calls.length,0);const started=await f.send({type:'audit.start',revision:n.revision});assert.equal(started.ok,true);
 let state;for(let i=0;i<50;i++){state=(await f.send({type:'audit.get'})).data.job;if(state.state==='completed')break;await new Promise(setImmediate);}
 assert.equal(state.state,'completed');assert.equal(state.rows[0].status,'ok');assert.equal(f.calls.filter(c=>c.url==='https://audit.example/').length,1);assert.deepEqual((await f.send({type:'navigation.get'})).data,n);
 const popup={...f.sender,url:'chrome-extension://kb-test/popup.html'};for(const type of ['audit.start','audit.delete','audit.undo'])assert.equal(f.listeners.message({type},popup,()=>assert.fail('popup audit access')),false);
});

test('manual icon batch reaches a terminal result in worker and remains blocked from popup',async t=>{
 const f=await worker(t);let n=(await f.send({type:'navigation.get'})).data;n=(await f.send({type:'bookmark.add',revision:n.revision,title:'TEST ONLY batch',url:'https://icon.example/path?secret=test',groupId:'default'})).data;assert.equal(f.calls.length,0);
 assert.equal((await f.send({type:'icons.start',revision:n.revision,replaceCustom:false})).ok,true);let job;for(let i=0;i<50;i++){job=(await f.send({type:'icons.get'})).data.job;if(job.state==='completed')break;await new Promise(setImmediate);}assert.equal(job.state,'completed');assert.equal(job.rows[0].status,'failed');assert.deepEqual((await f.send({type:'navigation.get'})).data,n);
 const popup={...f.sender,url:'chrome-extension://kb-test/popup.html'};for(const type of ['icons.start','icons.stop','icons.get'])assert.equal(f.listeners.message({type},popup,()=>assert.fail('Unexpected icon batch access')),false);
});
