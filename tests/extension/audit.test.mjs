import {legacyNavigation} from './fixtures/legacy-navigation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createController} from '../../extensions/chrome-kb/controller.mjs';
import {createClient,errorValue} from '../../extensions/chrome-kb/api.mjs';
const id='50a7f8da-c1b6-4d48-8d7f-c8b51a2523cd',hash='sha256:'+'a'.repeat(64);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture() {
  const data={navigation:legacyNavigation()},calls=[];let serial=0,title='原待办',gate=null,malformed=false;
  const storage={async get(key){return structuredClone({[key]:data[key]});},async set(value){Object.assign(data,structuredClone(value));},async remove(keys){for(const key of [keys].flat())delete data[key];}};
  const fetcher=async(url,options)=>{
    calls.push(options.method+' '+new URL(url).pathname);
    if(options.method==='PATCH'){title='新待办';return Response.json({ok:true,file_hash:hash});}
    if(url.endsWith('/tasks')){const value=malformed?'broken':[{id,title,status:'todo',tags:[],file_hash:hash}];if(gate){const wait=gate;gate=null;wait.started.resolve();await wait.release.promise;}return Response.json({ok:true,tasks:value});}
    return Response.json(url.endsWith('/status')?{ok:true,role:'human'}:{ok:true,state:'idle'});
  };
  const handle=createController({storage,permissions:{async contains(){return true;},async remove(){}},fetcher,revision:()=>`r${++serial}`});
  return {handle,data,calls,set malformed(value){malformed=value;},block(){gate={started:deferred(),release:deferred()};return gate;},async connect(){await handle({type:'connect',server:'http://nas.test',token:'test'});return handle({type:'snapshot'});}};
}
test('slow NAS writes do not block local bookmarks',async()=>{
  const f=fixture(),snapshot=await f.connect(),gate=f.block();
  const refresh=f.handle({type:'snapshot'});await gate.started.promise;
  const save=f.handle({type:'update',id,hash,changes:{title:'new'},revision:snapshot.connection.revision});
  const initial=await f.handle({type:'navigation.get'});
  const local=await f.handle({type:'group.add',name:'离线工作',revision:initial.revision});
  assert.equal(local.groups.length,2);
  gate.release.resolve();await Promise.all([refresh,save]);
  assert.equal(f.data.snapshot.resources.tasks.data.tasks[0].title,'新待办');
});
test('concurrent local writes reject the stale revision instead of silently losing one',async()=>{
  const f=fixture(),initial=await f.handle({type:'navigation.get'});
  const results=await Promise.allSettled(['A','B'].map(name=>f.handle({type:'group.add',name,revision:initial.revision})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'NAVIGATION_CHANGED');
});
test('snapshot requests are coalesced; an older read cannot overwrite a completed write',async()=>{
  const f=fixture(),initial=await f.connect(),gate=f.block();
  const older=f.handle({type:'snapshot'});await gate.started.promise;
  const second=f.handle({type:'snapshot'}),before=f.calls.filter(x=>x==='GET /tasks').length;
  await new Promise(setImmediate);assert.equal(f.calls.filter(x=>x==='GET /tasks').length,before);
  const write=f.handle({type:'update',id,hash,changes:{title:'新待办'},revision:initial.connection.revision});
  gate.release.resolve();await Promise.all([older,second,write]);
  assert.equal(f.data.snapshot.resources.tasks.data.tasks[0].title,'新待办');
});
test('connection edits and task writes require the displayed connection revision',async()=>{
  const f=fixture(),initial=await f.connect();
  await assert.rejects(f.handle({type:'create',task:{title:'x'}}),{code:'CONNECTION_CHANGED'});
  await assert.rejects(f.handle({type:'connect',server:'http://other.test',token:'test',revision:'stale'}),{code:'CONNECTION_CHANGED'});
  await assert.rejects(f.handle({type:'disconnect',revision:'stale'}),{code:'CONNECTION_CHANGED'});
  assert.equal(f.data.connection.revision,initial.connection.revision);
});
test('malformed successful task data keeps previous cache read-only',async()=>{
  const f=fixture();await f.connect();f.malformed=true;
  const next=await f.handle({type:'snapshot'});
  assert.equal(next.writable,false);assert.equal(next.resources.tasks.stale,true);
  assert.equal(next.resources.tasks.error.code,'RESPONSE_INVALID');
  assert.equal(next.resources.tasks.data.tasks[0].title,'原待办');
});
test('non-object JSON is a response error; HTTP status survives the worker envelope',async()=>{
  const api=createClient({server:'http://nas.test',token:'private'},async()=>Response.json(null));
  await assert.rejects(api('/api/status'),{code:'RESPONSE_INVALID'});
  assert.equal(errorValue({code:'HTTP_404',message:'missing',httpStatus:404}).httpStatus,404);
});
test('a malformed write acknowledgement stays uncertain and is never replayed',async()=>{
  const f=fixture();const initial=await f.connect();
  // Connect/status are valid; POST is deliberately answered by the generic malformed ack.
  const before=f.calls.length;
  await assert.rejects(f.handle({type:'create',task:{title:'new'},revision:initial.connection.revision}),{code:'RESPONSE_INVALID',writeUncertain:true});
  assert.equal(f.calls.length,before+1);assert.equal(f.data.snapshot.resources.tasks.stale,true);
});
