import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError, createClient, normalizeServer, permissionOrigin, validateTask, taskChanges} from '../../extensions/chrome-kb/api.mjs';
import {createController} from '../../extensions/chrome-kb/controller.mjs';
const hash = 'sha256:'+'a'.repeat(64), id='50a7f8da-c1b6-4d48-8d7f-c8b51a2523cd';
function fixture() {
  const data={}, grants=new Set(), calls=[];let online=true, role='human', conflict=false;
  const storage={async get(key){return structuredClone({[key]:data[key]});},async set(value){Object.assign(data,structuredClone(value));},async remove(keys){for(const key of [keys].flat()) delete data[key];}};
  const permissions={async contains({origins}){return origins.every(x=>grants.has(x));},async remove({origins}){origins.forEach(x=>grants.delete(x));}};
  const fetcher=async (url,options)=>{calls.push({url,options});if(!online)throw Error('disconnected'); if(conflict&&options.method==='PATCH') return Response.json({ok:false,error:{code:'FILE_CHANGED'}},{status:409});
    const path=new URL(url).pathname;
    if(options.method!=='GET')return Response.json({ok:true,saved:true,file_hash:hash});
    return Response.json(path.endsWith('/status')?{ok:true,role,content:{records:5}}:path.endsWith('/tasks')?{ok:true,tasks:[{id,title:'测试待办',status:'todo',file_hash:hash}]}:{ok:true,state:'idle'});
  };
  const handle=createController({storage,permissions,fetcher,revision:()=>String(calls.length),now:()=>1234});
  return {handle,data,calls,grants,storage,fetcher,set online(v){online=v;},set role(v){role=v;},set conflict(v){conflict=v;}};
}
async function connect(f){f.grants.add('http://nas.test/*');await f.handle({type:'connect',server:'http://nas.test:8765/',token:'local-only-user-token'});return f.handle({type:'snapshot'});}
test('server validation rejects embedded credentials and non-HTTP schemes',()=>{
  assert.equal(normalizeServer(' http://nas.test:8765/kb/ '),'http://nas.test:8765/kb');assert.equal(permissionOrigin('http://nas.test:8765'),'http://nas.test/*');
  for(const url of ['file:///etc','https://user:password@host','javascript:alert(1)','https://host/#token','https://host/?token=x'])assert.throws(()=>normalizeServer(url),ApiError);
});
test('task validation handles real dates, tags, due clearing and completion isolation',()=>{
  assert.throws(()=>validateTask({title:'  '}));assert.throws(()=>validateTask({title:'a',due:'2026-02-30'}));
  assert.deepEqual(validateTask({title:' a ',due:'',tags:'工作，工作,阅读'}).tags,['工作','阅读']);
  assert.deepEqual(taskChanges({title:'a',due:'2026-10-18',tags:[],status:'todo'},{title:'a',due:'',tags:[],status:'todo'}),{due:null});
  assert.throws(()=>taskChanges({title:'a',status:'todo'},{title:'a',status:'done'}));
});
test('connection needs scoped host access and a user identity; token never leaves public snapshots',async()=>{
  const f=fixture();await assert.rejects(f.handle({type:'connect',server:'http://nas.test:8765',token:'x'}),{code:'PERMISSION_REQUIRED'});
  const value=await connect(f);assert.equal(value.writable,true);assert.ok(!JSON.stringify(value).includes('local-only-user-token'));
  f.role='ai';await assert.rejects(f.handle({type:'connect',server:'http://nas.test:8765',token:'agent',revision:value.connection.revision}),{code:'USER_TOKEN_REQUIRED'});
  assert.equal(f.data.connection.token,'local-only-user-token');
});
test('network failure keeps timestamped cache read-only and never retries writes',async()=>{
  const f=fixture();const initial=await connect(f);f.online=false;
  const cached=await f.handle({type:'snapshot'});assert.equal(cached.writable,false);assert.equal(cached.resources.tasks.fetchedAt,1234);assert.equal(cached.resources.tasks.data.tasks.length,1);
  await assert.rejects(f.handle({type:'complete',id,hash,revision:initial.connection.revision}),{code:'REFRESH_REQUIRED'});
  f.online=true;await f.handle({type:'snapshot'});f.online=false;
  const before=f.calls.length;await assert.rejects(f.handle({type:'create',task:{title:'uncertain'},revision:initial.connection.revision}),{code:'NETWORK_ERROR',writeUncertain:true});assert.equal(f.calls.length,before+1);
});
test('writes carry the displayed full hash; stale edits fail instead of overwriting',async()=>{
  const f=fixture();const state=await connect(f);
  await f.handle({type:'complete',id,hash,revision:state.connection.revision});
  const sent=f.calls.find(x=>x.options.method==='PATCH');assert.deepEqual(JSON.parse(sent.options.body),{expect_hash:hash,changes:{status:'done'}});
  f.conflict=true;await assert.rejects(f.handle({type:'update',id,hash,changes:{title:'draft'},revision:state.connection.revision}),{code:'FILE_CHANGED'});
  await assert.rejects(f.handle({type:'complete',id,hash,revision:'old-tab'}),{code:'CONNECTION_CHANGED'});
});
test('changing server requires a new token and disconnect clears credentials and cache',async()=>{
  const f=fixture();await connect(f);
  f.grants.add('http://other.test/*');await assert.rejects(f.handle({type:'connect',server:'http://other.test',token:'',revision:f.data.connection.revision}),{code:'TOKEN_REQUIRED'});
  await f.handle({type:'disconnect',revision:f.data.connection.revision});assert.deepEqual(f.data,{});assert.equal(f.grants.size,1);
});
test('credentials are not sent across redirects; backend error messages are not echoed',async()=>{
  let options;const api=createClient({server:'https://nas.test',token:'private'},async(_,o)=>{options=o;return Response.json({ok:false,error:{code:'UNKNOWN',message:'secret debug token'}},{status:500});});
  await assert.rejects(api('/api/tasks'),error=>!error.message.includes('secret'));
  assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
});
test('a server error after a write remains an uncertain result',async()=>{
  const api=createClient({server:'http://nas.test',token:'local'},async()=>Response.json({ok:false,error:{code:'INTERNAL'}},{status:500}));
  await assert.rejects(api('/api/tasks',{method:'POST',body:{title:'x'}}),{writeUncertain:true});
});
