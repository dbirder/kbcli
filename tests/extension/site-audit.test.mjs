import test from 'node:test';
import assert from 'node:assert/strict';
import {createController} from '../../extensions/chrome-kb/controller.mjs';
import {probeSite,auditOrigin,auditRequestURL,AUDIT_LEASE,knownAuditRedirect} from '../../extensions/chrome-kb/site-audit.mjs';
const response=(code=200,body='<title>正常网站</title>',url='https://site.example/')=>{const r=new Response(body,{status:code,headers:{'Content-Type':'text/html'}});Object.defineProperty(r,'url',{value:url});return r;};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture({fetcher=async()=>response(),allowed=true}={}){
 let counter=0,clock=1000;const saved={},calls=[];
 const storage={async get(key){return structuredClone({[key]:saved[key]});},async set(value){Object.assign(saved,structuredClone(value));},async remove(key){delete saved[key];}};
 const create=()=>createController({storage,permissions:{async contains({origins}){return typeof allowed==='function'?allowed(origins):allowed;}},fetcher:async(...args)=>{calls.push(args);return fetcher(...args);},now:()=>clock,revision:()=>`r${++counter}`});let handle=create();
 return {saved,storage,calls,get handle(){return handle;},restart(){handle=create();},advance(ms){clock+=ms;},async seed(count=1){let n=await handle({type:'navigation.get'});for(let i=0;i<count;i++)n=await handle({type:'bookmark.add',revision:n.revision,title:'网站'+i,url:`https://site.example/${i}`,groupId:'default'});return n;},async start(){const n=await handle({type:'navigation.get'});return (await handle({type:'audit.start',revision:n.revision})).job;},async state(){return (await handle({type:'audit.get'})).job;}};
}
test('probe uses GET without credentials, preserves routes, bounds body, separates HTTP errors and access restrictions',async()=>{
 for(const [code,status]of [[200,'ok'],[401,'restricted'],[403,'restricted'],[429,'restricted'],[404,'httpError'],[503,'httpError']]){
  const result=await probeSite('https://site.example/path?q=1#part',{fetcher:async(url,options)=>{assert.equal(url,'https://site.example/path?q=1');assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.cache,'no-store');assert.ok(options.signal);return response(code);}});assert.equal(result.status,status);
 }
 assert.equal((await probeSite('https://site.example/',{fetcher:async()=>response(200,'<title>Just a moment...</title>')})).status,'restricted');
 assert.equal((await probeSite('https://site.example/',{fetcher:async()=>response(200,'','https://other.example/new?token=secret')})).finalURL,'https://other.example/new');
 assert.equal((await probeSite('https://site.example/',{fetcher:async()=>response(200,'','https://other.example/')})).status,'redirect');
 assert.equal((await probeSite('https://site.example/',{fetcher:async()=>response(200,'','https://www.site.example/')})).status,'ok');
});
test('probe distinguishes timeout from generic network errors without inventing certificate diagnoses',async()=>{
 assert.equal((await probeSite('https://site.example/',{fetcher:async()=>{throw Error('secret detail');}})).status,'restricted');
 const keepAlive=setTimeout(()=>{},1000);
 try{assert.equal((await probeSite('https://site.example/',{timeout:5,fetcher:async(_,o)=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true}))})).status,'timeout');}finally{clearTimeout(keepAlive);}
});
test('temporary session parameters only check root and are never replayed; invalid protocols rejected',()=>{
 assert.deepEqual(auditRequestURL('https://site.example/path?pass_ticket=private#anchor'),{url:'https://site.example/',scope:'仅检查站点入口（原链接含临时会话参数）'});
 assert.equal(auditOrigin('http://192.168.1.2:9000/a'),'http://192.168.1.2/*');assert.throws(()=>auditOrigin('javascript:alert(1)'));
});
test('manual start only, four concurrent requests, results persist, second tab cannot duplicate the run',async()=>{
 const gate=deferred();let active=0,max=0;const f=fixture({fetcher:async()=>{active++;max=Math.max(max,active);await gate.promise;active--;return response();}});await f.seed(6);assert.equal(f.calls.length,0);assert.equal(await f.handle.auditTick(),false);
 const job=await f.start();await assert.rejects(f.start(),{code:'AUDIT_CHANGED'});const tick=f.handle.auditTick();await new Promise(setImmediate);assert.equal(f.calls.length,4);assert.equal(await f.handle.auditTick(),false);assert.equal(max,4);
 // Network never holds the bookmark mutation lane.
 let n=await f.handle({type:'navigation.get'});await f.handle({type:'bookmark.update',revision:n.revision,...n.bookmarks[5],title:'仍可编辑'});
 gate.resolve();await tick;await f.handle.auditTick();assert.equal((await f.state()).state,'completed');assert.equal(f.calls.length,6);
 f.restart();assert.equal((await f.state()).id,job.id);assert.equal((await f.state()).rows.filter(r=>r.status==='ok').length,6);assert.equal(await f.handle.auditTick(),false);assert.equal(f.calls.length,6);
});
test('worker suspension reclaims expired persisted claims and does not duplicate a live lease',async()=>{
 const f=fixture();await f.seed();await f.start();const row=f.saved.siteAudit.rows[0];row.status='checking';row.lease=1000+AUDIT_LEASE;row.claim='old';f.restart();assert.equal(await f.handle.auditTick(),false);assert.equal(f.calls.length,0);
 f.advance(AUDIT_LEASE+1);await f.handle.auditTick();assert.equal((await f.state()).state,'completed');assert.equal(f.calls.length,1);
});
test('stop keeps completed results, late old responses cannot change a newer run',async()=>{
 const gate=deferred(),f=fixture({fetcher:async()=>{await gate.promise;return response();}});await f.seed();const old=await f.start(),tick=f.handle.auditTick();await new Promise(setImmediate);
 await f.handle({type:'audit.stop',runId:old.id});assert.equal((await f.state()).rows[0].status,'cancelled');const next=await f.start();gate.resolve();await tick;assert.equal((await f.state()).id,next.id);assert.equal((await f.state()).rows[0].status,'pending');
});
test('permissions revoked or bookmark URL edited before request are skipped, never silently checked',async()=>{
 const f=fixture({allowed:false});await f.seed();await f.start();await f.handle.auditTick();assert.equal(f.calls.length,0);assert.equal((await f.state()).rows[0].status,'skipped');
 const g=fixture();let n=await g.seed();await g.start();await g.handle({type:'bookmark.update',revision:n.revision,...n.bookmarks[0],url:'https://changed.example/'});await g.handle.auditTick();assert.equal(g.calls.length,0);assert.equal((await g.state()).state,'completed');
});
test('batch delete is explicit, atomic, version checked, preserves all other data and can undo exactly',async()=>{
 const f=fixture({fetcher:async()=>response(404)}),original=await f.seed(3),job=await f.start();await f.handle.auditTick();let n=await f.handle({type:'navigation.get'});
 await assert.rejects(f.handle({type:'audit.delete',runId:job.id,revision:'old',ids:[n.bookmarks[0].id]}),{code:'AUDIT_CHANGED'});assert.equal((await f.handle({type:'navigation.get'})).bookmarks.length,3);
 const snapshot=structuredClone(f.saved.navigation),set=f.storage.set;f.storage.set=async()=>{throw Error('disk full');};await assert.rejects(f.handle({type:'audit.delete',runId:job.id,revision:n.revision,ids:[n.bookmarks[0].id]}));assert.deepEqual(f.saved.navigation,snapshot);f.storage.set=set;
 const result=await f.handle({type:'audit.delete',runId:job.id,revision:n.revision,ids:[n.bookmarks[0].id,n.bookmarks[2].id]});assert.equal(result.deleted,2);n=await f.handle({type:'navigation.get'});assert.deepEqual(n.bookmarks,[original.bookmarks[1]]);assert.deepEqual(n.groups,original.groups);assert.deepEqual(n.preferences,original.preferences);assert.equal((await f.handle({type:'audit.get'})).canUndo,true);
 await f.handle({type:'audit.undo'});assert.deepEqual((await f.handle({type:'navigation.get'})).bookmarks,original.bookmarks);assert.equal((await f.handle({type:'audit.get'})).canUndo,false);
});
test('healthy or changed URLs cannot be deleted via an old report; undo cannot overwrite later edits',async()=>{
 const f=fixture();let n=await f.seed();const job=await f.start();await f.handle.auditTick();await assert.rejects(f.handle({type:'audit.delete',runId:job.id,revision:n.revision,ids:[n.bookmarks[0].id]}),{code:'AUDIT_CHANGED'});
 const g=fixture({fetcher:async()=>response(503)});n=await g.seed(2);const run=await g.start();await g.handle.auditTick();n=await g.handle({type:'bookmark.update',revision:n.revision,...n.bookmarks[0],url:'https://new.example/'});await assert.rejects(g.handle({type:'audit.delete',runId:run.id,revision:n.revision,ids:[n.bookmarks[0].id]}),{code:'AUDIT_CHANGED'});
 await g.handle({type:'audit.delete',runId:run.id,revision:n.revision,ids:[n.bookmarks[1].id]});n=await g.handle({type:'navigation.get'});await g.handle({type:'preferences.update',revision:n.revision,changes:{compact:true}});await assert.rejects(g.handle({type:'audit.undo'}),{code:'AUDIT_CHANGED'});
});

test('restricted, legacy network failure, timeout and redirect cannot enter batch deletion',async()=>{
 const f=fixture();let n=await f.seed();const job=await f.start();await f.handle.auditTick();
 for(const status of ['restricted','networkError','timeout','redirect']){f.saved.siteAudit.rows[0].status=status;await assert.rejects(f.handle({type:'audit.delete',runId:job.id,revision:n.revision,ids:[n.bookmarks[0].id]}),{code:'AUDIT_CHANGED'});assert.deepEqual(f.saved.navigation,n);}
});
test('known redirect grant is explicit, retry checks only the selected original URL and preserves bookmarks',async()=>{
 const grants=new Set(['https://site.example/*','https://labs.google/*']);const f=fixture({allowed:origins=>origins.every(o=>grants.has(o)),fetcher:async url=>{assert.equal(url,'https://labs.google/fx/zh/tools/flow');if(!grants.has('https://flow.google.com/*'))throw Error('CORS');return response(200,'<title>Flow</title>','https://flow.google.com/');}});
 let n=await f.seed();n=await f.handle({type:'bookmark.update',revision:n.revision,...n.bookmarks[0],url:'https://labs.google/fx/zh/tools/flow'});const job=await f.start();await f.handle.auditTick();assert.equal((await f.state()).rows[0].permissionTarget,'https://flow.google.com/');
 await assert.rejects(f.handle({type:'audit.retry',runId:job.id,id:n.bookmarks[0].id}),{code:'PERMISSION_REQUIRED'});assert.equal(f.calls.length,1);
 grants.add('https://flow.google.com/*');await f.handle({type:'audit.retry',runId:job.id,id:n.bookmarks[0].id});await f.handle.auditTick();assert.equal((await f.state()).rows[0].status,'redirect');assert.equal(f.calls.length,2);assert.deepEqual(f.saved.navigation,n);
});
test('known redirect hints reject lookalike origins and login pages stay under review',async()=>{
 for(const u of ['https://labs.google.attacker.example/fx/zh/tools/flow','https://console.cloud.google.com.evil/x','https://u:p@codecv.top/x','http://codecv.top/profile','data:text/html,x','not a URL'])assert.equal(knownAuditRedirect(u),null);
 assert.equal(knownAuditRedirect('https://codecv.top:443/profile'),'https://www.codecvcv.com/');
 const r=await probeSite('https://console.cloud.google.com/welcome',{fetcher:async()=>response(200,'<title>Login</title>','https://accounts.google.com/ServiceLogin?continue=private')});assert.equal(r.status,'restricted');assert.ok(!r.finalURL.includes('private'));
});
