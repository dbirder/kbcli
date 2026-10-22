import test from 'node:test';
import assert from 'node:assert/strict';
import {createController} from '../../extensions/chrome-kb/controller.mjs';
import {fetchCaptureImage} from '../../extensions/chrome-kb/capture.mjs';
import {validateBookmarkIcon} from '../../extensions/chrome-kb/bookmark-icon.mjs';
import {exportNavigation,createNavigationStore} from '../../extensions/chrome-kb/navigation.mjs';
const op='c0bd9258-17b1-41aa-a21f-3677494af6f2',text={mode:'text',text:'文档',color:'#2c756a'},image={mode:'image',dataURL:'data:image/webp;base64,'+btoa('RIFF0000WEBPtest'),sourceURL:'https://images.example/logo.webp'};
function fixture(){const data={};let serial=0,failCleanup=false;const storage={async get(key){return structuredClone({[key]:data[key]});},async set(value){if(failCleanup&&value.quickCapture){failCleanup=false;throw Error('test quota');}Object.assign(data,structuredClone(value));},async remove(){}};const make=()=>createController({storage,permissions:{},revision:()=>`r${++serial}`});let handle=make();return {data,storage,send:m=>handle(m),restart(){handle=make();},failCleanup(){failCleanup=true;}};}
const draft=(sequence,title='草稿')=>({operationId:op,sequence,title});
async function save(f,{id=null,icon=text,url='https://example.org/docs?q=1#part',title='文档',revision}={}){return f.send({type:'capture.save',context:'91|page',operationId:op,revision:revision??(await f.send({type:'navigation.get'})).revision,bookmark:{id,title,url,groupId:'default',icon}});}
test('drafts survive popup and worker restart, are scoped, bounded and ignore out-of-order edits',async()=>{
 const f=fixture();await f.send({type:'capture.draft',context:'91|page',draft:draft(2,'最新')});await f.send({type:'capture.draft',context:'91|page',draft:draft(1,'旧输入')});f.restart();assert.equal((await f.send({type:'capture.load',context:'91|page'})).draft.title,'最新');assert.equal((await f.send({type:'capture.load',context:'92|page'})).draft,null);
 for(let i=0;i<15;i++)await f.send({type:'capture.draft',context:'test'+i,draft:draft(1)});assert.equal(f.data.quickCapture.drafts.length,10);
});
test('captured create uses a stable id; retries after lost response or cleanup failure cannot duplicate',async()=>{
 const f=fixture();await f.send({type:'capture.draft',context:'91|page',draft:draft(1)});const initial=await f.send({type:'navigation.get'});f.failCleanup();await assert.rejects(save(f,{revision:initial.revision}));assert.equal(f.data.navigation.bookmarks.length,1);const revision=f.data.navigation.revision;f.restart();const result=await save(f,{revision:initial.revision});assert.equal(result.siteId,op);assert.equal(result.navigation.revision,revision);assert.equal(result.navigation.bookmarks.length,1);assert.equal((await f.send({type:'capture.load',context:'91|page'})).draft,null);assert.equal(result.navigation.bookmarks[0].url,'https://example.org/docs?q=1#part');
});
test('capture edits keep id, custom icons and ordering; stale modified data is never overwritten',async()=>{
 const f=fixture();const first=await save(f);const before=first.navigation.revision;await save(f,{id:op,icon:image,title:'新名称'});await assert.rejects(save(f,{id:op,title:'过时名称',revision:before}),{code:'NAVIGATION_CHANGED'});assert.equal(f.data.navigation.bookmarks[0].title,'新名称');assert.deepEqual(f.data.navigation.bookmarks[0].icon,image);
 await f.send({type:'bookmark.update',id:op,title:'旧表单改名',url:'https://example.org/',groupId:'default',revision:f.data.navigation.revision});assert.deepEqual(f.data.navigation.bookmarks[0].icon,image);
});
test('duplicate URL is rejected across groups without altering existing data',async()=>{
 const f=fixture();await save(f);const before=structuredClone(f.data.navigation);await assert.rejects(f.send({type:'capture.save',context:'another',operationId:'31c83109-dd42-42c1-8a6d-9cc4523faf23',revision:before.revision,bookmark:{title:'重复',url:before.bookmarks[0].url,groupId:'default'}}),{code:'BOOKMARK_EXISTS'});assert.deepEqual(f.data.navigation,before);
});
test('icon validation blocks executable data, credentials, invalid colors, extra fields and oversized data',()=>{
 assert.deepEqual(validateBookmarkIcon(text),text);assert.deepEqual(validateBookmarkIcon(image),image);
 for(const icon of [{mode:'text',text:'三个字',color:'#2c756a'},{...text,color:'red'},{...text,token:'secret'},{...image,dataURL:'data:image/svg+xml;base64,AA=='},{...image,sourceURL:'https://user:secret@x.test/a'},{...image,dataURL:image.dataURL+'A'.repeat(33000)}])assert.throws(()=>validateBookmarkIcon(icon));
});
test('per-bookmark images and text survive export, import and store restart without unknown metadata',async()=>{
 const f=fixture();await save(f,{icon:image});f.data.navigation.bookmarks[0].secret='never-export';const backup=exportNavigation(f.data.navigation);assert.ok(!JSON.stringify(backup).includes('never-export'));assert.deepEqual(backup.bookmarks[0].icon,image);
 const other=fixture();await other.send({type:'navigation.import',revision:'initial',backup});const n=await createNavigationStore({storage:other.storage})({type:'navigation.get'});assert.deepEqual(n.bookmarks[0].icon,image);
});
test('image fetch needs explicit origin permission and never sends cookies or referrer',async()=>{
 let calls=0,options;const env={permissions:{async contains(){return false;}},fetcher:async(_,o)=>{calls++;options=o;return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}});}};
 await assert.rejects(fetchCaptureImage({url:'https://img.test/icon.png'},env),{code:'PERMISSION_REQUIRED'});assert.equal(calls,0);env.permissions.contains=async()=>true;const r=await fetchCaptureImage({url:'https://img.test/icon.png'},env);assert.ok(r.dataURL.startsWith('data:image/png;base64,'));assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.redirect,'error');
 env.fetcher=async()=>new Response('html',{headers:{'content-type':'text/html'}});await assert.rejects(fetchCaptureImage({url:'https://img.test/icon.png'},env),{code:'IMAGE_UNAVAILABLE'});
 env.fetcher=async()=>new Response(new Uint8Array(2*1024*1024+1),{headers:{'content-type':'image/png'}});await assert.rejects(fetchCaptureImage({url:'https://img.test/icon.png'},env),{code:'IMAGE_UNAVAILABLE'});
});
test('tab image access is bound to the captured page and uses only the internal favicon service',async()=>{
 const calls=[],env={tabs:{async get(){return {url:'https://page.test/docs?q=1'};}},runtime:{getURL:path=>'chrome-extension://test'+path},fetcher:async(url)=>{calls.push(url);return new Response(new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13]),{headers:{'content-type':'image/png'}});}};
 await assert.rejects(fetchCaptureImage({source:'tab',tabId:1,pageURL:'https://other.test/'},env),{code:'TAB_CHANGED'});assert.equal(calls.length,0);await fetchCaptureImage({source:'tab',tabId:1,pageURL:'https://page.test/docs?q=1'},env);assert.ok(calls[0].startsWith('chrome-extension://test/_favicon/'));
});

test('legacy duplicates in different groups can still be edited without creating another bookmark',async()=>{
 const f=fixture();await save(f);let n=f.data.navigation;await f.send({type:'group.add',name:'旧分组',revision:n.revision});n=f.data.navigation;
 await f.send({type:'bookmark.add',title:'旧重复',url:n.bookmarks[0].url,groupId:n.groups[1].id,revision:n.revision});
 const edited=await save(f,{id:op,title:'原收藏的新名字'});assert.equal(edited.navigation.bookmarks.length,2);assert.equal(edited.navigation.bookmarks[0].title,'原收藏的新名字');
});
test('excessive embedded icon totals reject an import atomically',async()=>{
 const f=fixture(),n=await f.send({type:'navigation.get'}),dataURL='data:image/webp;base64,'+btoa('RIFF0000WEBP'+'x'.repeat(24000));
 const backup={format:'kb-workspace-bookmarks',version:1,groups:n.groups,bookmarks:Array.from({length:40},(_,i)=>({id:'test'+i,title:'图标',url:'https://example.org/'+i,groupId:'default',icon:{mode:'image',dataURL}}))};
 await assert.rejects(f.send({type:'navigation.import',revision:n.revision,backup}),{code:'NAVIGATION_INVALID'});assert.equal(f.data.navigation,undefined);
});

test('Chrome favicon without Content-Type is accepted by binary signature, external responses remain strict',async()=>{
 const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13]),env={runtime:{getURL:p=>'chrome-extension://test'+p},permissions:{async contains(){return true;}},fetcher:async()=>new Response(png)};
 for(const type of [null,'application/octet-stream','text/plain']){
  env.fetcher=async()=>new Response(png,type?{headers:{'content-type':type}}:undefined);
  const result=await fetchCaptureImage({source:'website',pageURL:'https://news.kagi.com/world/latest'},env);assert.equal(result.dataURL,'data:image/png;base64,'+btoa(String.fromCharCode(...png)));
  await assert.rejects(fetchCaptureImage({url:'https://img.test/no-mime'},env),{code:'IMAGE_UNAVAILABLE'});
 }
 env.fetcher=async()=>new Response('<html>Not an image</html>',{headers:{'content-type':'image/png'}});await assert.rejects(fetchCaptureImage({source:'website',pageURL:'https://news.kagi.com/'},env),{code:'IMAGE_UNAVAILABLE'});
 env.fetcher=async()=>new Response(new Uint8Array(2*1024*1024+1));await assert.rejects(fetchCaptureImage({source:'website',pageURL:'https://news.kagi.com/'},env),{code:'IMAGE_UNAVAILABLE'});
});
