import test from 'node:test';
import assert from 'node:assert/strict';
import {bookmarkURL,createNavigationStore,exportNavigation,MAX_BACKUP_BYTES} from '../../extensions/chrome-kb/navigation.mjs';
import {createController} from '../../extensions/chrome-kb/controller.mjs';
function fixture() {
  const saved = {}; let serial=0;
  const storage={async get(key){return structuredClone({[key]:saved[key]});},async set(value){Object.assign(saved,structuredClone(value));},async remove(keys){for(const key of [keys].flat())delete saved[key];}};
  const handle=createController({storage,permissions:{},fetcher:()=>{throw Error('Local bookmarks must not access NAS');},revision:()=>`revision-${++serial}`});
  let state;
  return {saved,storage,handle,async read(){state=await handle({type:'navigation.get'});return state;},async change(type,args={}){state=await handle({type,...args,revision:state.revision});return state;},get state(){return state;}};
}
test('bookmarks are usable without NAS, persist across worker restarts and survive disconnect',async()=>{
  const f=fixture();await f.read();await f.change('bookmark.add',{title:' 本地网站 ',url:'example.com/docs?q=a#intro',groupId:'default'});
  const reopened=createNavigationStore({storage:f.storage});assert.equal((await reopened({type:'navigation.get'})).bookmarks[0].url,'https://example.com/docs?q=a#intro');
  await f.handle({type:'disconnect'});assert.equal((await f.read()).bookmarks[0].title,'本地网站');
});
test('URL validation rejects executable schemes and embedded credentials',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,abc','file:///etc/passwd','https://user:pass@example.com','https://','   '])assert.throws(()=>bookmarkURL(url));
  assert.equal(bookmarkURL('https://example.com/a#b'),'https://example.com/a#b');
});
test('deleting a group keeps its sites in the default group; default cannot be removed',async()=>{
  const f=fixture();await f.read();await f.change('group.add',{name:'工作'});const id=f.state.groups[1].id;
  await f.change('bookmark.add',{title:'文档',url:'https://example.com',groupId:id});
  await f.change('group.remove',{id});assert.equal(f.state.bookmarks[0].groupId,'default');assert.equal(f.state.groups.length,1);
  await assert.rejects(f.change('group.remove',{id:'default'}),{code:'NAVIGATION_INVALID'});
});
test('reorder is scoped to a group; edits can move sites between groups',async()=>{
  const f=fixture();await f.read();await f.change('group.add',{name:'阅读'});const group=f.state.groups[1].id;
  for(const [title,groupId]of [['A','default'],['B',group],['C','default']])await f.change('bookmark.add',{title,url:`https://${title}.example.com`,groupId});
  const c=f.state.bookmarks[2];await f.change('bookmark.move',{id:c.id,direction:-1});assert.deepEqual(f.state.bookmarks.map(s=>s.title),['C','B','A']);
  await f.change('bookmark.update',{id:c.id,title:'C 修改',url:'https://c.example.com',groupId:group});assert.equal(f.state.bookmarks[0].groupId,group);
  await f.change('group.move',{id:group,direction:-1});assert.equal(f.state.groups[0].id,group);
});
test('stale tab edits are rejected without losing the newer title or preferences',async()=>{
  const f=fixture();const initial=await f.read();await f.change('preferences.update',{changes:{showKnowledge:false}});
  await assert.rejects(f.handle({type:'group.add',name:'旧标签',revision:initial.revision}),{code:'NAVIGATION_CHANGED'});
  assert.equal((await f.read()).groups.length,1);assert.equal(f.state.preferences.showKnowledge,false);
});
test('invalid inputs and corrupt stored state never replace existing data',async()=>{
  const f=fixture();await f.read();await f.change('group.add',{name:'工作'});const before=structuredClone(f.saved);
  for(const [type,args]of [['group.add',{name:'工作'}],['bookmark.add',{title:'x',url:'https://example.com',groupId:'missing'}],['preferences.update',{changes:{token:'no'}}],['bookmark.move',{id:'missing',direction:3}]]) await assert.rejects(f.change(type,args));
  assert.deepEqual(f.saved,before);
  f.saved.navigation.version=99;await assert.rejects(f.read());assert.equal(f.saved.navigation.version,99);
});
test('backup import merges atomically, deduplicates URLs within groups and ignores foreign settings',async()=>{
  const f=fixture();await f.read();await f.change('bookmark.add',{title:'已有',url:'https://example.com',groupId:'default'});
  const backup={format:'kb-workspace-bookmarks',version:1,groups:[{id:'default',name:'常用'},{id:'docs',name:'文档'}],bookmarks:[{id:'a',title:'重复',url:'https://example.com/',groupId:'default'},{id:'b',title:'新网站',url:'https://docs.example.com',groupId:'docs'}],connection:{token:'must-not-import'}};
  await f.change('navigation.import',{backup});assert.equal(f.state.bookmarks.length,2);assert.equal(f.state.groups.length,2);assert.ok(!JSON.stringify(f.saved).includes('must-not-import'));
  await f.change('navigation.import',{backup});assert.equal(f.state.bookmarks.length,2);
  const before=structuredClone(f.saved);backup.bookmarks[1].url='javascript:alert(1)';await assert.rejects(f.change('navigation.import',{backup}));assert.deepEqual(f.saved,before);
});
test('a large exported backup remains importable, including multibyte titles',async()=>{
  const f=fixture();const data=await f.read();
  data.bookmarks=Array.from({length:600},(_,i)=>({id:`site-${i}`,title:'中文收藏'.repeat(20),url:`https://example.com/${i}?q=`+'a'.repeat(3900),groupId:'default'}));
  const backup=exportNavigation(data),bytes=new TextEncoder().encode(JSON.stringify(backup,null,2)).byteLength;
  assert.ok(bytes>2_000_000);assert.ok(bytes<MAX_BACKUP_BYTES);
  const imported=await f.change('navigation.import',{backup});assert.equal(imported.bookmarks.length,600);
});
test('export copies only known bookmark fields and never carries injected metadata',async()=>{
  const f=fixture();const data=await f.read();data.groups[0].token='private';data.bookmarks.push({id:'a',title:'文档',url:'https://example.com/',groupId:'default',secret:'private'});
  const output=JSON.stringify(exportNavigation(data));assert.ok(!output.includes('private'));
});

test('drag placement moves to any position and group, persists, and rejects stale or invalid targets atomically',async()=>{
  const f=fixture();await f.read();await f.change('group.add',{name:'目标'});const target=f.state.groups[1].id;
  for(const title of ['A','B','C'])await f.change('bookmark.add',{title,url:`https://${title}.example.com`,groupId:'default'});
  const [a,b,c]=f.state.bookmarks;
  await f.change('bookmark.place',{id:c.id,groupId:'default',beforeId:a.id});
  assert.deepEqual(f.state.bookmarks.map(x=>x.title),['C','A','B']);
  await f.change('bookmark.place',{id:a.id,groupId:target,beforeId:null});
  assert.equal(f.state.bookmarks.find(x=>x.id===a.id).groupId,target);
  await f.change('bookmark.place',{id:b.id,groupId:target,beforeId:a.id});
  assert.deepEqual(f.state.bookmarks.filter(x=>x.groupId===target).map(x=>x.title),['B','A']);
  const before=structuredClone(f.saved),revision=f.state.revision;
  for(const args of [{id:c.id,groupId:'missing',beforeId:null},{id:c.id,groupId:'default',beforeId:a.id},{id:c.id,groupId:'default',beforeId:c.id},{id:c.id,groupId:'default',beforeId:'missing'}])await assert.rejects(f.change('bookmark.place',args));
  assert.deepEqual(f.saved,before);
  await f.change('group.place',{id:'default',beforeId:null});assert.equal(f.state.groups.at(-1).id,'default');
  await assert.rejects(f.handle({type:'bookmark.place',id:c.id,groupId:target,beforeId:null,revision}),{code:'NAVIGATION_CHANGED'});
  const reopened=await createNavigationStore({storage:f.storage})({type:'navigation.get'});assert.deepEqual(reopened,f.state);
  assert.equal(reopened.bookmarks.length,3);
});
