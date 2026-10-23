import {legacyNavigation} from './fixtures/legacy-navigation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createController} from '../../extensions/chrome-kb/controller.mjs';
import {workspaceHash} from '../../extensions/chrome-kb/workspace.mjs';
const clone=structuredClone;
function backend(){
 const versions=new Map(),backups=new Map(),calls=[];let head=null,lose=false,gate=null,fork=false,loseBackup=false;
 const summary=r=>Object.fromEntries(['revision','parent_revision','device_id','device_name','content_hash','saved_at'].map(k=>[k,r[k]]));
 const fetcher=async(url,options)=>{const path=new URL(url);calls.push({path:path.pathname,method:options.method,body:options.body});const body=options.body?JSON.parse(options.body):null;
  if(path.pathname==='/api/status')return Response.json({ok:true,role:'human'});
  if(path.pathname==='/api/backups/chrome'&&options.method==='POST'){const key=body.device_id+'/'+body.backup_id,old=backups.get(key);if(old&&old.device_name!==body.device_name)return Response.json({ok:false,error:{code:'BACKUP_INVALID'}},{status:400});backups.set(key,clone(body));if(loseBackup){loseBackup=false;throw Error('backup ack lost');}if(gate?.kind==='backup'){gate.started();await gate.promise;}return Response.json({ok:true,saved:true,backup:{...body,saved_at:'2026-10-19T00:00:00Z'}});}
  if(path.pathname==='/api/workspace/chrome'){
   if(fork)return Response.json({ok:false,error:{code:'WORKSPACE_FORK'}},{status:409});
   if(options.method==='GET'){const current=clone(head),ack=versions.get(path.searchParams.get('request_id')),known=path.searchParams.get('known_revision'),unchanged=Boolean(current&&current.revision===known);return Response.json({ok:true,head:unchanged?summary(current):current,unchanged,acknowledged:ack?summary(ack):null});}
   if(options.method==='POST'){
    let r=versions.get(body.request_id);if(!r){backups.set(body.device_id+'/'+body.request_id,clone(body));if((head?.revision??null)!==body.base_revision)return Response.json({ok:false,error:{code:'WORKSPACE_CHANGED'}},{status:409});r={revision:body.request_id,parent_revision:body.base_revision,device_id:body.device_id,device_name:body.device_name,content_hash:await workspaceHash(body.payload),saved_at:'2026-10-19T00:00:00Z',payload:clone(body.payload)};head=clone(r);versions.set(r.revision,clone(r));}
    if(lose){lose=false;throw Error('lost acknowledgement');}return Response.json({ok:true,saved:true,revision:summary(r)});
   }
  }
  throw Error('unexpected path '+url);
 };
 return {fetcher,versions,backups,calls,get head(){return clone(head);},set lose(v){lose=v;},set loseBackup(v){loseBackup=v;},set fork(v){fork=v;},blockBackup(){let resolve,started;const promise=new Promise(r=>resolve=r),begin=new Promise(r=>started=r);gate={kind:'backup',promise,started};return {resolve,begin};}};
}
function device(server){const data={navigation:legacyNavigation()};let online=true,clock=100000,quota=false;
 const storage={async get(key){return clone({[key]:data[key]});},async set(values){if(quota&&values.navigation&&values.workspace)throw Error('quota failure');Object.assign(data,clone(values));},async remove(keys){for(const key of [keys].flat())delete data[key];}};
 const make=()=>createController({storage,permissions:{async contains(){return true;},async remove(){}},now:()=>clock,fetcher:async(...args)=>{if(!online)throw Error('offline');return server.fetcher(...args);}});let handle=make();
 return {data,async send(m){return handle(m);},async tick(){return handle.workspaceTick();},async connect(){return handle({type:'connect',server:'http://nas.test',token:'never-backup-this-token'});},restart(){handle=make();},advance(){clock+=2000000;},set online(v){online=v;},set quota(v){quota=v;}};
}
async function add(d,title){const v=await d.send({type:'navigation.get'});return d.send({type:'bookmark.add',revision:v.revision,title,url:'https://example.org/'+encodeURIComponent(title),groupId:'default'});}
async function sync(d){return d.send({type:'workspace.now'});}
async function pair(){const server=backend(),a=device(server),b=device(server);await a.connect();await b.connect();await add(a,'initial');await sync(a);await sync(b);return {server,a,b};}
async function conflict(){const f=await pair();await add(f.a,'A edit');await add(f.b,'B edit');await sync(f.a);await sync(f.b);return f;}
async function preview(d){return d.send({type:'workspace.preview',revision:d.data.connection.revision});}
async function resolve(d,p,choice){return d.send({type:'workspace.resolve',revision:d.data.connection.revision,confirm:true,choice,remoteRevision:p.remoteRevision,localHash:p.localHash,navigationRevision:p.navigationRevision,appearanceRevision:p.appearanceRevision});}
test('two independent devices automatically share bookmarks, groups, ordering and appearance without credentials',async()=>{
 const {server,a,b}=await pair();assert.equal(b.data.navigation.bookmarks[0].title,'initial');let n=await b.send({type:'navigation.get'});await b.send({type:'group.add',name:'Work',revision:n.revision});const app=await b.send({type:'appearance.get'});await b.send({type:'appearance.update',revision:app.revision,changes:{engine:'google',theme:'night'}});await b.tick();await a.tick();assert.equal(a.data.navigation.groups[1].name,'Work');assert.equal(a.data.appearance.engine,'google');assert.equal(a.data.appearance.theme,'night');assert.ok(!JSON.stringify(server.head.payload).includes('never-backup-this-token'));assert.ok(!JSON.stringify(server.head.payload).includes('nas.test'));
});
test('pristine devices wait for shared content without publishing an empty workspace',async()=>{
 const s=backend(),a=device(s);await a.connect();await a.tick();assert.equal(s.head,null);assert.equal(s.versions.size,0);await add(a,'new');await a.tick();assert.equal(s.head.payload.navigation.bookmarks.length,1);
});
test('offline editing and worker restart preserve data and resume upload then download',async()=>{
 const {a,b}=await pair();a.online=false;await add(a,'offline');await a.tick();assert.equal(a.data.workspace.error.code,'NETWORK_ERROR');a.restart();a.online=true;a.advance();await a.tick();await b.tick();assert.equal(b.data.navigation.bookmarks.at(-1).title,'offline');assert.equal((await b.send({type:'workspace.status'})).phase,'synced');
});
test('concurrent edits retain both versions, persist a conflict, and stop automatic overwrite',async()=>{
 const {server,a,b}=await conflict();assert.equal(b.data.workspace.conflict.kind,'data');assert.equal(b.data.navigation.bookmarks.at(-1).title,'B edit');assert.equal(a.data.navigation.bookmarks.at(-1).title,'A edit');assert.equal(server.head.payload.navigation.bookmarks.at(-1).title,'A edit');assert.ok([...server.backups.values()].some(v=>v.payload.navigation.bookmarks.at(-1)?.title==='B edit'));const calls=server.calls.length;b.restart();b.advance();await b.tick();assert.equal(server.calls.length,calls);
});
test('explicitly publishing local conflict creates a new version and other clean devices adopt it',async()=>{
 const {a,b}=await conflict(),p=await preview(b);await resolve(b,p,'local');await a.tick();assert.equal(a.data.navigation.bookmarks.at(-1).title,'B edit');assert.equal((await b.send({type:'workspace.status'})).phase,'synced');
});
test('accepting shared content first preserves the local proposal in backups',async()=>{
 const {server,a,b}=await conflict();const local=clone(b.data.navigation);await resolve(b,await preview(b),'remote');assert.deepEqual(b.data.navigation.bookmarks,a.data.navigation.bookmarks);assert.ok([...server.backups.values()].some(v=>JSON.stringify(v.payload.navigation.bookmarks)===JSON.stringify(local.bookmarks)));
});
test('stale preview detects local changes and newer remote revisions',async()=>{
 const {a,b}=await conflict(),p=await preview(b);await add(b,'new draft');await assert.rejects(resolve(b,p,'remote'),{code:'LOCAL_CHANGED'});const fresh=await preview(b);await add(a,'new remote');await sync(a);await assert.rejects(resolve(b,fresh,'local'),{code:'REMOTE_CHANGED'});assert.equal(b.data.navigation.bookmarks.at(-1).title,'new draft');
});
test('lost upload acknowledgement is recovered even after another device advances the shared head',async()=>{
 const {server,a,b}=await pair();await add(a,'saved without ack');server.lose=true;await a.tick();assert.ok(a.data.workspace.pending);await b.tick();await add(b,'later B edit');await b.tick();a.restart();a.advance();await a.tick();assert.equal(a.data.workspace.conflict,null);assert.equal(a.data.navigation.bookmarks.at(-1).title,'later B edit');assert.equal(a.data.workspace.pending,null);
});
test('editing while a protective backup is uploading cannot be overwritten by an incoming revision',async()=>{
 const {server,a,b}=await pair();await add(a,'remote');await a.tick();const gate=server.blockBackup(),reading=b.tick();await gate.begin;await add(b,'local while receiving');gate.resolve();await reading;assert.equal(b.data.navigation.bookmarks.at(-1).title,'local while receiving');assert.equal(b.data.workspace.error.code,'LOCAL_CHANGED');b.advance();await b.tick();assert.equal(b.data.workspace.conflict.kind,'data');
});
test('quota failure preserves canonical data and the previous common revision',async()=>{
 const {server,a,b}=await pair(),before=b.data.workspace.baseRevision;await add(a,'remote');await a.tick();b.quota=true;await b.tick();assert.equal(b.data.navigation.bookmarks.length,1);assert.equal(b.data.workspace.baseRevision,before);assert.ok(server.backups.size>0);
});
test('shared-history forks persist a pause until a successful explicit recheck',async()=>{
 const {server,a}=await pair();server.fork=true;await a.tick();assert.equal(a.data.workspace.conflict.kind,'history');a.restart();server.fork=false;await a.tick();assert.ok(a.data.workspace.conflict);await sync(a);assert.equal(a.data.workspace.conflict,null);
});
test('disabled shared sync leaves independent backup available; missing preview revisions are rejected',async()=>{
 const {server,a}=await pair();await a.send({type:'workspace.configure',enabled:false});await add(a,'unsynced');const before=server.versions.size;await a.tick();assert.equal(server.versions.size,before);await a.send({type:'backup.now'});assert.equal(a.data.backup.last!=null,true);await assert.rejects(a.send({type:'workspace.preview'}),{code:'CONNECTION_CHANGED'});
});
test('fingerprints are canonical across key ordering and include bookmark order',async()=>{
 assert.equal(await workspaceHash({z:1,a:{y:2,x:3}}),await workspaceHash({a:{x:3,y:2},z:1}));assert.notEqual(await workspaceHash([1,2]),await workspaceHash([2,1]));
});

test('renaming a device after an uncertain protection backup reuses its original backup metadata',async()=>{
 const {server,a,b}=await pair();await add(a,'new remote');await a.tick();server.loseBackup=true;await b.tick();assert.ok(b.data.workspace.incoming);await b.send({type:'backup.configure',enabled:true,deviceName:'Renamed device'});b.advance();await b.tick();assert.equal(b.data.navigation.bookmarks.at(-1).title,'new remote');assert.equal(b.data.workspace.error,null);
});

test('custom bookmark icons roundtrip through shared payloads and survive edits from the regular editor',async()=>{
 const {a,b}=await pair();let n=await a.send({type:'navigation.get'});const icon={mode:'text',text:'文档',color:'#2c756a'};
 await a.send({type:'bookmark.update',id:n.bookmarks[0].id,title:'带图标',url:n.bookmarks[0].url,groupId:'default',icon,revision:n.revision});await sync(a);await sync(b);assert.deepEqual(b.data.navigation.bookmarks[0].icon,icon);
 n=await b.send({type:'navigation.get'});await b.send({type:'bookmark.update',id:n.bookmarks[0].id,title:'普通表单改名',url:n.bookmarks[0].url,groupId:'default',revision:n.revision});await sync(b);await sync(a);assert.deepEqual(a.data.navigation.bookmarks[0].icon,icon);assert.equal(a.data.navigation.bookmarks[0].title,'普通表单改名');
});
