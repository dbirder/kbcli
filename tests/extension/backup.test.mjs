import test from 'node:test';
import assert from 'node:assert/strict';
import {createController} from '../../extensions/chrome-kb/controller.mjs';
const device='6cf5fae0-9a6e-42d1-8a3e-2186f10a5488';
function fixture(){
 const data={},calls=[],saved=new Map();let online=true,clock=100000,serial=0,ambiguous=false,gate=null,quota=false,undoGate=null;
 const storage={async get(key){return structuredClone({[key]:data[key]});},async set(value){if(value.backupUndo&&undoGate){undoGate.started();await undoGate.promise;}if(quota&&value.backupUndo)throw Error('quota');Object.assign(data,structuredClone(value));},async remove(keys){for(const key of [keys].flat())delete data[key];}};
 const permissions={async contains(){return true;},async remove(){}};
 const fetcher=async(url,options)=>{calls.push({url,options});if(!online)throw Error('offline');if(url.endsWith('/status'))return Response.json({ok:true,role:'human'});
 if(options.method==='POST'){const body=JSON.parse(options.body);saved.set(body.backup_id,{...body,saved_at:new Date(clock).toISOString()});if(gate){gate.started();await gate.promise;}if(ambiguous){ambiguous=false;throw Error('lost ack');}return Response.json({ok:true,saved:true,backup:saved.get(body.backup_id)});}
 const backup=saved.get(url.split('/').at(-1));return Response.json({ok:true,backup});};
 const make=()=>createController({storage,permissions,fetcher,now:()=>clock,revision:()=>`r${++serial}`});let handle=make();
 return {data,calls,saved,storage,async send(m){return handle(m);},async connect(){await handle({type:'connect',server:'http://nas.test',token:'private-owner-token'});},async tick(){return handle.backupTick();},async changed(){return handle.backupChanged();},restart(){handle=make();},advance(ms=60000){clock+=ms;},set online(v){online=v;},set ambiguous(v){ambiguous=v;},set quota(v){quota=v;},blockUndo(){let resolve,started;const promise=new Promise(r=>resolve=r),begin=new Promise(r=>started=r);undoGate={promise,started};return {resolve,begin};},block(){let resolve,started;const promise=new Promise(r=>resolve=r),begin=new Promise(r=>started=r);gate={promise,started};return {resolve,begin};}};
}
async function add(f,title='离线收藏'){const n=await f.send({type:'navigation.get'});return f.send({type:'bookmark.add',revision:n.revision,title,url:'https://example.org/',groupId:'default'});}
test('immutable backup only copies known public fields, stable device identity survives restart',async()=>{
 const f=fixture();await f.connect();await add(f);const s=await f.send({type:'backup.now'});assert.equal(s.pendingChanges,false);const body=JSON.parse(f.calls.find(c=>c.options.method==='POST').options.body);assert.equal(body.payload.navigation.bookmarks.length,1);assert.ok(!JSON.stringify(body).includes('private-owner-token'));assert.ok(!JSON.stringify(body).includes('http://nas.test'));assert.equal(body.payload.appearance.theme,'mist');
 f.restart();const after=await f.send({type:'backup.status'});assert.equal(after.deviceId,s.deviceId);await f.tick();assert.equal(f.saved.size,1);
});
test('offline changes persist, restart recovers latest state and ambiguous saves reuse the same id',async()=>{
 const f=fixture();await f.connect();f.online=false;await add(f);await f.tick();assert.ok(f.data.backup.pending);const id=f.data.backup.pending.backupId;
 f.restart();f.online=true;f.ambiguous=true;f.advance();await f.tick();assert.equal(f.saved.size,1);assert.equal(f.data.backup.pending.backupId,id);f.advance(120000);await f.tick();assert.equal(f.saved.size,1);assert.equal(f.data.backup.pending,null);
});
test('new local changes during upload remain pending and do not block bookmarks',async()=>{
 const f=fixture();await f.connect();await add(f,'one');const gate=f.block();const upload=f.tick();await gate.begin;await add(f,'two');gate.resolve();await upload;assert.equal((await f.send({type:'backup.status'})).pendingChanges,true);f.advance();await f.tick();assert.equal(f.saved.size,2);assert.equal([...f.saved.values()].at(-1).payload.navigation.bookmarks.length,2);
});
test('manual restore requires preview versions, keeps current device and credentials, and supports local undo',async()=>{
 const f=fixture();await f.connect();await add(f,'source');await f.send({type:'backup.now'});const first=[...f.saved.values()][0],originalDevice=f.data.backup.deviceId;first.device_id=device;
 await add(f,'local');const selection={deviceId:device,backupId:first.backup_id,revision:f.data.connection.revision};const p=await f.send({type:'backup.preview',...selection});
 const restore={type:'backup.restore',...selection,navigationRevision:p.navigationRevision,appearanceRevision:p.appearanceRevision,confirm:true};
 await assert.rejects(f.send({...restore,confirm:false}),{code:'CONFIRM_REQUIRED'});await f.send(restore);assert.equal(f.data.navigation.bookmarks.length,1);assert.equal(f.data.backup.deviceId,originalDevice);assert.equal(f.data.connection.token,'private-owner-token');assert.equal(f.data.backupUndo.payload.navigation.bookmarks.length,2);
 await f.send({type:'backup.undo',navigationRevision:f.data.navigation.revision,appearanceRevision:f.data.appearance.revision});assert.equal(f.data.navigation.bookmarks.length,2);
});
test('stale preview, changed connection and rollback quota failures preserve local data',async()=>{
 const f=fixture();await f.connect();await add(f);await f.send({type:'backup.now'});const first=[...f.saved.values()][0],selection={deviceId:first.device_id,backupId:first.backup_id,revision:f.data.connection.revision};const p=await f.send({type:'backup.preview',...selection});await add(f,'later');
 const m={type:'backup.restore',...selection,navigationRevision:p.navigationRevision,appearanceRevision:p.appearanceRevision,confirm:true};await assert.rejects(f.send(m),{code:'LOCAL_CHANGED'});
 const fresh=await f.send({type:'backup.preview',...selection});f.quota=true;await assert.rejects(f.send({...m,navigationRevision:fresh.navigationRevision,appearanceRevision:fresh.appearanceRevision}));assert.equal(f.data.navigation.bookmarks.length,2);
 await assert.rejects(f.send({...m,revision:'old'}),{code:'CONNECTION_CHANGED'});
});
test('disabled automatic backup leaves manual backup available, newer offline edits supersede an older outbox',async()=>{
 const f=fixture();await f.connect();await f.send({type:'backup.configure',enabled:false,deviceName:'工作电脑'});await add(f);await f.tick();assert.equal(f.saved.size,0);await f.send({type:'backup.now'});assert.equal(f.saved.size,1);
 await f.send({type:'backup.configure',enabled:true,deviceName:'工作电脑'});f.online=false;await add(f,'old');await f.tick();const id=f.data.backup.pending.backupId;await add(f,'new');f.restart();f.online=true;f.advance();await f.tick();assert.notEqual(f.data.backup.last.backupId,id);assert.equal([...f.saved.values()].at(-1).payload.navigation.bookmarks.length,3);
});

test('debounce uses persisted timestamps across worker restarts',async()=>{
 const f=fixture();await f.connect();await f.send({type:'backup.now'});await add(f);await f.changed();f.restart();await f.tick();assert.equal(f.saved.size,1);f.advance(31000);await f.tick();assert.equal(f.saved.size,2);
});

test('backup list and preview require a displayed connection revision',async()=>{
 const f=fixture();await f.connect();await assert.rejects(f.send({type:'backup.list'}),{code:'CONNECTION_CHANGED'});await assert.rejects(f.send({type:'backup.preview',deviceId:device,backupId:device}),{code:'CONNECTION_CHANGED'});
});

test('connection replacement waits for an in-progress local restore transaction',async()=>{
 const f=fixture();await f.connect();await add(f);await f.send({type:'backup.now'});const first=[...f.saved.values()][0],selection={deviceId:first.device_id,backupId:first.backup_id,revision:f.data.connection.revision};await add(f,'local later');const p=await f.send({type:'backup.preview',...selection});const gate=f.blockUndo();const restoring=f.send({type:'backup.restore',...selection,navigationRevision:p.navigationRevision,appearanceRevision:p.appearanceRevision,confirm:true});await gate.begin;
 const changing=f.send({type:'connect',server:'http://other.test',token:'other-owner',revision:selection.revision});await new Promise(setImmediate);assert.equal(f.data.connection.server,'http://nas.test');gate.resolve();await restoring;await changing;assert.equal(f.data.connection.server,'http://other.test');assert.equal(f.data.navigation.bookmarks.length,1);
});
