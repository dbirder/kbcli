import assert from 'node:assert/strict';
// Loopback fixture only: writes synthetic navigation, never real Chrome data.
export async function verifySpringFolders({page:p,baseURL,screenshotDirectory}){
 assert.match(baseURL,/^http:\/\/127\.0\.0\.1:\d+$/);
 await p.cdp('Network.setCacheDisabled',{cacheDisabled:true});
 await p.cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await p.goto(baseURL);await p.waitForSelector('.folder-button');
 await p.evaluate(()=>{
  const groups=[{id:'default',name:'常用'},{id:'source',name:'源分组'},{id:'target',name:'目标分组'},{id:'empty',name:'空分组'},{id:'other',name:'其他分组'}],bookmarks=[];
  for(const [groupId,count]of [['source',8],['target',40],['other',4]])for(let i=0;i<count;i++)bookmarks.push({id:groupId+'-'+i,title:groupId+' 网站 '+(i+1),url:location.origin+'/sample/'+groupId+'/'+i,groupId});
  localStorage.setItem('kb-test-navigation',JSON.stringify({version:1,revision:crypto.randomUUID(),groups,bookmarks,preferences:{openInNewTab:true,showKnowledge:false,compact:false}}));
 });
 await p.reload();await p.waitForSelector('.folder-button');
 const wait=async(fn,arg)=>{let timer;try{await Promise.race([p.waitForFunction(fn,arg,{timeout:6000}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timed out: '+String(fn))),12000);})]);}finally{clearTimeout(timer);}};
 const trace=async text=>console.log(text);
 const nav=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('kb-test-navigation')));
 const point=selector=>p.evaluate(selector=>{const b=document.querySelector(selector).getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};},selector);
 async function move(pos){await p.mouse.move(pos.x,pos.y);}
 async function start(){
  if(await p.evaluate(()=>document.querySelector('#folder-dialog').open))await p.click('[data-close="folder-dialog"]');
  await p.click('.folder-button[aria-label*="源分组"]');
  const id=await p.evaluate(()=>document.querySelector('#folder-sites .site-card').dataset.siteId),a=await point('#folder-sites .site-icon');
  await move(a);await p.mouse.down();await move({x:a.x+16,y:a.y});await wait(()=>document.body.classList.contains('sorting'));
  const b=await p.evaluate(()=>{const r=document.querySelector('#folder-dialog').getBoundingClientRect();return{x:r.right+15,y:r.top+40};});await move(b);await wait(()=>document.body.classList.contains('home-drop-active'));return id;
 }
 async function hover(id){await move(await point(`.folder-tile[data-group-id="${id}"]`));}
 async function opened(name){await wait(name=>!document.querySelector('#spring-folder').hidden&&document.querySelector('#spring-title').textContent===name,name);}
 async function released(){await p.mouse.up();await wait(()=>!document.body.classList.contains('sorting'));}
 await trace('spring test: middle');const id=await start();await hover('target');await opened('目标分组');
 assert.equal(await p.evaluate(()=>document.querySelector('#folder-sites .sort-chosen').isConnected),true);
 let a=await point('#spring-sites [data-site-id="target-2"]');await move({x:a.x-35,y:a.y});await wait(()=>!document.querySelector('#spring-insertion').hidden);
 if(screenshotDirectory)await p.screenshot({path:screenshotDirectory+'/chrome-kb-091-spring.png'});
 await released();await wait(id=>JSON.parse(localStorage.getItem('kb-test-navigation')).bookmarks.find(b=>b.id===id).groupId==='target',id);
 assert.deepEqual((await nav()).bookmarks.filter(b=>b.groupId==='target').slice(0,4).map(b=>b.id),['target-0','target-1',id,'target-2']);
 assert.equal(await p.evaluate(()=>document.querySelector('#folder-dialog').open),true);
 // Fast pass over one folder must not leave a delayed open behind.
 await trace('spring test: fast pass and Escape');await start();const rev=(await nav()).revision;await hover('target');await hover('other');await opened('其他分组');await move(await point('#spring-scroll'));await p.keyboard.press('Escape');await released();
 assert.equal((await nav()).revision,rev);assert.equal(await p.evaluate(()=>document.querySelector('#folder-title').textContent),'源分组');
 // Scroll only the target list and append after its last actual site.
 await trace('spring test: scroll and tail');const tailId=await start();await hover('target');await opened('目标分组');
 const edge=await p.evaluate(()=>{const r=document.querySelector('#spring-scroll').getBoundingClientRect();return{x:r.x+r.width/2,y:r.bottom-8};});
 const background=await p.evaluate(()=>document.querySelector('#collection-scroll').scrollTop);
 await move(edge);await wait(()=>document.querySelector('#spring-scroll').scrollTop>100);
 await p.cdp('Input.dispatchMouseEvent',{type:'mouseWheel',x:edge.x,y:edge.y,deltaX:0,deltaY:2000});await wait(()=>{const s=document.querySelector('#spring-scroll');return s.scrollTop+s.clientHeight>=s.scrollHeight-2;});
 a=await point('#spring-sites .site-card:last-child');await move({x:a.x+35,y:a.y});await released();await wait(id=>JSON.parse(localStorage.getItem('kb-test-navigation')).bookmarks.filter(b=>b.groupId==='target').at(-1).id===id,tailId);
 assert.equal(await p.evaluate(()=>document.querySelector('#collection-scroll').scrollTop),background);
 // Empty destination has one insertion point.
 await trace('spring test: empty');const emptyId=await start();await hover('empty');await opened('空分组');await move(await point('#spring-scroll'));await released();await wait(id=>JSON.parse(localStorage.getItem('kb-test-navigation')).bookmarks.find(b=>b.id===id).groupId==='empty',emptyId);
 assert.equal((await nav()).bookmarks.find(b=>b.id===emptyId).groupId,'empty');
 // Leave the expanded list, choose another folder, then cancel on its header.
 await trace('spring test: exit and header');await start();const cancelled=(await nav()).revision;await hover('target');await opened('目标分组');await move(await point('#spring-scroll'));
 const outside=await p.evaluate(()=>{const r=document.querySelector('#folder-dialog').getBoundingClientRect();return{x:r.right+15,y:r.top+40};});await move(outside);await wait(()=>document.querySelector('#spring-folder').hidden);
 await hover('other');await opened('其他分组');await move(await point('#spring-title'));await released();assert.equal((await nav()).revision,cancelled);
 // A normal quick drop still appends and never opens after the gesture ends.
 await trace('spring test: quick drop');const quickId=await start();await hover('other');await released();await p.waitForTimeout(750);
 assert.equal((await nav()).bookmarks.filter(b=>b.groupId==='other').at(-1).id,quickId);
 assert.equal(await p.evaluate(()=>document.querySelector('#spring-folder').hidden&&!document.querySelector('#folder-dialog').open),true);
 // Conflict after preview opens must preserve the newer navigation.
 await trace('spring test: conflict');await start();await hover('target');await opened('目标分组');await move(await point('#spring-scroll'));
 const fresh=await p.evaluate(()=>{const n=JSON.parse(localStorage.getItem('kb-test-navigation'));n.revision=crypto.randomUUID();n.groups[0].name='并发更新保留';localStorage.setItem('kb-test-navigation',JSON.stringify(n));return n.revision;});
 await released();await wait(()=>document.querySelector('#toast').textContent.includes('其他标签页更新'));
 assert.equal((await nav()).revision,fresh);assert.equal((await nav()).bookmarks.length,52);
 assert.equal(await p.evaluate(()=>document.querySelector('#spring-folder').hidden),true);
 return {middle:'insert before third; target stays open',cancel:'fast pass, Escape, preview exit and header cancellation',scroll:'target edge scroll and append; homepage stays fixed',empty:'insert into empty folder',quick:'immediate drop remains supported, no delayed reopen',conflict:'new revision preserved',total:52};
}
