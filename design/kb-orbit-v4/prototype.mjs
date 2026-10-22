import { animate as motionAnimate, stagger } from './vendor/motion-14.6.0.mjs';
const $=id=>document.getElementById(id),el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const folderSVG='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>',gridSVG='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
const definitions=[['常用',[]],['工作协作',['飞书','语雀']],['AI助手与检索',['ChatGPT','Claude','Gemini','Perplexity','Mistral AI','Kagi 搜索']],['AI开发与API',['Google AI Studio','NVIDIA API','DeepWiki','Hugging Face','OpenRouter']],['AI创作与设计',['Figma','Stitch','Google Flow','Mixboard','即梦','Civitai','Excalidraw']],['云平台与服务',['Google Cloud','腾讯云','阿里云','ClawCloud','AWS']],['开发工具',['GitHub','JSON 工具','正则表达式','Arco Design','CodePen']],['编程学习',['Linux 内核文档','Go 语言圣经','Rust 语言圣经','TypeScript','MDN','Vue','React','JavaGuide','CS 自学指南','LeetCode','Refactoring Guru','eBPF 文档','Linux 网络编程','Python 文档','数据结构','Git 学习','操作系统','计算机网络']],['文档与效率',['Notion','CodeCV','文本差异对比','Obsidian','draw.io','DGM 画图','在线 Markdown','网站截图','飞书文档','Google Docs','效率清单']],['文件传输',['文叔叔','奶牛快传','WeTransfer','临时文件','Snapdrop','Peer Drop','SwissTransfer','Send Anywhere','文件收集']],['资讯与报告',['Kagi 世界新闻','蓝点网','机器之心','36氪','全天候科技','少数派','IT之家','Hacker News','The Verge','每日经济新闻']],['社区与通讯',['V2EX','Telegram','Reddit','Discord','即刻']],['家庭网络与NAS',['家庭网关','NAS 管理','文件面板','设备控制台']],['网络与代理',['IP 地址','网络检测','代理工具','路由参考']],['阅读与资源',[]]];
const known={ChatGPT:['◎','#274d43','chatgpt.com'],Claude:['✳','#79564a','claude.ai'],Gemini:['✧','#4d608d','gemini.google.com'],Perplexity:['⌘','#376567','perplexity.ai'],'Mistral AI':['M','#876241','chat.mistral.ai'],Figma:['F','#5e4b80','figma.com'],GitHub:['GH','#e0e5ec','github.com'],'Google Flow':['F','#456e73','flow.google.com'],DeepWiki:['D','#445b85','deepwiki.com'],'Kagi 世界新闻':['K','#856b45','news.kagi.com'],'Kagi 搜索':['K','#856b45','kagi.com'],飞书:['飞','#365b85','feishu.cn'],语雀:['语','#376650','yuque.com']};
let counter=0;const palette=['#38556b','#53567c','#4b655c','#75634c','#624f6d','#476b70'];
const groups=definitions.map(([name,names],i)=>({id:'g'+i,name,sites:names.map(title=>{const k=known[title];return {id:'s'+(++counter),title,mark:k?.[0]||title.slice(0,1),color:k?.[1]||palette[counter%palette.length],url:'https://'+(k?.[2]||'example.invalid/'+counter)};})}));
const state={group:null,compact:false,query:'',panelVersion:0,opener:null,run:null,animation:null,folderContext:null,enterAnimation:null,closeTask:null};
function icon(site){const n=el('span','favicon',site.mark);n.style.setProperty('--icon-bg',site.color);n.style.setProperty('--icon-color',site.title==='GitHub'?'#19212b':'#f4f7fc');n.setAttribute('aria-hidden','true');return n;}
function toast(text){$('status-action').textContent=text;$('status-action').title=text;$('panel-live').textContent=text;}
function total(){return groups.reduce((n,g)=>n+g.sites.length,0);}
function renderNav(){}
const prefs={profile:'spring',wallpaper:'night',dim:24,blur:0,position:'center',engine:'bing',showClock:true,newTab:true,knowledge:true,autoSync:true,backup:true,deviceName:'我的 Mac',server:'',token:''};
const profiles={spring:{label:'轻盈弹簧',distance:22,duration:.38,bounce:.12},smooth:{label:'柔和滑入',distance:12,duration:.24,bounce:0},still:{label:'即时响应',distance:0,duration:0,bounce:0}};
function setProfile(id){prefs.profile=id;document.documentElement.dataset.motion=id==='still'?'reduce':'normal';$('motion-profile').value=id;toast('已切换：'+profiles[id].label+'，打开文件夹即可体验');}
function runEntrance(panel){
 state.enterAnimation?.stop();
 if(!motionEnabled()){panel.style.opacity='1';panel.style.transform='none';return;}
 const p=profiles[prefs.profile];
 state.enterAnimation=motionAnimate(panel,{opacity:[0,1],y:[p.distance,0]},{type:prefs.profile==='spring'?'spring':'keyframes',duration:p.duration,bounce:p.bounce,opacity:{type:'keyframes',duration:.16,ease:'easeOut'},ease:[.22,1,.36,1]});
}
function enterContent(){if(!motionEnabled())return;const body=$('panel-content');state.contentAnimation?.stop();state.contentAnimation=motionAnimate(body,{opacity:[.5,1],x:[6,0]},{duration:.16,ease:[.22,1,.36,1]});}
function motionEnabled(){return !matchMedia('(prefers-reduced-motion: reduce)').matches&&document.documentElement.dataset.motion!=='reduce';}
function selectGroup(id){if(id===null){state.query='';$('search').value='';render();return;}showFolder(id);}
function render(animate=false){
 state.animation?.cancel();const current=groups.find(g=>g.id===state.group),query=state.query.trim().toLowerCase();renderNav();$('back-button').hidden=!current&&!query;
 $('view-title').textContent=query?'搜索结果':current?.name||'全部收藏';$('view-caption').textContent=query?'实时筛选收藏，Enter 搜索网页。':current?'全部收藏 / '+current.name:'按分组安放，每次打开都从容一点。';$('clear-search').hidden=!query;
 const content=$('content');content.replaceChildren();document.body.classList.toggle('is-compact',state.compact);$('compact-toggle').setAttribute('aria-pressed',String(state.compact));
 if(!current&&!query){content.className='folder-grid';$('item-count').textContent=groups.length+' 个分组';for(const g of groups){const b=el('button','folder'),top=el('span','folder-top'),art=el('span','folder-art'+(!g.sites.length?' empty-folder':''));if(!g.sites.length)art.textContent='＋';else for(const s of g.sites.slice(0,6))art.append(icon(s));top.append(art,el('span','arrow','↗'));b.append(top,el('strong','',g.name),el('small','',g.sites.length+' 个网站'));b.dataset.folder=g.id;b.dataset.focusKey='folder:'+g.id;b.addEventListener('click',()=>selectGroup(g.id));content.append(b);}$('empty').hidden=true;}
 else{content.className='site-grid';let sites=query?groups.flatMap(g=>g.sites).filter(s=>(s.title+' '+s.url).toLowerCase().includes(query)):current.sites;$('item-count').textContent=sites.length+' 个网站';$('empty').hidden=sites.length>0;for(const s of sites){const card=el('article','site'),b=el('button','site-launch'),edit=el('button','site-edit','⋯');b.setAttribute('aria-label','打开 '+s.title);b.append(icon(s),el('span','site-name',s.title),el('span','site-host',new URL(s.url).hostname));b.addEventListener('click',()=>toast('演示预览：这里会打开 '+s.title));edit.setAttribute('aria-label','编辑 '+s.title);edit.dataset.focusKey='edit-'+s.id;edit.addEventListener('click',()=>editor(s));card.append(b,edit);content.append(card);}}
 $('footer-count').textContent=groups.length+' 个分组 · '+total()+' 个收藏';$('content-scroll').scrollTop=0;
 if(animate&&motionEnabled())state.animation=content.animate([{opacity:.55},{opacity:1}],{duration:100,easing:'ease-out'});
}
function hideMenu(){if($('tools-menu').matches(':popover-open'))$('tools-menu').hidePopover();}
function openPanel(title,subtitle,{drawer=false,wide=false}={}){
 hideMenu();state.panelVersion++;const panel=$('panel'),entering=!panel.open;
 if(entering)state.opener=document.activeElement;
 const folder=state.openingFolder||(!entering&&state.folderContext);
 panel.className=folder?'folder-panel':drawer?'drawer':wide?'settings-panel':'';panel.dataset.view='task';state.openingFolder=false;
 $('panel-title').textContent=title;$('panel-subtitle').textContent=subtitle;$('panel-content').replaceChildren();$('panel-footer').replaceChildren();
 if(entering){$('modal-scrim').hidden=false;state.scrimAnimation?.stop();$('modal-scrim').style.opacity=motionEnabled()?'0':'1';if(motionEnabled())state.scrimAnimation=motionAnimate($('modal-scrim'),{opacity:[0,1]},{duration:.18});panel.showModal();runEntrance(panel);}else{queueMicrotask(enterContent);}
 return $('panel-content');
}
function button(text,cls,fn){const b=el('button',cls,text);b.type='button';b.addEventListener('click',fn);return b;}
function closePanel(){
 const panel=$('panel');if(!panel.open)return Promise.resolve();if(state.closeTask)return state.closeTask;
 state.enterAnimation?.stop();state.contentAnimation?.stop();state.scrimAnimation?.stop();if(motionEnabled())state.scrimAnimation=motionAnimate($('modal-scrim'),{opacity:0},{duration:.14});
 const r=panel.getBoundingClientRect();panel.style.width=r.width+'px';panel.style.height=r.height+'px';panel.style.minWidth=r.width+'px';panel.dataset.closing='';
 state.closeTask=(async()=>{
  // Yield once so even reduced-motion's immediate branch cannot leave a
  // resolved promise assigned after its cleanup has already run.
  await Promise.resolve();
  try{if(motionEnabled()){const animation=motionAnimate(panel,{opacity:0,y:8},{duration:.14,ease:[.4,0,1,1]});try{await animation;}catch{}panel.close();}else panel.close();}
  finally{$('modal-scrim').hidden=true;state.scrimAnimation?.stop();delete panel.dataset.closing;panel.style.width='';panel.style.height='';panel.style.minWidth='';panel.style.opacity='';panel.style.transform='';state.closeTask=null;if($('status-action').textContent.startsWith('正在浏览'))toast('已返回全部收藏');}
 })();return state.closeTask;
}
$('close-panel').addEventListener('click',closePanel);
function requestPanelClose(event){
 event.preventDefault();const inline=$('panel-content').querySelector('.inline-confirm');
 if(inline){inline.remove();$('panel-content').querySelector('.backup-saved button')?.focus();return;}
 if($('panel').dataset.view==='editor'&&state.folderContext){showFolder(state.folderContext);return;}
 void closePanel();
}
$('panel').addEventListener('cancel',requestPanelClose);
$('panel').addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();requestPanelClose(event);}},true);
$('panel').addEventListener('close',()=>{if($('panel').open)return;state.folderContext=null;const old=state.opener,key=old?.dataset.focusKey,target=old?.isConnected?old:key?document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`):null;(target||$('add-site')).focus({preventScroll:true});});
let beganOutside=false;
function outside(event){const r=$('panel').getBoundingClientRect();return (event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom);}
document.addEventListener('pointerdown',e=>{beganOutside=$('panel').open&&e.button===0&&outside(e);},true);
document.addEventListener('pointercancel',()=>beganOutside=false,true);
document.addEventListener('click',e=>{if(beganOutside&&outside(e))void closePanel();beganOutside=false;},true);
function folderSite(site){const card=el('article','site'),b=el('button','site-launch'),edit=el('button','site-edit','⋯');b.setAttribute('aria-label','打开 '+site.title);b.append(icon(site),el('span','site-name',site.title),el('span','site-host',new URL(site.url).hostname));b.addEventListener('click',()=>toast('演示：打开 '+site.title+'；实际数据不变'));edit.setAttribute('aria-label','编辑 '+site.title);edit.addEventListener('click',()=>editor(site));card.append(b,edit);return card;}
function showFolder(id){
 const g=groups.find(g=>g.id===id);if(!g)return;state.folderContext=id;state.openingFolder=true;
 const body=openPanel(g.name,'');$('panel').dataset.view='folder';
 const toolbar=el('div','folder-toolbar'),search=el('label','folder-search'),input=el('input');input.type='search';input.placeholder='搜索此分组';input.setAttribute('aria-label','搜索此分组');search.append(el('span','','⌕'),input);
 const select=el('select');select.setAttribute('aria-label','切换文件夹');for(const group of groups){const o=el('option','',group.name);o.value=group.id;select.append(o);}select.value=id;select.addEventListener('change',()=>showFolder(select.value));
 const density=button('☷','icon-button',()=>{state.compact=!state.compact;document.body.classList.toggle('is-compact',state.compact);});density.setAttribute('aria-label','切换分组内紧凑视图');toolbar.append(search,select,density);
 const grid=el('div','site-grid folder-sites'),empty=el('div','folder-empty');empty.append(el('h3','','这里还留着位置'),el('p','','添加一个网站，放下新的发现。'));
 function draw(){const q=input.value.trim().toLowerCase(),sites=g.sites.filter(s=>(s.title+' '+s.url).toLowerCase().includes(q));grid.replaceChildren(...sites.map(folderSite));empty.hidden=sites.length>0;grid.hidden=!sites.length;if(q){empty.querySelector('h3').textContent='没有找到匹配的网站';empty.querySelector('p').textContent='试试名称或网址。';}}
 input.addEventListener('input',draw);body.append(toolbar,grid,empty);draw();
 $('panel-footer').append(el('span','hint','点击窗口外部关闭，当前页面保持原位'),button('＋ 添加网站','primary',()=>editor()));
 toast('正在浏览 '+g.name+' · '+g.sites.length+' 个网站');
}
function field(label,value,type='text'){const wrap=el('label','field',label),input=el('input');input.type=type;input.value=value;input.autocomplete='off';wrap.append(input);return {wrap,input};}
function editor(site=null){const fromFolder=$('panel').open?state.folderContext:null;const body=openPanel(site?'编辑收藏':'添加网站','名称、分组和图标，在一个面板里完成'),current=groups.find(g=>g.sites.includes(site))||groups.find(g=>g.id===fromFolder)||groups.find(g=>g.id===state.group)||groups[0];$('panel').dataset.view='editor';const preview=el('div','editor-preview'),initial=site||{title:'新的网站',mark:'网',color:'#38556b',url:'https://example.com'};preview.append(icon(initial));const copy=el('div');copy.append(el('strong','',initial.title),el('small','',new URL(initial.url).hostname));preview.append(copy);body.append(preview);
 const name=field('网站名称',site?.title||''),url=field('网站地址',site?.url||'','url'),group=el('label','field','所属分组'),select=el('select');for(const g of groups){const o=el('option','',g.name);o.value=g.id;select.append(o);}select.value=current.id;group.append(select);body.append(name.wrap,url.wrap,group);
 const tabs=el('div','segmented icon-tabs');let iconMode='auto',customMark=initial.mark;const area=el('div');const fillIcon=mode=>{iconMode=mode;for(const b of tabs.children)b.setAttribute('aria-pressed',String(b.dataset.mode===mode));area.replaceChildren();if(mode==='text'){const f=field('图标文字',customMark);f.input.maxLength=2;f.input.addEventListener('input',()=>{customMark=f.input.value;preview.querySelector('.favicon').textContent=customMark||'网';});area.append(f.wrap);}else if(mode==='image'){const f=field('图片链接','','url');f.input.placeholder='https://…/icon.png';area.append(f.wrap,button('加载预览','secondary',()=>toast('演示预览：正式版仅在点击后加载图片')));}else area.append(el('p','hint','已保存的图标保持不变，需要更换时再手动获取。'),button('重新获取图标','secondary',()=>toast('演示预览：正式版优先从 Chrome 获取图标')));};for(const [mode,label]of [['auto','网站图标'],['image','图片链接'],['text','文字图标']]){const b=button(label,'',()=>fillIcon(mode));b.dataset.mode=mode;tabs.append(b);}body.append(el('p','hint','网站图标'),tabs,area);fillIcon('auto');name.input.addEventListener('input',()=>preview.querySelector('strong').textContent=name.input.value||'新的网站');for(const input of [name.input,url.input])input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('panel-footer').lastElementChild.click();}});
 $('panel-footer').append(button(fromFolder?'← 返回分组':'取消',fromFolder?'secondary editor-back':'secondary',()=>fromFolder?showFolder(fromFolder):closePanel()),button('保存修改','primary',()=>{if(!name.input.value.trim()){name.input.focus();name.input.setCustomValidity('请输入网站名称');name.input.reportValidity();name.input.setCustomValidity('');return;}let parsed;try{parsed=new URL(url.input.value);if(!['https:','http:'].includes(parsed.protocol))throw Error();}catch{url.input.focus();url.input.setCustomValidity('请输入完整的 HTTP 或 HTTPS 网址');url.input.reportValidity();url.input.setCustomValidity('');return;}const target=groups.find(g=>g.id===select.value),next={...initial,id:site?.id||'s'+(++counter),title:name.input.value.trim(),url:parsed.href,mark:iconMode==='text'?customMark||'网':initial.mark};if(site&&target===current)current.sites[current.sites.indexOf(site)]=next;else{if(site)current.sites=current.sites.filter(s=>s.id!==site.id);target.sites.push(next);}render();if(fromFolder)showFolder(fromFolder);else void closePanel();toast('演示修改已保存，实际收藏未改变');}));}
function addGroup(){const body=openPanel('新建分组','用清楚的名称，让收藏各得其所'),f=field('分组名称','');body.append(f.wrap);$('panel-footer').append(button('取消','secondary',closePanel),button('创建分组','primary',()=>{const name=f.input.value.trim();if(!name){f.input.focus();return;}groups.push({id:'g'+groups.length,name,sites:[]});closePanel();render();toast('演示分组已创建');}));}
function settingRow(title,detail,control){const r=el('div','setting-row'),copy=el('div','',title);if(detail)copy.append(el('small','',detail));r.append(copy,control);return r;}
function toggle(on,fn,label){const i=el('input','switch');i.type='checkbox';i.checked=on;i.setAttribute('role','switch');i.setAttribute('aria-label',label);i.addEventListener('change',()=>fn(i.checked));return i;}
function themeChoice(){const s=el('div','segmented');for(const [t,label]of [['dark','深色'],['light','浅色']]){const b=button(label,'',()=>{setTheme(t);for(const child of s.children)child.setAttribute('aria-pressed',String(child===b));});b.setAttribute('aria-pressed',String(document.documentElement.dataset.theme===t));s.append(b);}return s;}
function setTheme(theme){document.documentElement.dataset.theme=theme;$('theme-toggle').setAttribute('aria-label',theme==='dark'?'切换浅色主题':'切换深色主题');}
function settings(initial='appearance'){
 const body=openPanel('设置','完整功能保留，按使用场景重新整理',{wide:true}),layout=el('div','panel-layout'),nav=el('div','settings-nav'),detail=el('section','settings-detail');
 layout.append(nav,detail);body.append(layout);nav.setAttribute('role','tablist');nav.setAttribute('aria-label','设置分类');
 const sections=[['appearance','外观与背景'],['motion','动效体验'],['layout','搜索与浏览'],['data','收藏管理'],['backup','备份与同步'],['connection','NAS 连接']];
 function head(title,desc){detail.append(el('h3','',title),el('p','hint section-intro',desc));}
 function select(label,options,value,change){const f=el('label','field',label),i=el('select');i.setAttribute('aria-label',label);for(const [v,t] of options){const o=el('option','',t);o.value=v;i.append(o);}i.value=value;i.onchange=()=>change(i.value);f.append(i);detail.append(f);return i;}
 function slider(label,key,max,unit,change){const f=el('label','range-field'),caption=el('span','',label),value=el('output','',prefs[key]+unit),i=el('input');i.type='range';i.min=0;i.max=max;i.value=prefs[key];i.setAttribute('aria-label',label);i.oninput=()=>{prefs[key]=+i.value;value.textContent=i.value+unit;change(+i.value);};f.append(caption,value,i);detail.append(f);}
 function actions(items){const a=el('div','settings-actions');for(const [text,fn] of items)a.append(button(text,'secondary',fn));detail.append(a);}
 function demo(text){toast('演示：'+text+'；当前实际数据不变');}
 function confirm(title,description,done){detail.querySelector('.inline-confirm')?.remove();const box=el('div','inline-confirm');box.append(el('h3','',title),el('p','hint',description));const a=el('div','settings-actions');a.append(button('取消','secondary',()=>box.remove()),button('确认','primary',()=>{box.remove();demo(done);}));box.append(a);detail.append(box);box.scrollIntoView({block:'nearest',behavior:'instant'});}
 function show(id){
 for(const b of nav.children){const on=b.dataset.tab===id;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;}detail.replaceChildren();
 if(id==='appearance'){
 head('外观与背景','保留原有壁纸、主题和背景调节。');
 detail.append(settingRow('界面配色','浅色与深色均有完整状态。',themeChoice()));
 select('背景主题',[['mist','山雾'],['dusk','暮色'],['night','深夜']],prefs.wallpaper,v=>{prefs.wallpaper=v;document.body.dataset.wallpaper=v;});
 const preview=el('div','wallpaper-preview');preview.append(el('span','','让背景退后，让收藏清晰。'));detail.append(preview);
 const upload=el('input');upload.type='file';upload.accept='image/png,image/jpeg,image/webp';upload.hidden=true;upload.setAttribute('aria-label','上传壁纸');
 upload.onchange=()=>{const f=upload.files[0];if(!f)return;if(f.size>15*1024*1024||!['image/png','image/jpeg','image/webp'].includes(f.type)){toast('请选择 15 MiB 以内的 PNG、JPEG 或 WebP');return;}if(state.wallpaperURL)URL.revokeObjectURL(state.wallpaperURL);state.wallpaperURL=URL.createObjectURL(f);document.body.style.setProperty('--wallpaper-image',`url("${state.wallpaperURL}")`);demo('壁纸已在预览中更新');};detail.append(upload);
 actions([['上传壁纸',()=>upload.click()],['恢复默认',()=>{document.body.style.removeProperty('--wallpaper-image');if(state.wallpaperURL)URL.revokeObjectURL(state.wallpaperURL);state.wallpaperURL=null;demo('已恢复默认背景');}]]);
 detail.append(el('p','hint','PNG / JPEG / WebP，最大 15 MiB。'));
 slider('背景暗度','dim',75,'%',v=>document.body.style.setProperty('--wallpaper-dim',v/100));
 slider('背景模糊','blur',16,' px',v=>document.body.style.setProperty('--wallpaper-blur',v+'px'));
 select('壁纸位置',[['center','居中'],['top','靠上'],['bottom','靠下']],prefs.position,v=>{prefs.position=v;document.body.style.setProperty('--wallpaper-position',v);});
 }else if(id==='motion'){
 head('动效体验','轻盈弹簧为推荐方案。打开、点击外部关闭，再切换另一种手感比较。');
 select('交互手感',Object.entries(profiles).map(([id,p])=>[id,p.label]),prefs.profile,setProfile);
 const stage=el('div','motion-stage'),tile=button('体验弹窗','motion-tile',async()=>{await closePanel();showFolder('g2');});stage.append(tile,el('p','hint','轻抬进入 · 快速退出 · 文字保持原尺寸'));detail.append(stage);
 detail.append(settingRow('跟随系统减少动态效果','系统开启减少动态效果时，自动取消位移。',el('span','hint',matchMedia('(prefers-reduced-motion: reduce)').matches?'当前已开启':'当前未开启')));
 detail.append(el('p','hint','切换文件夹与编辑内容时只做轻微位移。弹窗退出完成后再关闭，避免布局收缩。'));
 }else if(id==='layout'){
 head('搜索与浏览','保留搜索引擎、打开方式与内容显示设置。');
 select('默认搜索引擎',[['bing','Bing'],['google','Google'],['baidu','百度']],prefs.engine,v=>{prefs.engine=v;demo('默认搜索引擎已更改');});
 for(const [key,title,desc,apply]of [['showClock','显示时钟','时间与日期在搜索框上方显示。',v=>document.querySelector('.time-row').hidden=!v],['newTab','新标签页打开网站','点击收藏后保留工作台。',()=>{}],['knowledge','显示知识库入口','按需查阅文章与待办。',v=>$('knowledge-button').hidden=!v]])detail.append(settingRow(title,desc,toggle(prefs[key],v=>{prefs[key]=v;apply(v);},title)));
 detail.append(settingRow('紧凑视图','减少分组与网站之间的留白。',toggle(state.compact,v=>{state.compact=v;render();},'紧凑视图')));
 }else if(id==='data'){
 head('收藏管理','收藏、分组及图标一起管理，维护工具集中在这里。');
 actions([['网站可用性检查',()=>maintenance('check')],['批量获取网站图标',()=>maintenance('icons')]]);
 detail.append(el('p','hint','请求受限列为待复核；手动获取图标，失败保留原图标。'));
 const box=el('div','backup-saved');box.append(el('strong','','导入与导出'),el('p','','导出包含收藏、分组与图标。导入采用合并去重，保留已有收藏。'));detail.append(box);
 actions([['导出备份',()=>demo('将导出包含图标的完整 JSON 备份')],['导入并合并',()=>confirm('导入并合并收藏','演示文件：2 个分组、6 个收藏，其中 2 个重复项将跳过。','已合并演示收藏')]]);
 detail.append(el('p','hint','当前为设计预览，导入、导出与维护使用演示流程。'));
 }else if(id==='backup'){
 head('备份与同步','自动同步和历史备份分别控制。');
 detail.append(settingRow('多设备自动同步','冲突保留双方版本，可手动处理。',toggle(prefs.autoSync,v=>prefs.autoSync=v,'多设备自动同步')));
 actions([['立即同步',()=>demo('同步完成')],['查看同步状态',()=>demo('本机与远端内容已对齐')],['处理冲突',()=>confirm('处理同步冲突','演示：同一收藏存在两个版本。默认保留双方，也可选择一个版本。','已保留双方版本')]]);
 detail.append(settingRow('NAS 自动备份','保存收藏、分组和持久化图标。',toggle(prefs.backup,v=>prefs.backup=v,'NAS 自动备份')));
 const device=field('设备名称',prefs.deviceName);device.input.oninput=()=>prefs.deviceName=device.input.value;detail.append(device.wrap,el('p','hint','设备 ID：demo-mac-01（只读演示）'));
 actions([['保存备份配置',()=>demo('配置已保存')],['立即备份',()=>demo('备份已校验，完整包含分组、收藏和图标')]]);
 detail.append(el('h3','subheading','备份历史'),el('p','hint','正式版保留最近 100 份历史备份。'));
 const history=el('div','backup-saved');history.append(el('strong','','今天 18:57 · 我的 Mac'),el('p','','15 个分组 · 91 个收藏 · 包含全部图标'),button('预览恢复','secondary',()=>confirm('确认恢复此备份','先预览分组、收藏和图标数量。恢复前保留本机撤销副本。','恢复完成，可撤销上次恢复')));detail.append(history);
 actions([['刷新历史',()=>demo('备份历史已刷新')],['撤销上次恢复',()=>confirm('撤销上次恢复','将恢复至上次操作前的本机副本。','已撤销上次恢复')]]);
 }else{
 head('NAS 连接','连接信息只保存在本机。这里使用独立演示配置。');
 const server=field('NAS 服务地址',prefs.server,'url');server.input.placeholder='https://nas.example.invalid';const token=field('访问令牌',prefs.token,'password');token.input.placeholder='输入访问令牌';token.input.autocomplete='new-password';server.input.oninput=()=>prefs.server=server.input.value;token.input.oninput=()=>prefs.token=token.input.value;detail.append(server.wrap,token.wrap);
 actions([['保存并连接',()=>{let u;try{u=new URL(prefs.server);if(!['https:','http:'].includes(u.protocol))throw Error();}catch{server.input.reportValidity();toast('请输入完整的 HTTP 或 HTTPS 服务地址');return;}if(!prefs.token){token.input.focus();toast('请填写演示访问令牌');return;}demo('已模拟保存并连接，未发送网络请求');}],['断开连接',()=>confirm('断开 NAS 连接','清除本机连接缓存，保留当前收藏和备份。','已模拟断开连接')]]);
 detail.append(el('p','hint','连接结果、同步进度和错误提示统一显示在底部状态栏。'));
 }
 detail.setAttribute('aria-labelledby','setting-tab-'+id);detail.scrollTop=0;enterContent();
 }
 for(const [id,label]of sections){const b=button(label,'',()=>show(id));b.dataset.tab=id;b.setAttribute('role','tab');b.id='setting-tab-'+id;b.setAttribute('aria-controls','settings-detail');nav.append(b);}
 detail.id='settings-detail';detail.setAttribute('role','tabpanel');
 nav.onkeydown=e=>{if(!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const all=[...nav.children],idx=all.indexOf(document.activeElement);let next=e.key==='Home'?0:e.key==='End'?all.length-1:(idx+(['ArrowDown','ArrowRight'].includes(e.key)?1:-1)+all.length)%all.length;all[next].click();all[next].focus();};
 show(initial);$('panel-footer').append(el('span','hint','设计预览 · 设置仅在本页生效'),button('完成','primary',closePanel));
}
function knowledge(){const body=openPanel('知识库','随手查阅，不打断当前收藏',{drawer:true}),tabs=el('div','segmented');const area=el('div');function show(id){for(const b of tabs.children)b.setAttribute('aria-pressed',String(b.dataset.tab===id));area.replaceChildren();if(id==='notes'){const f=field('搜索知识','');f.input.placeholder='搜索标题与内容';area.append(f.wrap);const list=el('ul','doc-list');for(const [title,desc]of [['从收集到沉淀','知识管理 · 最近更新'],['Go 并发学习笔记','编程学习 · 8 分钟阅读'],['给下一次阅读留个入口','阅读清单 · 4 篇关联笔记']]){const li=el('li'),b=button('','',()=>{area.replaceChildren(button('← 返回文章列表','quiet-button',()=>show('notes')),el('h3','',title),el('p','hint','这是阅读布局演示。文章内容直接在同一知识库面板呈现，不叠加新的弹窗。'));});b.append(el('strong','',title),el('small','',desc));li.append(b);list.append(li);}area.append(list);}else if(id==='tasks'){area.append(el('p','hint','今天的待办'));for(const title of ['回顾本周收集的资料','整理待阅读文章','检查最近一次备份']){const label=el('label','setting-row'),i=el('input');i.type='checkbox';label.append(el('span','',title),i);area.append(label);}}else area.append(el('div','backup-saved','收藏与知识库均已保存。此处为演示状态。'));}for(const [id,label]of [['notes','文章'],['tasks','待办'],['sync','同步']]){const b=button(label,'',()=>show(id));b.dataset.tab=id;tabs.append(b);}body.append(tabs,area);show('notes');}
function maintenance(kind){const icons=kind==='icons',body=openPanel(icons?'批量获取图标':'网站可用性检查',icons?'手动获取，成功后固定保存':'请求受限单独复核，不作为失效依据',{wide:true});body.append(el('p','hint',icons?'优先使用 Chrome 图标。失败保留原图标，默认保护自定义图标。':'只有 HTTP 异常可以选择清理。登录、跳转和网络限制会保留为待复核。'));$('panel').classList.add('maintenance-panel');const summary=el('div','maintenance-summary'),status=el('p','','尚未开始 · 演示 6 个网站'),start=button('开始演示','primary',()=>run());summary.append(status,start);const progress=el('progress');progress.max=6;progress.value=0;const list=el('ul','health-list');body.append(summary,progress,list);const rows=['GitHub','Google Flow','Google Cloud','DeepWiki','Kagi 世界新闻','示例旧网址'],version=state.panelVersion;let count=0;function run(){$('task-stop').hidden=false;state.stopTask=()=>{clearInterval(state.run);start.disabled=false;$('task-stop').hidden=true;toast('演示任务已停止，已完成结果保留');};count=0;list.replaceChildren();progress.value=0;start.disabled=true;clearInterval(state.run);state.run=setInterval(()=>{const i=count++,li=el('li'),copy=el('span','',rows[i]),badge=el('span','badge',icons?'已保存':i===1||i===2?'待复核':i===5?'HTTP 异常':'可访问');if(i===1||i===2){badge.classList.add('review');if(!icons)copy.append(el('small','hint','　跳转或登录限制'));}li.append(copy,badge);list.append(li);progress.value=count;status.textContent=`正在演示 ${count}/6`;toast((icons?'图标获取':'网站检查')+' · '+count+'/6');if(count===6){clearInterval(state.run);$('task-stop').hidden=true;start.disabled=false;start.textContent='重新演示';status.textContent=icons?'演示完成 · 失败保留原图标':'演示完成 · 3 个可访问、2 个待复核、1 个 HTTP 异常';toast(status.textContent);}},160);}}
function motionSpec(){settings('motion');}
$('back-button').addEventListener('click',()=>selectGroup(null));$('new-group').addEventListener('click',addGroup);$('add-site').addEventListener('click',()=>editor());$('compact-toggle').addEventListener('click',()=>{state.compact=!state.compact;render();});$('settings-button').addEventListener('click',()=>settings());$('sync-details').addEventListener('click',()=>settings('backup'));$('knowledge-button').addEventListener('click',knowledge);$('motion-note').addEventListener('click',motionSpec);$('theme-toggle').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
$('search').addEventListener('input',()=>{state.query=$('search').value;render();});$('clear-search').addEventListener('click',()=>{state.query='';$('search').value='';render();$('search').focus();});$('search-form').addEventListener('submit',e=>{e.preventDefault();toast('演示预览：正式版会使用你选择的搜索引擎');});
$('tools-menu').addEventListener('beforetoggle',e=>{if(e.newState!=='open')return;requestAnimationFrame(()=>{const r=$('tools-button').getBoundingClientRect(),m=$('tools-menu');m.style.left=Math.max(12,Math.min(innerWidth-272,r.right-260))+'px';m.style.top=Math.min(innerHeight-m.offsetHeight-12,r.bottom+8)+'px';});});for(const b of document.querySelectorAll('[data-open]'))b.addEventListener('click',()=>b.dataset.open==='backup'?settings('backup'):maintenance(b.dataset.open));
document.addEventListener('keydown',e=>{if($('panel').open||document.querySelector(':popover-open'))return;const typing=e.target.matches('input,textarea,select');if(!typing&&(e.key==='/'||((e.metaKey||e.ctrlKey)&&e.key==='k'))){e.preventDefault();$('search').focus();}if(e.key==='Escape'&&state.query){state.query='';$('search').value='';render();$('search').focus();}});
const now=new Date();$('clock').textContent=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit'}).format(now);$('date').textContent=new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'}).format(now);render();


$('task-stop').addEventListener('click',()=>state.stopTask?.());

$('motion-profile').addEventListener('change',e=>setProfile(e.target.value));$('motion-try').addEventListener('click',()=>showFolder('g2'));

$('tools-menu').addEventListener('toggle',e=>{if(e.newState==='open'&&motionEnabled())motionAnimate($('tools-menu'),{opacity:[0,1],y:[-4,0]},{duration:.14});});
